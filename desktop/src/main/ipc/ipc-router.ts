import type { IpcMain } from 'electron';
import { makeDesktopError, toDesktopError } from '../../shared/errors';
import { ipcFail, ipcOk, type IpcRequestContext, type IpcResult } from '../../shared/ipc';
import { ensureRequestID } from '../../shared/request-id';
import type { IpcChannel } from './channels';
import { ALLOWED_IPC_CHANNELS } from './channels';

export type IpcHandler<T = unknown> = (payload: unknown, context: IpcRequestContext) => Promise<T> | T;

export interface IpcBridgeRequest {
  channel: string;
  payload?: unknown;
  requestID?: string;
}

export class IpcRouter {
  private readonly handlers = new Map<IpcChannel, IpcHandler>();

  register<T>(channel: IpcChannel, handler: IpcHandler<T>): void {
    this.handlers.set(channel, handler);
  }

  async invoke<T = unknown>(channel: string, payload?: unknown, context: IpcRequestContext = {}): Promise<IpcResult<T>> {
    const requestID = ensureRequestID(context.requestID);
    if (!ALLOWED_IPC_CHANNELS.includes(channel as IpcChannel) || !this.handlers.has(channel as IpcChannel)) {
      return ipcFail(makeDesktopError('unknown_ipc_channel', `Unknown IPC channel: ${channel}`, requestID), requestID);
    }
    try {
      const data = await this.handlers.get(channel as IpcChannel)?.(payload, { ...context, requestID });
      return ipcOk(data as T, requestID);
    } catch (error) {
      return ipcFail(toDesktopError(error, requestID), requestID);
    }
  }
}

export function registerElectronIpc(ipcMain: Pick<IpcMain, 'handle'>, router: Pick<IpcRouter, 'invoke'>): void {
  ipcMain.handle('enterprise-agent:invoke', (_event, request: IpcBridgeRequest) => {
    return router.invoke(request.channel, request.payload, { requestID: request.requestID });
  });
}
