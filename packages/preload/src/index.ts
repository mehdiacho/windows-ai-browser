// @wab/preload — the ONLY renderer-adjacent code allowed to touch electron.
// Runs in the isolated preload context; exposes the narrow RendererApi (typed
// in @wab/shared) to the renderer via contextBridge. Bundled to CJS by esbuild
// because sandboxed preload scripts cannot be ESM.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, type RendererApi, type TabId, type TabInfo } from '@wab/shared';

const api: RendererApi = {
  openTab: (url: string) => ipcRenderer.invoke(IPC.tabOpen, url) as Promise<TabInfo>,
  navigate: (tabId: TabId, url: string) =>
    ipcRenderer.invoke(IPC.tabNavigate, tabId, url) as Promise<TabInfo>,
  onTabUpdated: (handler: (tab: TabInfo) => void) => {
    const listener = (_e: IpcRendererEvent, tab: TabInfo): void => handler(tab);
    ipcRenderer.on(IPC.tabUpdated, listener);
    return () => ipcRenderer.removeListener(IPC.tabUpdated, listener);
  },
};

contextBridge.exposeInMainWorld('wab', api);
