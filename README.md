# windows-ai-browser

Windows-first, trust-first agentic browser. Electron (Tier 3) today; architected
so the **agent layer ports Tier 3 → 2 → 1 untouched**.

See [`HANDOFF.md`](./HANDOFF.md) (product thesis, engine-tier decision, principles)
and [`REPO-STRUCTURE.md`](./REPO-STRUCTURE.md) (layout + boundary enforcement).

## The one rule that matters

> `agent` depends **only** on `engine-core` (a pure interface) + `shared`.
> It is *physically incapable* of importing `electron` or `engine-electron`.

This is enforced by [`.dependency-cruiser.js`](./.dependency-cruiser.js) as a CI
gate — a forbidden import **fails the build**, not a code review.

## Packages

| Package | Role | May import |
|---|---|---|
| `engine-core` | The `BrowserEngine` interface + trust **ports** + types. Pure. | `shared` |
| `engine-electron` | Electron/CDP implementation of the interface | `engine-core`, `shared`, `trust`, electron |
| `agent` | perceive→plan→act→verify loop | **only** `engine-core`, `shared` |
| `trust` | Credential isolation, Hello gating, audit (implements the ports) | `engine-core`, `shared`, electron |
| `memory` | Local markdown/SQLite memory | `shared` |
| `preload` | contextBridge; the only renderer-adjacent code touching electron | `shared`, electron |
| `shell` | Electron main; **composition root** (wires everyone) | all packages, electron |
| `ui` | React renderer | `shared` (types) + `window.wab` bridge |
| `shared` | Pure cross-cutting types (incl. the IPC contract) | (nothing) |

**Design note (resolved in planning):** trust capabilities are **separate ports**
(`ApprovalGate`, `CredentialVault`, `AuditLog` in `engine-core/ports.ts`), not
methods on `BrowserEngine`. The agent receives them injected by `shell`, so
credential handling and Windows Hello gating stay out of portable agent code.
Element addressing uses **stable `NodeRef` handles** from the a11y snapshot, not
model-authored selectors or coordinates (coords are vision-fallback only).

## Commands

```bash
pnpm install
pnpm depcruise    # the boundary gate (run in CI; fails on a forbidden import)
pnpm typecheck    # TS project-reference build
pnpm check        # both
```
