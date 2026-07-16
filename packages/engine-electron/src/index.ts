// @wab/engine-electron — Electron/CDP implementation of BrowserEngine.
// The ONLY tab/CDP package that imports electron. Implements the engine-core
// contract via WebContentsView + webContents.debugger (CDP).
//
// Minimal stub for now (task graph step 4 fills it in: open one WebContentsView,
// navigate, attach CDP debugger, return a screenshot + a11y tree).

import type { BrowserEngine } from '@wab/engine-core';

export interface ElectronEngineOptions {
  /** Session partition for the isolated agent profile, etc. */
  readonly defaultPartition?: string;
}

/**
 * Factory returning a BrowserEngine backed by Electron. Deliberately not
 * implemented yet — declared so the shell can wire against the real type and
 * so the boundary graph has an implementer of the interface.
 */
export function createElectronBrowserEngine(
  _options?: ElectronEngineOptions,
): BrowserEngine {
  throw new Error('ElectronBrowserEngine not implemented yet');
}
