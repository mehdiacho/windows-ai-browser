# Windows-First AI Browser — Claude Code Handoff

> **Purpose of this document.** This is the single source of truth to hand to Claude Code before we start building. It captures the product thesis, the engine/architecture decision (and *why*), the full stack, the competitive research that informs the feature set, and the open questions to resolve in a planning session. Read top to bottom, then we'll turn "Build Plan (to define in Claude Code)" into an actual task graph.

---

## 1. Product Thesis

**What we're building:** A Windows-first AI browser for prosumers and Windows-heavy teams — an agentic browser that operates your logged-in sites directly (no integrations required), with trust architecture as a first-class differentiator.

**Why Windows-first:** The best agentic browsers are Mac-first or Mac-only. Aside is macOS-only with no Windows plan. Dia is macOS-only (Windows waitlisted, no date). ChatGPT Atlas was macOS-only and is being shut down (Aug 9, 2026). On Windows, the realistic options are Comet (cross-platform but privacy-questionable, ~80% agent reliability), Edge Copilot (enterprise-gated, M365-licensed), and Chrome Auto Browse (Google-AI-Pro-gated). **There is no polished, prosumer, trust-first agentic browser that is Windows-native.** That's the wedge.

**Design north stars:**
- Reference products: **Aside** (agent + credential isolation + local-first memory), **The Browser Company's Arc/Dia** (tab/workspace UX, Skills, @-mention context).
- Conservative, Chrome-like UX to minimize switching friction (Atlas's death and Arc's struggles both argue against radical UI reinvention).
- Trust as the headline feature, not an afterthought — because prompt injection is unsolved industry-wide.

---

## 2. Engine Decision: The Four Tiers

The single most consequential decision is **how we obtain the browser engine**, because it determines everything downstream. There are four realistic tiers. **We are starting at Tier 3 (Electron).** All four are documented here because our architecture is explicitly designed to allow progressive migration up the tiers as the team grows.

### Tier 1 — Full Chromium Fork
*(What Arc, Brave, Atlas, and Aside do.)*
- **What it is:** Clone Chromium, patch it, rebase against upstream (~every 4 weeks, forever).
- **Pros:** Total control — custom UI in the actual browser chrome, native extension support, profiles, the works. The "finished product" ceiling.
- **Cons:** ~100GB checkout, 16–32GB RAM builds, hours per build. A team-of-engineers commitment, not a solo project. UI is C++ (Views framework), though forks often render chunks of UI as web content.
- **Toolchain:** `depot_tools`, GN/Ninja, Visual Studio 2022 + Windows SDK, C++.
- **Verdict for us:** Ruled out for v1. A long-term destination, not a starting point.

