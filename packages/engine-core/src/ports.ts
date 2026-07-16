// @wab/engine-core — ports.ts
//
// Trust capability ports, kept SEPARATE from BrowserEngine (decision: "separate
// ports", not a fat engine interface). The agent receives these as injected
// dependencies typed by these interfaces; the shell wires the real `trust`
// implementations behind them. This keeps credential handling and Hello gating
// OUT of the portable agent code and in the composition root, where policy lives.
//
// Two hard invariants encoded by these signatures:
//   1. CredentialVault NEVER returns a secret to the caller. `injectCredential`
//      resolves to ok/err only — the secret goes page-side via the engine, so
//      it can never enter model context.
//   2. Sensitive actions gate on an explicit approval decision (ideally Windows
//      Hello) BEFORE the agent proceeds — the checkpoint is in the loop, not copy.

import type { Result } from '@wab/shared';
import type { TabId } from './types.js';

// ─── Approval (human-in-the-loop / Windows Hello) ────────────────────────────

export type SensitiveActionKind =
  | 'login'
  | 'payment'
  | 'send-message'
  | 'post-content'
  | 'account-read'
  | 'file-download'
  | 'permission-change';

export interface ApprovalRequest {
  readonly kind: SensitiveActionKind;
  /** Human-readable summary shown at the confirmation gate. */
  readonly summary: string;
  readonly tabId: TabId;
  readonly origin: string;
}

export type ApprovalDecision =
  | { readonly approved: true; readonly method: 'windows-hello' | 'explicit-confirm' }
  | { readonly approved: false; readonly reason: 'denied' | 'timeout' | 'no-authenticator' };

export interface ApprovalGate {
  /** Block the agent until the human approves (or denies) the action. */
  requestApproval(request: ApprovalRequest): Promise<ApprovalDecision>;
}

// ─── Credentials (inject at page, never to the model) ────────────────────────

export interface CredentialQuery {
  readonly origin: string;
  /** Which fields the login form needs filled — never the values. */
  readonly fields: readonly ('username' | 'password' | 'totp')[];
  readonly tabId: TabId;
}

export interface CredentialVault {
  /** True if a credential exists for the origin — no secret is returned. */
  hasCredential(origin: string): Promise<boolean>;
  /**
   * Fill the page's form fields with the stored secret, page-side, via the
   * engine. Resolves to ok/err ONLY — the secret is never handed back, so it
   * cannot reach model context.
   */
  injectCredential(query: CredentialQuery): Promise<Result<void, string>>;
}

// ─── Audit (append-only) ─────────────────────────────────────────────────────

export interface AuditEvent {
  readonly at: number;
  readonly actor: 'agent' | 'user' | 'system';
  readonly action: string;
  readonly tabId?: TabId;
  readonly origin?: string;
  readonly detail?: Readonly<Record<string, string | number | boolean>>;
}

export interface AuditLog {
  record(event: AuditEvent): void;
}

/**
 * The bundle of trust capabilities the shell injects into the agent. The agent
 * depends on these interfaces, never on the `trust` package that implements them.
 */
export interface TrustPorts {
  readonly approval: ApprovalGate;
  readonly credentials: CredentialVault;
  readonly audit: AuditLog;
}
