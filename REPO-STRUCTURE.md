# Repo Structure — Windows-First AI Browser

> Companion to `HANDOFF.md`. This defines the physical monorepo layout and — critically — how the **`BrowserEngine` boundary is enforced by the module graph**, not just convention (Handoff §7.1, Open Question §9.1). The whole point: the `agent` package must be *physically incapable* of importing Electron, so the agent layer ports cleanly Tier 3 → 2 → 1.

## Tooling baseline
- **pnpm workspaces** (fast, strict, good monorepo hoisting control).
- **TypeScript project references** (enforce build-order + package isolation).
- **dependency-cruiser** as a CI gate (the boundary enforcement — see bottom).
- **Vite** for the `ui` renderer; **electron-vite** or a thin esbuild step for `shell` main.
- **Vitest** for unit tests; a dedicated `test/redteam` suite as a CI gate on the agent.

## The dependency rule in one sentence
`agent` depends **only** on `engine-core` (a pure interface). Only `engine-electron`, `shell`, `trust`, and native bindings may import `electron`. `ui` never imports main-process code — it talks to main via typed IPC + `shared` types.

---

## Tree

```
windows-ai-browser/
├── package.json                    # workspace root
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── .dependency-cruiser.js          # ⟵ ENFORCES the boundary (CI gate)
├── electron-builder.yml            # NSIS + OV/EV signing config
├── HANDOFF.md
├── REPO-STRUCTURE.md
│
├── packages/
│   ├── engine-core/                # PURE. The sacred interface. Zero runtime deps. NO electron.
│   │   ├── src/
│   │   │   ├── BrowserEngine.ts     #   the interface: openTab, evaluate, screenshot,
│   │   │   │                        #   dispatchInput, getA11yTree, onNavigate, ...
│   │   │   ├── types.ts             #   Tab, InputEvent, A11yNode, Screenshot, NavEvent
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── engine-electron/            # The ONLY tab/CDP package that imports electron.
│   │   ├── src/                    #   Implements BrowserEngine via WebContentsView + CDP.
│   │   │   ├── ElectronBrowserEngine.ts
│   │   │   ├── cdp/                 #   webContents.debugger attach, domain calls
│   │   │   ├── a11y/                #   Accessibility.getFullAXTree fetch + serialize
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── agent/                      # Depends ONLY on engine-core. NO electron, NO engine-electron.
│   │   ├── src/
│   │   │   ├── loop/                #   perceive → plan → act → verify
│   │   │   ├── perception/          #   a11y-tree → compact repr; vision-fallback trigger
│   │   │   ├── codegen/             #   model emits Playwright-style action code
│   │   │   ├── tools/               #   tool schemas exposed to the model
│   │   │   ├── llm/                 #   Anthropic client, streaming, BYO-key
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── trust/                      # Credential isolation, Hello gating, audit, policy.
│   │   ├── src/
│   │   │   ├── credentials/         #   DPAPI/safeStorage; inject-at-page (never to model)
│   │   │   ├── approval/            #   Windows Hello action gating
│   │   │   ├── audit/               #   append-only access log
│   │   │   ├── policy/              #   sensitive-action classifier
│   │   │   └── index.ts
│   │   └── package.json
│   │
│   ├── memory/                     # Local SQLite / markdown memory (inspectable files).
│   │   ├── src/
│   │   └── package.json
│   │
│   ├── shell/                      # Electron MAIN = composition root. Throwaway per tier.
│   │   ├── src/
│   │   │   ├── main.ts              #   app entry
│   │   │   ├── windows/             #   BrowserWindow / WebContentsView mgmt
│   │   │   ├── ipc/                 #   typed IPC bridge (main side)
│   │   │   ├── session/             #   partitions; ISOLATED agent profile
│   │   │   ├── updater/             #   electron-updater
│   │   │   └── bootstrap.ts         #   wires engine-electron + agent + trust + memory
│   │   └── package.json
│   │
│   ├── ui/                         # React renderer. NO electron main, NO node.
│   │   ├── src/
│   │   │   ├── chrome/              #   tab strip, vertical tabs, custom title bar
│   │   │   ├── omnibox/             #   Search / Ask-AI toggle
│   │   │   ├── sidebar/             #   AI panel, chat-with-tabs
│   │   │   ├── command-palette/
│   │   │   ├── ipc/                 #   preload-exposed API client (renderer side)
│   │   │   └── main.tsx
│   │   └── package.json
│   │
│   └── shared/                     # Cross-cutting pure types/utils. NO electron.
│       ├── src/
│       └── package.json
│
├── native/                        # Native addons (N-API / napi-rs).
│   ├── windows-hello/              #   biometric/PIN prompt bridge
│   └── dpapi/                      #   only if safeStorage proves insufficient
│
├── config/
│   ├── eslint/
│   └── tsconfig/
│
├── scripts/                       # build, sign, release helpers
│
├── test/
│   └── redteam/                   # BioShocking-style prompt-injection suite (CI gate)
│
└── benchmarks/
    └── online-mind2web/           # reliability harness (track honestly)
```