### Tier 2 — CEF (Chromium Embedded Framework)
- **What it is:** Real Chromium rendering, but you build your own shell around prebuilt binaries instead of maintaining a fork.
- **Pros:** No monster builds. Feels like a "real" browser. UI in C++ or via bindings (CefSharp for C#).
- **Cons:** Heavier than Electron; more plumbing than Tier 3.
- **Verdict for us:** The natural **second** step — where we go if we outgrow Electron and want a more native footprint without committing to a full fork.

### Tier 3 — Electron + `WebContentsView` ← **WE START HERE**
- **What it is:** Each tab is a `WebContentsView`; the browser chrome (tab strip, sidebar, AI panel) is HTML/CSS/React. Chromium's engine underneath.
- **Pros:**
  - Chromium engine + session/profile management via `session.fromPartition()`.
  - **Native CDP access** via `webContents.debugger` — `Runtime.evaluate`, `Input.dispatchMouseEvent`, `Page.captureScreenshot`, `Accessibility.getFullAXTree`. This is the agent's control surface.
  - Claude Code is extremely strong at Electron + TypeScript + React — matters for our build plan.
  - Fast path to a working product.
- **Cons:**
  - No Chrome extension support out of the box (`electron-chrome-extensions` gives partial support).
  - ~2-week lag behind Chromium security patches.
  - Heavier RAM/battery than a native fork (expect the Arc/Comet-style complaints).
- **Verdict for us:** Correct starting tier. Validates the product; the part that actually matters (the agent layer) is CDP-based and ports upward.

### Tier 4 — WebView2 + WinUI 3
- **What it is:** The most "Windows-native" option. WebView2 ships with Windows 11; C#.
- **Pros:** Native Fluent aesthetic *for free* (Mica/Acrylic, Windows 11 chrome); tiny installer; deepest OS integration by default.
- **Cons:** Sacrifices CDP depth and multi-profile flexibility; fights you on everything browser-shaped (multi-webview orchestration, profile isolation); Claude Code fights WinUI XAML more than React.
- **Verdict for us:** Skip. Nativeness is earnable in Electron à la carte (see §4); we'd rather have full browser capability by default and buy nativeness per-feature.

> **Also noted:** *Tauri v2* uses WebView2 on Windows with a Rust backend — more native footprint than Electron — but its webview control is too shallow for a multi-tab agentic browser today. Exists; not for us now.

---

## 3. Progressive Scale-Up Strategy

Migration up the tiers is **viable but not free.** What ports cleanly depends entirely on architecture discipline in v1. Think of the browser as three layers:

| Layer | What it is | Portability across tiers |
|---|---|---|
| **Agent layer** | Reads pages, decides actions, clicks/types, manages memory, handles credentials | **Ports almost untouched** if built against CDP — Electron, CEF, and a full fork all speak CDP. This is the crown jewel. Keep it decoupled. |
| **Browser chrome UI** | Tab strip, sidebar, omnibox | React survives Tier 3→2 mostly intact; Tier 2→1 is rougher (fork UI is C++), but ~60–70% survives since forks render UI chunks as web content. |
| **Shell plumbing** | Window management, IPC, process model, updater, installer | **Rewritten each tier.** Accept as throwaway. |

**The discipline that makes this work:** Define an internal `BrowserEngine` interface (`openTab`, `evaluate`, `screenshot`, `dispatchInput`, `onNavigate`, …). The agent only ever talks to that interface — never to Electron APIs directly. Then tier migration becomes "reimplement the interface," not "rewrite the product." Teams get burned when Electron-specific APIs leak into agent logic everywhere.

**When to actually migrate (forcing functions, not prestige):** Chrome-extension parity, per-tab process control, memory footprint, or removing Electron's security-patch lag. **Many successful products never leave Tier 3.** Don't migrate until users hit a wall Electron can't fix.

---

## 4. "Native" on Windows — Two Kinds, Both Earnable in Electron

"Native" means two separable things:

- **Aesthetic nativeness:** Fluent design — Mica/Acrylic materials, native title-bar behavior, Windows 11 rounded corners/snap layouts, system context menus, Segoe UI Variable. Reachable in Electron via `backgroundMaterial` + native modules + frameless custom title bars. (Arc built a huge brand on *not* looking native — a distinctive identity can beat OS mimicry.)
- **Integration nativeness:** Jump lists, toast notifications via the real Windows notification center, share targets, default-browser registration + protocol handlers, **Windows Hello for auth**, Windows Credential Manager / DPAPI credential storage, taskbar previews, system media controls, startup/background tasks, Widgets. Electron ships some (jump lists, protocol handling, default-browser) out of the box; the rest come via small native Node addons (C++/Rust) or npm packages — a thin native bridge per feature.

**The real difference is defaults vs. effort:** WinUI gives 95% native for free but fights browser-shaped work; Electron gives 100% browser capability for free and makes you earn nativeness one bridge at a time. Since our differentiator is the **agent**, not the window dressing, Electron is right.

**Shortlist of native integrations that actually sell "Windows-first" (target these, not everything):**
1. Default-browser registration + protocol handlers.
2. Toast notifications (real Windows notification center).
3. **Windows Hello for approving sensitive agent actions** — biometric/PIN gate on payments, sends, logins. Mac-first competitors *cannot* offer this on Windows. Strong trust story.
4. Credential Manager / DPAPI–backed autofill (credentials injected into pages, never into the model).

---

## 5. The Stack (v1)

| Concern | Choice | Notes |
|---|---|---|
| **Shell** | Electron + TypeScript + React + Tailwind | Tab strip, vertical tabs, command bar, AI sidebar. Claude Code's strong suit. |
| **Tabs** | `WebContentsView` per tab | `session` partitions for profiles/containers. |
| **Agent control layer** | CDP via `webContents.debugger` | `Runtime.evaluate`, `Input.dispatchMouseEvent`, `Page.captureScreenshot`, `Accessibility.getFullAXTree`. **But** feed the model a curated **accessibility tree + code-generation loop**, with vision (screenshots+coordinates) as *fallback* — not raw-CDP prompting (see §7, this is where reliability is won/lost). |
| **AI** | Anthropic API (tool use / computer use), streaming to sidebar | BYO-key option like Aside to avoid inference costs. |
| **Memory** | Local SQLite (`better-sqlite3`) or plain markdown files on disk | History-as-memory is a great, inspectable feature (Aside stores editable markdown like `episodic/2026-06-21.md`). |
| **Credentials** | Windows DPAPI via Electron `safeStorage`; autofill into pages via CDP | No Secure Enclave on Windows; DPAPI/TPM is the equivalent. Model never sees secrets. |
| **Distribution** | `electron-builder` → NSIS installer; `electron-updater` for auto-updates | **Budget for an OV/EV code-signing cert (~$100–400/yr)** or Windows SmartScreen scares off every day-one user. |
| **Search/omnibox** | Proxy to a search engine + "Ask AI" mode toggle | Like Aside's omnibox. |
| **Extensions (v1)** | `electron-chrome-extensions`, curated top-~20 | Full Chrome Web Store parity is a heavy lift — de-scope to a curated set for v1. |

**Honest tradeoff of Electron:** no Chrome extensions out of the box, and some sites sniff user agents oddly. If those become dealbreakers post-traction, graduate to CEF/fork — but the agent layer ports either way.

---

## 6. Competitive Research Findings (condensed)

*As of early-mid July 2026. Vendor benchmark claims are self-reported/self-graded and not independently reproduced. Security is unsolved across the category.*

### The category is consolidating, not expanding
- **ChatGPT Atlas is being sunset Aug 9, 2026** (announced Jul 9), ~9 months after macOS launch — folding into the ChatGPT desktop app + a Chrome extension. Lesson: a standalone AI browser is hard to sustain; "the assistant, not the browser" may be where users live.
- **Arc** is frozen (maintenance mode). The Browser Company pivoted to **Dia** and was **acquired by Atlassian ($610M, Sept 2025)**; CEO noted "Windows is about to get a lot more attention."
- Survivors are either free-and-cross-platform (Comet) or ecosystem-attached (Edge, Chrome, Dia/Atlassian). **A differentiated wedge beats matching feature checklists.**

### Agent capability is the competitive axis, but reliability is mediocre
- Best consumer browsers top out ~**80%** on everyday live-site tasks; shopping/checkout and multi-step flows fail routinely.
- Vendor self-reported numbers (Aside's 99% on Online-Mind2Web) run far ahead of independent leaderboards (Browser Use Cloud ~97% is top tracked).

### Security is the structural weakness (and our opportunity)
- **Indirect prompt injection is unsolved.** LayerX's "BioShocking" attack (Jun 29, 2026) fooled **all six** tested agentic browsers/assistants (Atlas, Comet, Anthropic's Claude Chrome extension, Fellou, Genspark, Sigma) — every agent failed to recognize the credential-compromise step as a guardrail violation. OpenAI fixed it in Atlas; Perplexity closed the report without acting; Anthropic's patch reportedly failed; three smaller vendors didn't respond.
- Earlier: **CometJacking** (Aug 2025) could exfiltrate Gmail/Calendar via a crafted URL (Perplexity called it "no security impact"). Atlas hit by "Tainted Memories" CSRF memory-injection (Oct 2025).
- **Takeaway:** trust architecture (credential isolation, human-in-the-loop, audit logs, sandboxing) is a genuine differentiator competitors treat as an afterthought. Do **not** promise safety — ship layered mitigations and be honest about residual risk.

### Per-browser one-liners
- **Aside** (macOS-only, YC F25): agent operates logged-in sites directly; on-device markdown memory; "password manager for agents" (credentials autofilled, never exposed to AI); per-task scoped access + audit log. **Custom Chromium fork.** Its agent is a *coding agent* (JS REPL + bash, writes Playwright JS) driving a curated a11y tree — its founder **explicitly argues against raw CDP** ("LLMs aren't trained on it, wastes tokens"). Benchmarks are self-graded. No Windows plan.
- **Dia** (The Browser Company, macOS-only): assistive, not agentic — "chat with your tabs" via @-mentions, **Skills** (reusable prompt shortcuts + community gallery), Memory, meeting tab-groups. Windows waitlisted. Dia Pro $20/mo.
- **Comet** (Perplexity, cross-platform incl. Windows): agentic browsing + assistant sidebar; connectors *and* direct page operation; **went free Oct 2025**; ~18M MAU. Reliability ~80%; privacy-questionable (stated intent to build ad profiles).
- **Atlas** (OpenAI, macOS-only, dying Aug 2026): ChatGPT sidebar + Agent Mode; comparatively strong safety (only vendor to fix BioShocking); Windows/mobile promised, never shipped.
- **Arc** (maintenance mode): the reference for tab/workspace UX — Spaces, vertical tabs/sidebar, Command Bar, Split View, auto-archiving. Not agentic.
- **Opera Neon** (Windows + macOS, subscription): agent pillars Chat / Do (agentic in live session) / Make (generative apps via cloud VM); Tasks, Cards, ODRA research; **MCP connector** lets external AI clients act in-session.
- **Brave + Leo** (widest platform coverage incl. Windows/Linux): privacy-first assistant; **BYOM incl. local models via Ollama**; agentic "AI browsing" in an **isolated profile**; best-in-class privacy framing. Leo Premium $15/mo.

### Feature tiers

**TABLE STAKES (v1 must-haves):** Chromium base + Chrome-extension compat; one-click import (bookmarks/passwords/history/extensions); page-context AI sidebar; chat-with-your-tabs (cross-tab synthesis / @-mentions); page/video/PDF summarization; inline writing assistance; a visible, interruptible agent operating logged-in pages with **human-in-the-loop on sensitive actions**; model choice (ideally BYO-key); basic privacy controls (per-site AI toggle, incognito, "AI can't see this page"); vertical tabs/sidebar + command palette; cross-device sync.

**DIFFERENTIATORS (drive word-of-mouth):** agent + **credential isolation** ("password manager for agents"); full audit trail + scoped per-task permissions; **local-first execution/memory**; BYOM incl. local models; **Skills** + shareable gallery; @-mention tab/history context; auto-organized meeting tab-groups / Morning Brief; **MCP connector** (external clients act in-session); generative "Make"; long-horizon autonomous mode; verifiable/unlinkable privacy.

**SKIPPABLE (low usage/praise or expensive):** voice mode; generative build-me-a-game/site; in-house frontier model; bundled VPN/crypto wallet; aggressive UI reinvention; metered cloud-credit billing without spend visibility; standalone mobile app at v1.

### The Windows white space
- **(a) Underserved on Windows:** a polished prosumer agentic browser; local-first privacy (Windows TPM/Hello/DPAPI unexploited by any AI browser); credential-isolated agent + audit trail.
- **(b) Windows-only opportunities competitors can't reach:** **Windows Hello for agent action approval**; Windows-heavy corporate/internal-tool workflows (internal dashboards, SharePoint, Teams, ERP/CRM web UIs — exactly where "operate the page, no integrations" is most valuable and Aside/Mac can't play); native integration (Entra ID SSO, Intune/MDM, Group Policy, DPAPI/TPM); **Windows UIA accessibility tree** (a CDP+UIA hybrid could operate beyond web pages).
- **(c) Table-stakes hardest to build solo on Electron (de-scope candidates):** the agent harness itself (hardest part — use a11y-tree + code-gen, not raw CDP); stealth/anti-bot rendering; prompt-injection defense (unsolved — ship layered mitigations); Chrome-parity extensions + sync (curate top-20, defer full sync); native-parity performance (accept Electron overhead at v1).

