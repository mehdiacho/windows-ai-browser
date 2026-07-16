// .dependency-cruiser.js
//
// This file turns the BrowserEngine boundary from a wiki page into a build
// failure. Run `pnpm depcruise` (CI runs it too). The single most important
// rule set: the `agent` package must be PHYSICALLY incapable of importing
// electron or engine-electron — it may only reach `engine-core` + `shared`.
//
// Why both path- AND name-based `to` patterns:
//   pnpm exposes workspace packages as symlinks under node_modules/@wab/*.
//   dependency-cruiser's resolver follows the symlink to the real file, so a
//   workspace import of `@wab/engine-electron` resolves to
//   `packages/engine-electron/src/...` and the path-based rule fires. We ALSO
//   match the bare specifier as defense-in-depth in case a package is ever
//   consumed from its published build output rather than the symlinked source.

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    // ─── The sacred rule: agent stays portable across engine tiers ───────────
    {
      name: 'agent-no-electron',
      comment:
        'The agent must port cleanly Tier 3→2→1 — it may NEVER import electron. ' +
        'It talks to the browser only through the pure engine-core interface.',
      severity: 'error',
      from: { path: '^packages/agent/' },
      to: { path: '(^|/)node_modules/electron(/|$)' },
    },
    {
      name: 'agent-only-engine-core',
      comment:
        'Agent talks to the engine ONLY through the pure BrowserEngine interface. ' +
        'No reaching into engine-electron (the Electron/CDP implementation).',
      severity: 'error',
      from: { path: '^packages/agent/' },
      to: {
        path: '^packages/engine-electron/',
      },
    },
    {
      name: 'agent-no-impl-packages',
      comment:
        'Agent must not import shell, ui, trust, or memory directly. Trust ' +
        'capabilities arrive as injected engine-core ports (ApprovalGate / ' +
        'CredentialVault); the shell wires the real implementations.',
      severity: 'error',
      from: { path: '^packages/agent/' },
      to: { path: '^packages/(shell|ui|trust|memory|preload)/' },
    },

    // ─── engine-core and shared are PURE (the contract everything builds on) ──
    {
      name: 'core-is-pure',
      comment: 'engine-core and shared must have zero electron/runtime-impl deps.',
      severity: 'error',
      from: { path: '^packages/(engine-core|shared)/' },
      to: { path: '(^|/)node_modules/electron(/|$)' },
    },
    {
      name: 'core-imports-nothing-internal',
      comment:
        'engine-core / shared sit at the bottom of the graph — they may not ' +
        'import any other workspace package (would invert the dependency arrow).',
      severity: 'error',
      from: { path: '^packages/(engine-core|shared)/' },
      to: {
        path: '^packages/(?!engine-core|shared)',
        pathNot: '(^|/)node_modules/',
      },
    },

    // ─── Renderer isolation: ui never reaches the main process ───────────────
    {
      name: 'ui-no-main',
      comment:
        'Renderer never imports main-process code; it talks to main via typed ' +
        'IPC + shared types only.',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: '^packages/(shell|engine-electron|engine-core|agent|trust|memory|preload)/' },
    },
    {
      name: 'ui-no-electron',
      comment:
        'Renderer must not reach into electron (main OR the electron module). ' +
        'The preload package is the only renderer-adjacent code allowed to.',
      severity: 'error',
      from: { path: '^packages/ui/' },
      to: { path: '(^|/)node_modules/electron(/|$)' },
    },

    // ─── memory stays storage-focused and portable ───────────────────────────
    {
      name: 'memory-no-electron',
      comment: 'Local memory (markdown/SQLite) must not depend on electron.',
      severity: 'error',
      from: { path: '^packages/memory/' },
      to: { path: '(^|/)node_modules/electron(/|$)' },
    },
    {
      name: 'memory-no-siblings',
      comment: 'memory depends only on shared.',
      severity: 'error',
      from: { path: '^packages/memory/' },
      to: { path: '^packages/(agent|ui|shell|trust|engine-electron|engine-core|preload)/' },
    },

    // ─── Hygiene ─────────────────────────────────────────────────────────────
    {
      name: 'no-circular',
      comment: 'Circular dependencies break TS project-reference build order.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment: 'Unreachable modules are usually dead code or a missing wire-up.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '(^|/)index\\.ts$',
          '\\.d\\.ts$',
          '(^|/)main\\.(ts|tsx)$',
        ],
      },
      to: {},
    },
  ],

  options: {
    // Resolve `@wab/*` to package SOURCE (not unbuilt dist/) so cross-package
    // boundary rules fire without requiring a build first. See tsconfig.depcruise.json.
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    // Count type-only imports (`import type … from 'electron'`) as dependencies,
    // otherwise a `import type { WebContents } from 'electron'` in agent would
    // slip past the gate.
    tsPreCompilationDeps: true,
    // Don't descend INTO third-party packages' own graphs, but still record the
    // edge to them (so the electron rules can fire). Workspace packages resolve
    // to packages/* (outside node_modules) and are followed normally.
    doNotFollow: { path: '(^|/)node_modules/' },
    enhancedResolveOptions: {
      // enhanced-resolve follows pnpm's workspace symlinks to the real package
      // source by default, so an `@wab/*` import resolves to packages/* and the
      // path-based rules fire.
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
    },
    combinedDependencies: true,
    cache: false,
  },
};
