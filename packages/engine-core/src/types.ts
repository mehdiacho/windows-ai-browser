// @wab/engine-core — types.ts
//
// The data contract the agent reasons over. PURE: no electron, no CDP types.
// engine-electron (and later engine-cef / engine-chromium) maps its own
// primitives onto these; the agent only ever sees these shapes.

import type { TabId } from '@wab/shared';

export type { TabId } from '@wab/shared';

// ─── Navigation ────────────────────────────────────────────────────────────

export interface Tab {
  readonly id: TabId;
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** True once the initial document + a11y tree are ready to perceive. */
  readonly ready: boolean;
}

export interface NavEvent {
  readonly tabId: TabId;
  readonly url: string;
  readonly kind: 'started' | 'committed' | 'finished' | 'failed';
}

// ─── Perception: the a11y tree the model reads ───────────────────────────────

/**
 * Opaque, engine-assigned handle for a node in a single a11y snapshot.
 * The model NEVER authors these — it reads them from the snapshot and passes
 * them back to act on a node. Backed by CDP backendNodeId in engine-electron,
 * but the agent must treat it as opaque so the scheme ports to other engines.
 *
 * A ref is only valid within the snapshot that produced it (see A11ySnapshot).
 */
export type NodeRef = string & { readonly __brand: 'NodeRef' };

/** ARIA-ish state flags, only present when meaningful (kept sparse for tokens). */
export interface A11yNodeState {
  readonly disabled?: boolean;
  readonly checked?: boolean | 'mixed';
  readonly expanded?: boolean;
  readonly selected?: boolean;
  readonly focused?: boolean;
  readonly required?: boolean;
  readonly invalid?: boolean;
  readonly hidden?: boolean;
}

/**
 * A curated accessibility node. This is deliberately NOT the raw AX tree —
 * engine-electron prunes presentational/redundant nodes before it gets here.
 */
export interface A11yNode {
  readonly ref: NodeRef;
  /** ARIA role, e.g. "button", "textbox", "link", "heading". */
  readonly role: string;
  /** Accessible name (label/text), already trimmed. */
  readonly name?: string;
  /** Current value for inputs/comboboxes/sliders. */
  readonly value?: string;
  readonly state?: A11yNodeState;
  /** Heading level, list position, etc. — only when semantically relevant. */
  readonly level?: number;
  readonly children?: readonly A11yNode[];
}

/**
 * A point-in-time perception of a tab. The snapshotId lets the engine reject
 * a stale ref (DOM changed underneath the model) instead of acting on the
 * wrong node — the agent loop re-perceives and retries on a stale-ref error.
 */
export interface A11ySnapshot {
  readonly tabId: TabId;
  readonly snapshotId: string;
  readonly url: string;
  readonly root: A11yNode;
}

// ─── Input / actions the engine can dispatch ─────────────────────────────────

export type InputEvent =
  | { readonly type: 'click'; readonly ref: NodeRef; readonly button?: 'left' | 'right' | 'middle' }
  | { readonly type: 'type'; readonly ref: NodeRef; readonly text: string; readonly submit?: boolean }
  | { readonly type: 'key'; readonly key: string }
  | { readonly type: 'scroll'; readonly ref?: NodeRef; readonly dy: number; readonly dx?: number }
  | { readonly type: 'hover'; readonly ref: NodeRef }
  /** Vision fallback only — coordinates in the snapshot's device pixels. */
  | { readonly type: 'clickAt'; readonly x: number; readonly y: number };

export interface Screenshot {
  /** PNG bytes. */
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
  /** Device pixel ratio, so vision-fallback coordinates can be mapped back. */
  readonly scale: number;
}

// ─── Errors that cross the boundary as values, not exceptions ────────────────

export type EngineErrorCode =
  | 'no-such-tab'
  | 'stale-ref'
  | 'ref-not-actionable'
  | 'navigation-failed'
  | 'timeout'
  | 'detached';

export interface EngineError {
  readonly code: EngineErrorCode;
  readonly message: string;
}