### Two models for operating logged-in sites
- **Integrations/connectors** (Comet, Dia, Opera MCP): reliable, API-based, but limited to supported services; OAuth widens attack surface (CometJacking).
- **Direct page operation** (Aside, Comet fallback, Neon Do, Edge/Chrome agents): universal (any site incl. internal tools), no wiring, but slower/brittle and the prompt-injection vector. **Market is converging here** — making credential isolation + human-in-the-loop the essential safety pairing.

### Benchmarks (for honest positioning)
- **Online-Mind2Web** (OSU): 300 live tasks; public top ~97% (Browser Use Cloud); Aside self-reports 99% (self-graded).
- **BU-Bench-V1**: Aside self-reports 93%. **Odysseys** (CMU long-horizon): Aside self-reports 75.5% perfect-task rate.
- If we benchmark, **submit to the public leaderboard** rather than self-grading.

---

## 7. Architecture Principles (carry into every Claude Code task)

1. **`BrowserEngine` abstraction is sacred.** Agent logic talks only to this interface, never to Electron APIs directly. This is what makes Tier 3→2→1 migration "reimplement the interface" instead of "rewrite the product."
2. **Agent = curated accessibility tree + code-generation loop, vision as fallback.** Do *not* feed raw DOM or raw CDP to the model. Wrap CDP in a Playwright-style API; give the model a compact a11y tree and let it generate code. This mirrors current SOTA and is where reliability lives or dies.
3. **Credentials never enter model context.** Inject at the page/proxy layer via DPAPI/`safeStorage`. The model operates the page; it never sees the secret.
4. **Human-in-the-loop is real, not marketing.** Sensitive actions (payments, sends, posts, logins) gate on explicit confirmation — ideally **Windows Hello**. Build the checkpoint into the agent loop, not the copy.
5. **Isolated agent profile.** Run the agent in a separate `session` partition (Brave's pattern) to contain prompt-injection blast radius.
6. **Don't promise safety.** Ship layered mitigations (isolated profile, egress allowlisting, credential-injection-at-proxy, mandatory confirmation on account reads) and be honest about residual risk. Every competitor failed BioShocking.
7. **Conservative, Chrome-like UX.** Minimize switching friction. Distinctive identity is fine; radical paradigm reinvention is a churn risk.

---

## 8. Build Plan (to define in Claude Code)

*This is the scaffold we'll turn into a real task graph in the planning session. Staged from the research's recommended roadmap.*

### Stage 1 — v1 wedge (0–6 mo): "The trustworthy Windows agentic browser"
- [ ] Electron + TS + React shell; `WebContentsView`-per-tab; session partitions.
- [ ] `BrowserEngine` interface defined and enforced (agent decoupled from shell).
- [ ] Tab strip + vertical tabs + command palette; conservative Chrome-like chrome.
- [ ] Omnibox with Search / Ask-AI toggle.
- [ ] Import (bookmarks/passwords/history) from Chrome/Edge.
- [ ] `electron-chrome-extensions` with curated top-~20 extensions.
- [ ] Page-context AI sidebar (summarize, Q&A) streaming from Anthropic API; BYO-key.
- [ ] Chat-with-your-tabs (cross-tab context).
- [ ] Agent layer: CDP wrapped in Playwright-style API; curated a11y tree + code-gen loop; vision fallback.
- [ ] **Trust wedge:** credential injection at proxy (DPAPI/`safeStorage`); **Windows Hello** confirmation on sensitive actions; full agent audit log; isolated agent profile.
- [ ] Local memory (SQLite or markdown files).
- [ ] Per-site AI visibility toggle; incognito; "AI can't see this page."
- [ ] `electron-builder` NSIS installer + `electron-updater`; **OV/EV code-signing cert**.
- [ ] *De-scoped for v1:* voice, generative Make, in-house model, full sync, mobile, native-parity perf.

### Stage 2 — differentiate (6–12 mo)
- [ ] Local-first execution/memory on Windows TPM/DPAPI.
- [ ] Skills-style reusable shortcuts + shareable gallery.
- [ ] @-mention tab/history context.
- [ ] MCP connector (external clients act in-session).
- [ ] Harden reliability on Windows-heavy corporate/internal-tool workflows (dashboards, SharePoint, Teams, ERP/CRM web UIs).

### Stage 3 — enterprise (12+ mo)
- [ ] Entra ID SSO; Intune/MDM deployment; Group Policy; DLP hooks; admin console.

### Tripwires that should change the plan
- **If Comet or Edge ships a polished, trusted Windows consumer agent with credential isolation** → pivot harder into Windows-native corporate/internal-tool operation.
- **If agent reliability on our internal-tool suite can't exceed ~85–90%** (held-out tasks) → keep the agent human-supervised; market "assisted," not "autonomous."
- **If prompt-injection mitigations fail our own red-team** → don't enable autonomous account-read actions by default.
- **If Chrome-extension incompatibility drives early churn** → prioritize full Web Store parity over new AI features.

---

## 9. Open Questions for the Planning Session
1. **Monorepo structure** — how do we physically separate `agent/`, `engine/`, `shell/`, `ui/` so the `BrowserEngine` boundary is enforced by the module graph, not just convention?
2. **BYO-key vs. bundled inference** at launch — which first, and how do we meter/track spend visibly (Aside users complained about opaque credit burn)?
3. **a11y-tree serialization format** — what compact representation do we feed the model, and how do we handle sites the DOM can't drive (vision fallback trigger)?
4. **Confirmation UX** — exactly which action classes gate on Windows Hello, and how do we classify "sensitive" reliably?
5. **Extension shortlist** — which ~20 extensions ship at v1?
6. **Red-team harness** — how do we stand up a BioShocking-style prompt-injection test suite early, as a CI gate on the agent?
7. **Benchmark plan** — do we wire up Online-Mind2Web against our own harness from the start to track reliability honestly?

---

*Next step: open this in Claude Code and turn §8 + §9 into a concrete task graph and repo scaffold.*
