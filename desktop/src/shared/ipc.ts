import type { DesktopError } from './errors';
import { makeDesktopError } from './errors';
import { ensureRequestID } from './request-id';

export interface IpcRequestContext {
  requestID?: string;
  userID?: string;
}

export interface IpcSuccess<T> {
  success: true;
  data: T;
  requestID: string;
}

export interface IpcFailure {
  success: false;
  error: DesktopError;
  requestID: string;
}

export type IpcResult<T> = IpcSuccess<T> | IpcFailure;

export function ipcOk<T>(data: T, requestID?: string): IpcSuccess<T> {
  return { success: true, data, requestID: ensureRequestID(requestID) };
}

export function ipcFail(error: DesktopError, requestID?: string): IpcFailure {
  const resolved = ensureRequestID(requestID ?? error.requestID);
  return { success: false, error: { ...error, requestID: resolved }, requestID: resolved };
}

