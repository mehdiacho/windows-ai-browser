// @wab/shell — main.ts (Electron entry point)
//
// Throwaway-per-tier shell plumbing: window/process/updater management. Kept
// deliberately thin — the durable value is in agent + engine-core, not here.

import { app, BrowserWindow } from 'electron';
import { bootstrap } from './bootstrap.js';

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
  });
  // ui renderer is mounted here in a later step (task graph step 5/6).
  return win;
}

app.whenReady().then(() => {
  const { agent } = bootstrap();
  void agent; // driven by the UI/omnibox in a later step.
  createMainWindow();
});
