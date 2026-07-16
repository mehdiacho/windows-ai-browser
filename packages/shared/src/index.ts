// @wab/shared — pure cross-cutting types/utils. NO electron, NO other packages.
// Types shared between main and renderer (over typed IPC) live here.

/** A branded string helper for opaque, type-safe IDs. */
export type Brand<T, B extends string> = T & { readonly __brand: B };

/** Stable identifier for an open tab, meaningful across main↔renderer IPC. */
export type TabId = Brand<string, 'TabId'>;

export const asTabId = (raw: string): TabId => raw as TabId;

/** Result type used across package boundaries instead of throwing over IPC. */
export type Result<T, E = string> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/**
 * The narrow, typed API the preload bridge exposes to the renderer via
 * contextBridge. Lives here (pure types) so BOTH `preload` and `ui` can import
 * the contract without `ui` ever importing electron-touching code.
 */
export interface RendererApi {
  openTab(url: string): Promise<TabId>;
  navigate(tabId: TabId, url: string): Promise<void>;
}
