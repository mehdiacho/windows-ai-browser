// @wab/trust — implements the engine-core trust PORTS (ApprovalGate,
// CredentialVault, AuditLog). May import electron (safeStorage) and the native
// windows-hello bridge. The agent never imports this package — the shell injects
// these implementations behind the engine-core interfaces.
//
// Stubs for now; real DPAPI/safeStorage + Windows Hello wiring lands later.

import type {
  ApprovalGate,
  AuditLog,
  CredentialVault,
  TrustPorts,
} from '@wab/engine-core';

export function createApprovalGate(): ApprovalGate {
  return {
    async requestApproval() {
      return { approved: false, reason: 'no-authenticator' };
    },
  };
}

export function createCredentialVault(): CredentialVault {
  return {
    async hasCredential() {
      return false;
    },
    async injectCredential() {
      return { ok: false, error: 'credential vault not implemented yet' };
    },
  };
}

export function createAuditLog(): AuditLog {
  return {
    record() {
      /* append-only sink not implemented yet */
    },
  };
}

export function createTrustPorts(): TrustPorts {
  return {
    approval: createApprovalGate(),
    credentials: createCredentialVault(),
    audit: createAuditLog(),
  };
}
