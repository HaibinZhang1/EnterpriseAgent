import { contextBridge, ipcRenderer } from 'electron';
import { createPreloadApi } from './api';

const api = createPreloadApi((channel, payload, requestID) => {
  return ipcRenderer.invoke('enterprise-agent:invoke', { channel, payload, requestID });
});

contextBridge.exposeInMainWorld('enterpriseAgent', api);
