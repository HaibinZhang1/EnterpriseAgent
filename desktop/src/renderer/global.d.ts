import type { EnterpriseAgentPreloadApi } from '../preload/api';

declare global {
  interface Window {
    enterpriseAgent: EnterpriseAgentPreloadApi;
  }
}

export {};
