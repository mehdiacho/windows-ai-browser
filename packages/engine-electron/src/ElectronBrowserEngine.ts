// ElectronBrowserEngine — the Tier-3 implementation of the engine-core
// contract: WebContentsView per tab, CDP (webContents.debugger) for perception
// and input. Everything electron-shaped stays behind this wall.

import { WebContentsView } from 'electron';
import { asTabId, err, ok, type Result } from '@wab/shared';
import type {
  A11ySnapshot,
  BrowserEngine,
  EngineError,
  InputEvent,
  NavEvent,
  NodeRef,
  OpenTabOptions,
  Screenshot,
  Tab,
  TabId,
  Unsubscribe,
} from '@wab/engine-core';
import { CdpSession } from './cdp/CdpSession.js';
import { serializeA11yTree, type RawAXNode, type RefMap } from './a11y/serializeA11y.js';

/**
 * The shell owns windows and layout; the engine only creates views and hands
 * them over. Keeping layout out of the engine keeps the engine portable-shaped.
 */
export interface ViewHost {
  attach(view: WebContentsView): void;
  detach(view: WebContentsView): void;
}

export interface ElectronEngineOptions {
  readonly host: ViewHost;
  /** Session partition for tabs unless overridden per-tab (isolated agent profile). */
  readonly defaultPartition?: string;
}

interface TabRecord {
  id: TabId;
  view: WebContentsView;
  cdp: CdpSession;
  /** Ref maps are only valid for the snapshot that produced them. */
  snapshots: Map<string, RefMap>;
}

const engineErr = (code: EngineError['code'], message: string): Result<never, EngineError> =>
  err({ code, message });

