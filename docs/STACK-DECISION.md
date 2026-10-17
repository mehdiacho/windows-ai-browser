# Stack Decision: Electron vs Rust vs C/C++

*2026-10-16. Context: Claude writes and runs all the code. Mehdi needs transferable engineering principles, not fluency in a given language. The repo already has a smoke-tested vertical slice on Electron (engine-electron uses WebContentsView + CDP, React chrome, and the `BrowserEngine` boundary is enforced by dependency-cruiser).*

## Options compared

| Criterion | **Electron + TS/React (current)** | **Rust: Tauri 2 / WebView2** | **Rust native shell (wry/raw WebView2 + egui/Win32)** | **C++: CEF** | **C++: native WebView2 + Win32/WinUI** |
|---|---|---|---|---|---|
| Engine on Windows | Bundled Chromium, one `WebContentsView` per tab | System WebView2 (Edge Chromium) | System WebView2 | Bundled Chromium (CEF) | System WebView2 |
| Agent control surface (CDP) | Full: `webContents.debugger` gives the whole protocol per tab, in-process | Partial: `CallDevToolsProtocolMethod` plus event receivers via webview2-com. Usable, but Tauri's webview API is not built for many tabs | Same as Tauri, with more manual plumbing | Full: CDP via `SendDevToolsMessage`, also remote-debugging | Same as Tauri (WebView2 CDP) |
| Multi-tab and profile isolation | Mature: `session.fromPartition`, per-tab views | Weak: Tauri multiwebview is still marked unstable. WebView2 profiles exist but you assemble them yourself | DIY | Strong: `CefRequestContext` per profile | Doable but fiddly |
| Memory / startup | Worst. Roughly 150–300 MB baseline and ~1 s cold start. The Arc/Comet complaints apply | Best installer (~10 MB) and a light shell. Pages still run in the Edge runtime, so per-tab memory is about equal | Same as Tauri | Heavy (bundled Chromium). About equal to Electron | Light |
| Trust features (Hello, DPAPI, Credential Manager) | `safeStorage` already uses DPAPI. Windows Hello needs a small native addon (C++ or Rust via napi-rs) | First-class: the `windows` crate calls WinRT `UserConsentVerifier` and DPAPI directly. Memory-safe code where secrets live | First-class | Direct Win32/WinRT calls, but no memory safety around secrets | Direct calls |
| Security patch cadence | About 2 weeks behind Chromium | Evergreen WebView2, patched by Microsoft (best) | Evergreen | Tracks CEF releases | Evergreen |
| Chrome extensions | Partial (`electron-chrome-extensions`) | WebView2 has basic extension support only. Weaker | Weaker | Partial | Weaker |
| Agent tooling (LLM SDKs, a11y→code-gen, Playwright-style API) | Best. Anthropic TS SDK, Playwright idioms, and JS code-gen sandboxes are native here | Good Rust SDKs, but code-gen still needs a JS runtime | Same | Poor, everything bridged | Poor |
| Claude build velocity | Highest. The slice already works | Medium. Rust compile times, WebView2 COM interop | Low | Low: C++ + CMake + CEF binaries, slow debug loop | Low |
| Ecosystem / hiring | Huge | Growing | Small | Niche | Niche |
| Transferable principles for Mehdi | Interfaces and ports, process isolation, IPC contracts, dependency rules | Same, plus ownership/memory safety | Same | Manual memory and lifetimes (less transferable value per hour) | Same as CEF |

## Recommendation: stay on Electron and harden the trust layer in Rust

1. **Keep Electron + TS/React as the shell and agent host.** CDP depth and per-tab session isolation decide what the product can do, and Electron is the only option that gives both without extra work. The vertical slice is already proven, and principle #1 (the `BrowserEngine` boundary) holds no matter which engine sits behind it.
2. **Write the native trust bridges in Rust (napi-rs), not C++.** Windows Hello (`UserConsentVerifier`), DPAPI and Credential Manager go in `native/windows-hello` and `native/dpapi` as small Rust addons. Credential handling is the differentiator, so it should run in memory-safe code, and these bridges carry over unchanged if the shell ever changes.
3. **Revisit only on a real forcing function** (per HANDOFF §3): users complain about memory, extension parity becomes a blocker, or the 2-week patch lag becomes a problem. If that happens, the next step is **CEF**, which is the only alternative with equal CDP and profile depth. Tauri/WebView2 does not get you there.
4. **Not recommended:** a plain C/C++ shell (slowest velocity, no safety gain), and Tauri as the main shell for now (its multi-webview support is unstable, and a browser *is* multi-webview).