---

## Package responsibilities & allowed dependencies

| Package | Role | May import | May **NOT** import |
|---|---|---|---|
| `engine-core` | The `BrowserEngine` interface + types. Pure. | (nothing runtime) | electron, everything else |
| `engine-electron` | Electron/CDP implementation of the interface | `engine-core`, `shared`, `trust`, `native`, electron | `agent`, `ui`, `shell` |
| `agent` | Perceive→plan→act loop, a11y perception, codegen, LLM | `engine-core`, `shared` | **electron, engine-electron**, `shell`, `ui`, `trust`* |
| `trust` | Credential isolation, Hello gating, audit, policy | `shared`, `native`, electron (safeStorage) | `agent`, `ui` |
| `memory` | Local SQLite/markdown memory | `shared` | electron, `agent`, `ui` |
| `shell` | Electron main; composition root; wires everything | **all packages** | — (this is the only place that knows about everyone) |
| `ui` | React renderer | `shared` (types only) + IPC | electron main, node, `shell`, `agent`, `engine-electron`, `trust`, `memory` |
| `shared` | Pure cross-cutting types/utils | (nothing runtime) | electron, everything else |

\* **Why `agent` can't import `trust` directly:** the agent requests a *capability* (e.g. "log into site X" or "confirm this payment") through the `BrowserEngine` interface or an injected callback; `shell` wires the real `trust` implementation behind it. This keeps credential handling and Hello gating out of the portable agent code and in the composition root, where policy lives. If a tighter contract is wanted, add the approval/credential hooks to `engine-core` as interface methods (`requestApproval`, `injectCredential`) that `engine-electron` fulfills via `trust`.

---

## The enforcement (`.dependency-cruiser.js`)

This is the file that turns the boundary from a wiki page into a build failure. Run `pnpm depcruise` in CI.

```js
// .dependency-cruiser.js
module.exports = {
  forbidden: [
    {
      name: 'agent-no-electron',
      comment: 'The agent must be portable across engine tiers — never import electron.',
      severity: 'error',
      from: { path: '^packages/agent' },
      to:   { path: 'node_modules/electron' },
    },
    {
      name: 'agent-only-engine-core',
      comment: 'Agent talks to the engine ONLY through the pure interface.',
      severity: 'error',
      from: { path: '^packages/agent' },
      to:   { path: '^packages/engine-electron' },
    },
    {
      name: 'core-is-pure',
      comment: 'engine-core and shared must have zero electron/impl deps.',
      severity: 'error',
      from: { path: '^packages/(engine-core|shared)' },
      to:   { path: 'node_modules/electron' },
    },
    {
      name: 'ui-no-main',
      comment: 'Renderer never imports main-process code; use IPC + shared types.',
      severity: 'error',
      from: { path: '^packages/ui' },
      to:   { path: '^packages/(shell|engine-electron|agent|trust|memory)' },
    },
    {
      name: 'ui-no-electron-main',
      comment: 'Renderer must not reach into electron main.',
      severity: 'error',
      from: { path: '^packages/ui' },
      to:   { path: 'node_modules/electron' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.base.json' },
    doNotFollow: { path: 'node_modules' },
  },
};
```

> **The migration payoff:** when we later swap `engine-electron` for `engine-cef` (Tier 2) or `engine-chromium` (Tier 1), only `engine-*` and `shell` change. `agent`, `engine-core`, `shared`, and most of `ui` are untouched — and dependency-cruiser proves it, because nothing in `agent` was ever allowed to reach past `engine-core`.

---

## Suggested first commits (skeleton before features)
1. Workspace scaffold: pnpm + tsconfig references + empty packages with correct `package.json` dep declarations.
2. `.dependency-cruiser.js` + a CI check — **before** any real code, so the boundary is enforced from commit 1.
3. `engine-core/BrowserEngine.ts` interface + types (the contract everything builds against).
4. `engine-electron` minimal: open one `WebContentsView`, navigate, attach CDP debugger, return a screenshot.
5. `shell/main.ts` + `bootstrap.ts`: launch a window, mount `ui`, instantiate `ElectronBrowserEngine`.
6. `ui`: a single tab + omnibox that drives the engine through IPC.
7. Only then: the `agent` loop against `engine-core`.