export function createElectronBrowserEngine(options: ElectronEngineOptions): BrowserEngine {
  const tabs = new Map<TabId, TabRecord>();
  const navHandlers = new Set<(e: NavEvent) => void>();
  let tabCounter = 0;
  let snapshotCounter = 0;

  const emitNav = (e: NavEvent): void => {
    for (const h of navHandlers) h(e);
  };

  const toTab = (rec: TabRecord): Tab => {
    const wc = rec.view.webContents;
    return {
      id: rec.id,
      url: wc.getURL(),
      title: wc.getTitle(),
      loading: wc.isLoading(),
      ready: !wc.isLoading() && wc.getURL() !== '',
    };
  };

  const getRec = (tabId: TabId): TabRecord | undefined => {
    const rec = tabs.get(tabId);
    if (!rec || rec.view.webContents.isDestroyed()) return undefined;
    return rec;
  };

  const waitForLoad = (rec: TabRecord): Promise<void> =>
    new Promise((resolve, reject) => {
      const wc = rec.view.webContents;
      const cleanup = (): void => {
        wc.removeListener('did-finish-load', onDone);
        wc.removeListener('did-fail-load', onFail);
      };
      const onDone = (): void => { cleanup(); resolve(); };
      const onFail = (_e: unknown, code: number, desc: string): void => {
        cleanup();
        // -3 (ABORTED) fires on redirects/in-page cancels — not a real failure.
        if (code === -3) resolve();
        else reject(new Error(`load failed (${code}): ${desc}`));
      };
      wc.on('did-finish-load', onDone);
      wc.on('did-fail-load', onFail);
    });

  /** Resolve a ref against a snapshot, or explain why we can't. */
  const resolveRef = (
    rec: TabRecord,
    ref: NodeRef,
  ): Result<number, EngineError> => {
    for (const refs of rec.snapshots.values()) {
      const backendId = refs.get(ref);
      if (backendId !== undefined) return ok(backendId);
    }
    return engineErr('stale-ref', `ref ${ref} not found in any live snapshot — re-perceive`);
  };

  const centerOf = async (
    rec: TabRecord,
    backendId: number,
  ): Promise<Result<{ x: number; y: number }, EngineError>> => {
    try {
      await rec.cdp.send('DOM.getDocument', { depth: 0 });
      await rec.cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: backendId });
      const { quads } = await rec.cdp.send<{ quads: number[][] }>('DOM.getContentQuads', {
        backendNodeId: backendId,
      });
      const quad = quads[0];
      if (!quad || quad.length < 8) {
        return engineErr('ref-not-actionable', 'node has no layout box (hidden or detached)');
      }
      // Quad = [x1,y1, x2,y2, x3,y3, x4,y4]; average the corners.
      const x = (quad[0]! + quad[2]! + quad[4]! + quad[6]!) / 4;
      const y = (quad[1]! + quad[3]! + quad[5]! + quad[7]!) / 4;
      return ok({ x, y });
    } catch (e) {
      return engineErr('ref-not-actionable', `could not locate node: ${String(e)}`);
    }
  };

  const clickAt = async (rec: TabRecord, x: number, y: number, button: string): Promise<void> => {
    const base = { x, y, button, clickCount: 1 };
    await rec.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mousePressed' });
    await rec.cdp.send('Input.dispatchMouseEvent', { ...base, type: 'mouseReleased' });
  };

  const pressKey = async (rec: TabRecord, key: string): Promise<void> => {
    // Minimal named-key map for the common flow keys; extend as the agent needs.
    const known: Record<string, { keyCode: number; code: string; text?: string }> = {
      Enter: { keyCode: 13, code: 'Enter', text: '\r' },
      Tab: { keyCode: 9, code: 'Tab' },
      Escape: { keyCode: 27, code: 'Escape' },
      Backspace: { keyCode: 8, code: 'Backspace' },
      ArrowDown: { keyCode: 40, code: 'ArrowDown' },
      ArrowUp: { keyCode: 38, code: 'ArrowUp' },
    };
    const k = known[key];
    if (k) {
      await rec.cdp.send('Input.dispatchKeyEvent', {
        type: k.text !== undefined ? 'keyDown' : 'rawKeyDown',
        windowsVirtualKeyCode: k.keyCode,
        nativeVirtualKeyCode: k.keyCode,
        key,
        code: k.code,
        ...(k.text !== undefined ? { text: k.text } : {}),
      });
      await rec.cdp.send('Input.dispatchKeyEvent', {
        type: 'keyUp',
        windowsVirtualKeyCode: k.keyCode,
        nativeVirtualKeyCode: k.keyCode,
        key,
        code: k.code,
      });
    } else if (key.length === 1) {
      await rec.cdp.send('Input.insertText', { text: key });
    } else {
      throw new Error(`unsupported key: ${key}`);
    }
  };

  return {
    async openTab(opts?: OpenTabOptions): Promise<Result<Tab, EngineError>> {
      const partition = opts?.partition ?? options.defaultPartition ?? 'persist:default';
      const view = new WebContentsView({
        webPreferences: {
          partition,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          // Agent tabs keep working (and stay screenshot-able) while occluded.
          backgroundThrottling: false,
        },
      });
      const id = asTabId(`tab-${++tabCounter}`);
      const rec: TabRecord = { id, view, cdp: new CdpSession(view.webContents), snapshots: new Map() };
      tabs.set(id, rec);
      options.host.attach(view);

      const wc = view.webContents;
      wc.on('did-start-navigation', (_e, url, isInPlace, isMainFrame) => {
        if (isMainFrame && !isInPlace) emitNav({ tabId: id, url, kind: 'started' });
      });
      wc.on('did-navigate', (_e, url) => emitNav({ tabId: id, url, kind: 'committed' }));
      wc.on('did-finish-load', () => emitNav({ tabId: id, url: wc.getURL(), kind: 'finished' }));
      wc.on('did-fail-load', (_e, code, _d, url) => {
        if (code !== -3) emitNav({ tabId: id, url, kind: 'failed' });
      });

      if (opts?.url) {
        try {
          const loaded = waitForLoad(rec);
          void wc.loadURL(opts.url);
          await loaded;
        } catch (e) {
          return engineErr('navigation-failed', String(e));
        }
      }
      return ok(toTab(rec));
    },

    async closeTab(tabId: TabId): Promise<Result<void, EngineError>> {
      const rec = getRec(tabId);
      if (!rec) return engineErr('no-such-tab', `no tab ${tabId}`);
      rec.cdp.detach();
      options.host.detach(rec.view);
      rec.view.webContents.close();
      tabs.delete(tabId);
      return ok(undefined);
    },

    async listTabs(): Promise<readonly Tab[]> {
      return [...tabs.values()]
        .filter((r) => !r.view.webContents.isDestroyed())
        .map(toTab);
    },

    async navigate(tabId: TabId, url: string): Promise<Result<Tab, EngineError>> {
      const rec = getRec(tabId);
      if (!rec) return engineErr('no-such-tab', `no tab ${tabId}`);
      try {
        const loaded = waitForLoad(rec);
        void rec.view.webContents.loadURL(url);
        await loaded;
        // Old snapshots are meaningless on a new document.
        rec.snapshots.clear();
        return ok(toTab(rec));
      } catch (e) {
        return engineErr('navigation-failed', String(e));
      }
    },

    async getA11yTree(tabId: TabId): Promise<Result<A11ySnapshot, EngineError>> {
      const rec = getRec(tabId);
      if (!rec) return engineErr('no-such-tab', `no tab ${tabId}`);
      try {
        await rec.cdp.send('Accessibility.enable');
        const { nodes } = await rec.cdp.send<{ nodes: RawAXNode[] }>(
          'Accessibility.getFullAXTree',
        );
        const serialized = serializeA11yTree(nodes);
        if (!serialized) {
          return engineErr('ref-not-actionable', 'degenerate a11y tree — use vision fallback');
        }
        const snapshotId = `s${++snapshotCounter}`;
        // Keep only the latest snapshot's refs: acting on an older perception
        // than the newest one is exactly the staleness bug refs exist to catch.
        rec.snapshots.clear();
        rec.snapshots.set(snapshotId, serialized.refs);
        return ok({
          tabId,
          snapshotId,
          url: rec.view.webContents.getURL(),
          root: serialized.root,
        });
      } catch (e) {
        return engineErr('detached', `a11y fetch failed: ${String(e)}`);
      }
    },

    async screenshot(tabId: TabId): Promise<Result<Screenshot, EngineError>> {
      const rec = getRec(tabId);
      if (!rec) return engineErr('no-such-tab', `no tab ${tabId}`);
      try {
        const [shot, metrics] = await Promise.all([
          rec.cdp.send<{ data: string }>('Page.captureScreenshot', { format: 'png' }),
          rec.cdp.send<{
            cssLayoutViewport: { clientWidth: number; clientHeight: number };
            visualViewport: { scale: number };
          }>('Page.getLayoutMetrics'),
        ]);
        return ok({
          data: Uint8Array.from(Buffer.from(shot.data, 'base64')),
          width: metrics.cssLayoutViewport.clientWidth,
          height: metrics.cssLayoutViewport.clientHeight,
          scale: metrics.visualViewport.scale,
        });
      } catch (e) {
        return engineErr('detached', `screenshot failed: ${String(e)}`);
      }
    },

    async evaluate<T = unknown>(tabId: TabId, expression: string): Promise<Result<T, EngineError>> {
      const rec = getRec(tabId);
      if (!rec) return engineErr('no-such-tab', `no tab ${tabId}`);
      try {
        const { result, exceptionDetails } = await rec.cdp.send<{
          result: { value?: T };
          exceptionDetails?: { text: string };
        }>('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
        if (exceptionDetails) {
          return engineErr('ref-not-actionable', `evaluate threw: ${exceptionDetails.text}`);
        }
        return ok(result.value as T);
      } catch (e) {
        return engineErr('detached', `evaluate failed: ${String(e)}`);
      }
    },

    async dispatchInput(tabId: TabId, event: InputEvent): Promise<Result<void, EngineError>> {
      const rec = getRec(tabId);
      if (!rec) return engineErr('no-such-tab', `no tab ${tabId}`);
      try {
        switch (event.type) {
          case 'click': {
            const backendId = resolveRef(rec, event.ref);
            if (!backendId.ok) return backendId;
            const at = await centerOf(rec, backendId.value);
            if (!at.ok) return at;
            await clickAt(rec, at.value.x, at.value.y, event.button ?? 'left');
            return ok(undefined);
          }
          case 'clickAt': {
            // Vision fallback path.
            await clickAt(rec, event.x, event.y, 'left');
            return ok(undefined);
          }
          case 'type': {
            const backendId = resolveRef(rec, event.ref);
            if (!backendId.ok) return backendId;
            await rec.cdp.send('DOM.getDocument', { depth: 0 });
            await rec.cdp.send('DOM.focus', { backendNodeId: backendId.value });
            await rec.cdp.send('Input.insertText', { text: event.text });
            if (event.submit) await pressKey(rec, 'Enter');
            return ok(undefined);
          }
          case 'key': {
            await pressKey(rec, event.key);
            return ok(undefined);
          }
          case 'hover': {
            const backendId = resolveRef(rec, event.ref);
            if (!backendId.ok) return backendId;
            const at = await centerOf(rec, backendId.value);
            if (!at.ok) return at;
            await rec.cdp.send('Input.dispatchMouseEvent', {
              type: 'mouseMoved', x: at.value.x, y: at.value.y,
            });
            return ok(undefined);
          }
          case 'scroll': {
            let x = 100, y = 100;
            if (event.ref) {
              const backendId = resolveRef(rec, event.ref);
              if (!backendId.ok) return backendId;
              const at = await centerOf(rec, backendId.value);
              if (!at.ok) return at;
              ({ x, y } = at.value);
            }
            await rec.cdp.send('Input.dispatchMouseEvent', {
              type: 'mouseWheel', x, y, deltaX: event.dx ?? 0, deltaY: event.dy,
            });
            return ok(undefined);
          }
        }
      } catch (e) {
        return engineErr('detached', `input dispatch failed: ${String(e)}`);
      }
    },

    onNavigate(handler: (e: NavEvent) => void): Unsubscribe {
      navHandlers.add(handler);
      return () => navHandlers.delete(handler);
    },
  };
}