No migration is needed. The build continues on Electron.

## HANDOFF §9 open questions, answered with defaults

HANDOFF.md lists **seven** questions, not nine. All seven are answered below. Questions marked ★ change the product, so Mehdi should confirm them. The rest are engineering defaults.

1. **Monorepo boundary enforcement.** *Resolved.* pnpm workspaces plus dependency-cruiser as a CI gate. `agent` cannot import `electron` or `engine-electron` (see REPO-STRUCTURE.md).
2. ✅ **BYO-key vs bundled inference.** *Decided 2026-10-17:* **BYO Anthropic key at launch**, stored with DPAPI. A visible per-task and per-day spend meter is built from token counts in the API response. Bundled inference is deferred until there are paying users. *Product impact: decides who can try it (developers and prosumers only) and whether there is a billing system.*
3. **a11y-tree serialization.** Default: a compact indented outline (`role "name" [ref]` plus key states), with interactive and landmark nodes only. Off-screen subtrees are collapsed, with a budget of about 4k tokens. Elements are addressed by opaque `NodeRef`s (already built). Vision fallback triggers when the tree has fewer than N interactive nodes, contains a canvas/iframe the agent can't reach, or after two failed actions on the same ref.
4. ✅ **Confirmation UX / what gates on Windows Hello.** *Decided 2026-10-17:* Hello is required for **payments/checkout, sending messages or email, posting publicly, credential autofill/login, and account or security setting changes**. Everything else gets an inline confirm or no gate. The classifier is a rule list (form purpose, button text, URL patterns, `autocomplete=cc-*`/`password`) that fails closed: uncertain means gate. *Product impact: the friction-vs-trust dial is the product's personality.*
5. ✅ **Extension shortlist.** *Decided 2026-10-17:* **ship no extensions in v1.** Then add a curated set in this order: a password manager (Bitwarden), an ad blocker (uBlock Origin Lite), a dark mode, and Grammarly-type extensions, depending on what `electron-chrome-extensions` supports. *Product impact: switching friction for Chrome users.*
6. **Red-team harness.** Default: a local fixture site with BioShocking/CometJacking-style injected pages, run through `pnpm smoke`-style e2e. The CI gate fails if the agent fills a credential or takes a gated action without approval. Build it before the agent loop goes beyond read-only.
7. **Benchmark plan.** Default: no. Build a small internal-tool task suite first (this matches the Windows-corporate wedge). Run Online-Mind2Web after the loop is stable, and submit to the public leaderboard instead of grading ourselves.

### Two more implicit decisions (the brief mentioned nine)
8. **Memory store.** Markdown files on disk first (inspectable, no native build). SQLite (better-sqlite3) is deferred.
9. ✅ **Code signing.** *Decided 2026-10-17: no paid certificate for now.* There is no free way to get a publicly trusted signature that SmartScreen accepts. These are the zero-cost paths:
   - **Now (Mehdi's own machines):** sign builds with a self-signed certificate (`New-SelfSignedCertificate -Type CodeSigningCert`) and import it into that PC's Trusted Root and Trusted Publishers stores. It's trusted only on machines where you install it, and it does nothing for anyone else.
   - **Public release, later:** ship through the **Microsoft Store** as MSIX. The Store signs the package itself, so users get no SmartScreen warning. Registration as an individual developer is currently free (check this at signup). This is the default public route.
   - **If the repo is ever open-sourced:** SignPath Foundation signs OSS projects for free.
   - An unsigned NSIS installer still works, but every user sees "Windows protected your PC" until the download builds reputation.

**Status:** Mehdi confirmed #2, #4 and #5 on 2026-10-17. For #9, signing stays free for now: self-signed for local builds, Microsoft Store for a public release.
