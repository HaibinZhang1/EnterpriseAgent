import path from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';

export function getPreloadPath(baseDir = __dirname): string {
  return path.join(baseDir, '..', 'preload', 'preload.js');
}

export function createMainWindowOptions(baseDir = __dirname): BrowserWindowConstructorOptions {
  return {
    width: 1120,
    height: 760,
    webPreferences: {
      preload: getPreloadPath(baseDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}
