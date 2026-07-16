// Typed IPC bridge, main side. The renderer's whole world is these handlers —
// it never sees the engine, only TabInfo projections over IPC.

import { ipcMain, type BrowserWindow } from 'electron';
import { IPC, type TabId, type TabInfo } from '@wab/shared';
import type { BrowserEngine, Tab } from '@wab/engine-core';

const toInfo = (tab: Tab): TabInfo => ({
  tabId: tab.id,
  url: tab.url,
  title: tab.title,
  loading: tab.loading,
});

export function registerIpc(engine: BrowserEngine, win: BrowserWindow): void {
  ipcMain.handle(IPC.tabOpen, async (_e, url: string): Promise<TabInfo> => {
    const result = await engine.openTab({ url });
    if (!result.ok) throw new Error(result.error.message);
    return toInfo(result.value);
  });

  ipcMain.handle(IPC.tabNavigate, async (_e, tabId: TabId, url: string): Promise<TabInfo> => {
    const result = await engine.navigate(tabId, url);
    if (!result.ok) throw new Error(result.error.message);
    return toInfo(result.value);
  });

  // Push nav progress to the renderer so the omnibox/title stay live.
  engine.onNavigate((nav) => {
    if (win.isDestroyed()) return;
    void engine.listTabs().then((tabs) => {
      const tab = tabs.find((t) => t.id === nav.tabId);
      if (tab && !win.isDestroyed()) win.webContents.send(IPC.tabUpdated, toInfo(tab));
    });
  });
}
