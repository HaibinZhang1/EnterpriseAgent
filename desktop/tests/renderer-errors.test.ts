import { describe, expect, it } from 'vitest';
import { readableErrorMessage } from '../src/renderer/lib/errors';

describe('renderer error messages', () => {
  it('keeps explicit unauthenticated business messages when the session is still present', () => {
    expect(readableErrorMessage('旧密码错误', 'unauthenticated')).toBe('旧密码错误');
    expect(readableErrorMessage('手机号或密码错误', 'unauthenticated')).toBe('手机号或密码错误');
  });

  it('uses the relogin guidance for missing or expired sessions', () => {
    expect(readableErrorMessage('未登录或会话已失效', 'unauthenticated')).toBe('登录已失效，请重新登录。');
    expect(readableErrorMessage('', 'unauthenticated')).toBe('登录已失效，请重新登录。');
  });
});
