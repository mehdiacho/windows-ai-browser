// @wab/ui — React renderer. NO electron main, NO node. Talks to main ONLY via
// the preload-exposed `window.wab` bridge, typed by @wab/shared's RendererApi.

import type { RendererApi } from '@wab/shared';

declare global {
  interface Window {
    readonly wab: RendererApi;
  }
}

/** Thin accessor for the preload bridge — the renderer's only door to main. */
export function bridge(): RendererApi {
  return window.wab;
}
