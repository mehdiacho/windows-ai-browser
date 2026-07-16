// @wab/engine-core — BrowserEngine.ts
//
// THE SACRED INTERFACE. The agent talks to the browser ONLY through this.
// It is pure browser control — no trust/policy concerns live here (those are
// separate ports; see ports.ts). Keeping this interface about *the browser*
// is what makes "reimplement for Tier 2/1" a bounded job.
//
// Every method returns data already shaped by engine-core/types — no electron,
// no CDP, no DOM leaks across this line.

import type { Result } from '@wab/shared';
import type {
  A11ySnapshot,
  EngineError,
  InputEvent,
  NavEvent,
  Screenshot,
  Tab,
  TabId,
} from './types.js';

/** Unsubscribe handle returned by event subscriptions. */
export type Unsubscribe = () => void;

export interface OpenTabOptions {
  readonly url?: string;
  /** Session partition — the agent's isolated profile uses a distinct one. */
  readonly partition?: string;
  readonly background?: boolean;
}

export interface BrowserEngine {
  // ─── Lifecycle / navigation ────────────────────────────────────────────
  openTab(options?: OpenTabOptions): Promise<Result<Tab, EngineError>>;
  closeTab(tabId: TabId): Promise<Result<void, EngineError>>;
  listTabs(): Promise<readonly Tab[]>;
  navigate(tabId: TabId, url: string): Promise<Result<Tab, EngineError>>;

  // ─── Perception ────────────────────────────────────────────────────────
  /** Curated, ref-addressed a11y snapshot — the model's primary perception. */
  getA11yTree(tabId: TabId): Promise<Result<A11ySnapshot, EngineError>>;
  /** Vision fallback: pixels for canvas/WebGL/degenerate-tree cases. */
  screenshot(tabId: TabId): Promise<Result<Screenshot, EngineError>>;
  /** Read-only scripted evaluation in the page (never used to pass secrets). */
  evaluate<T = unknown>(tabId: TabId, expression: string): Promise<Result<T, EngineError>>;

  // ─── Action ────────────────────────────────────────────────────────────
  /** Dispatch an input event, addressing nodes by the snapshot's NodeRef. */
  dispatchInput(tabId: TabId, event: InputEvent): Promise<Result<void, EngineError>>;

  // ─── Events ────────────────────────────────────────────────────────────
  onNavigate(handler: (event: NavEvent) => void): Unsubscribe;
}
