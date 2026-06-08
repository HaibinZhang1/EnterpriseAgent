import path from 'node:path';
import type { BrowserWindowConstructorOptions } from 'electron';

interface RetainedWindow {
  on(event: 'closed', listener: () => void): void;
}

type BrowserWindowFactory<T extends RetainedWindow> = new (options: BrowserWindowConstructorOptions) => T;

export class MainWindowRegistry<T extends RetainedWindow = RetainedWindow> {
  private retainedWindow: T | undefined;

  retain(window: T): T {
    this.retainedWindow = window;
    window.on('closed', () => {
      if (this.retainedWindow === window) this.retainedWindow = undefined;
    });
    return window;
  }

  current(): T | undefined {
    return this.retainedWindow;
  }
}

export function getPreloadPath(baseDir = __dirname): string {
  return path.join(baseDir, '..', 'preload', 'preload.js');
}

export function createMainWindowOptions(baseDir = __dirname): BrowserWindowConstructorOptions {
  return {
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: getPreloadPath(baseDir),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  };
}

export function createManagedMainWindow<T extends RetainedWindow>(
  WindowCtor: BrowserWindowFactory<T>,
  registry: MainWindowRegistry<T>,
  baseDir = __dirname
): T {
  return registry.retain(new WindowCtor(createMainWindowOptions(baseDir)));
}
