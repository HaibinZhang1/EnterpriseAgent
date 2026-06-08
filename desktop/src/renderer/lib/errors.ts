import type { IpcResult } from '../../shared/ipc';
import type { UiError } from '../types/desktop';

export class UiApiError extends Error {
  readonly uiError: UiError;

  constructor(error: UiError) {
    super(error.message);
    this.name = 'UiApiError';
    this.uiError = error;
  }
}

export function unwrapResult<T>(result: IpcResult<T>): T {
  if (result.success) return result.data;
  throw new UiApiError({
    code: result.error.code,
    message: readableErrorMessage(result.error.message, result.error.code),
    requestID: result.error.requestID,
    details: result.error.details
  });
}

export function toUiError(error: unknown): UiError {
  if (error instanceof UiApiError) return error.uiError;
  if (error instanceof Error) {
    const inferredCode = inferErrorCode(error.message);
    return { code: inferredCode, message: readableErrorMessage(error.message, inferredCode) };
  }
  return { message: '操作失败，请稍后重试。' };
}

export function readableErrorMessage(message: string, code?: string): string {
  if (code === 'unauthenticated') {
    const trimmed = message.trim();
    if (trimmed && !isSessionExpiredMessage(trimmed)) return trimmed;
    return '登录已失效，请重新登录。';
  }
  if (code === 'permission_denied') return '当前账号没有执行该操作的权限。';
  if (code === 'state_conflict' && message.includes('设备已绑定')) return `${message}。如需切换发布者，请联系管理员解绑当前设备或使用已绑定账号继续。`;
  if (code === 'scope_restricted') return '该扩展未授权给当前范围，主操作暂不可用。';
  if (code === 'offline_server_authority_required') return '当前离线，服务端授权操作暂不可用。';
  if (code === 'validation_failed') return message || '输入信息不完整或格式不正确。';
  if (code === 'skill_manifest_missing') return 'Skill 包顶层必须包含 SKILL.md。';
  if (code === 'server_unavailable') return '无法连接服务端，请检查网络或服务状态。';
  return message || '操作失败，请稍后重试。';
}

function inferErrorCode(message: string): string | undefined {
  return hasExplicitSessionExpiredSignal(message) ? 'unauthenticated' : undefined;
}

function isSessionExpiredMessage(message: string): boolean {
  return (
    hasExplicitSessionExpiredSignal(message) ||
    /^[?\s]+$/.test(message)
  );
}

function hasExplicitSessionExpiredSignal(message: string): boolean {
  return /\bunauthenticated\b/i.test(message) || /登录已失效|未登录|会话.*失效/.test(message);
}
