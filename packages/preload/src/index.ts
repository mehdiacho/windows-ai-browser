// @wab/preload — the ONLY renderer-adjacent code allowed to touch electron.
// It runs in the isolated preload context and exposes a narrow, typed API to the
// renderer via contextBridge. The API *contract* (RendererApi) lives in
// @wab/shared so `ui` can consume it without importing electron.

import { contextBridge, ipcRenderer } from 'electron';
import type { RendererApi, TabId } from '@wab/shared';

const api: RendererApi = {
  openTab: (url) => ipcRenderer.invoke('tab:open', url) as Promise<TabId>,
  navigate: (tabId, url) => ipcRenderer.invoke('tab:navigate', tabId, url) as Promise<void>,
};

contextBridge.exposeInMainWorld('wab', api);
