// @wab/shell — main.ts (Electron entry point)
//
// Throwaway-per-tier shell plumbing. Two modes:
//   normal      — browser window: React chrome on top, WebContentsView tabs below
//   --smoke     — headless-ish end-to-end proof: open a tab THROUGH the
//                 BrowserEngine interface, navigate, capture a11y tree +
//                 screenshot, write artifacts to .smoke/, exit 0/1.

import { app, BrowserWindow, type WebContentsView } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderA11yTree } from '@wab/agent';
import type { ViewHost } from '@wab/engine-electron';
import { bootstrap } from './bootstrap.js';
import { registerIpc } from './ipc/registerIpc.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..', '..');
const uiIndexHtml = join(repoRoot, 'packages', 'ui', 'dist-web', 'index.html');
const preloadCjs = join(repoRoot, 'packages', 'preload', 'dist', 'preload.cjs');

/** Height of the React chrome strip (omnibox bar) above the tab content. */
const CHROME_HEIGHT = 76;

function makeViewHost(win: BrowserWindow): ViewHost {
  const views = new Set<WebContentsView>();
  const layout = (): void => {
    const [w, h] = win.getContentSize();
    for (const v of views) {
      v.setBounds({ x: 0, y: CHROME_HEIGHT, width: w ?? 0, height: (h ?? 0) - CHROME_HEIGHT });
    }
  };
  win.on('resize', layout);
  return {
    attach(view) {
      views.add(view);
      win.contentView.addChildView(view);
      layout();
    },
    detach(view) {
      views.delete(view);
      if (!win.isDestroyed()) win.contentView.removeChildView(view);
    },
  };
}

async function runSmoke(): Promise<void> {
  const outDir = join(repoRoot, '.smoke');
  mkdirSync(outDir, { recursive: true });

  // A smoke test that hangs is worse than one that fails.
  setTimeout(() => {
    console.error('SMOKE FAIL: timed out after 60s');
    app.exit(1);
  }, 60_000).unref();

  // Shown (briefly) — Page.captureScreenshot needs composited frames, and a
  // fully hidden window never paints, which hangs the capture.
  const win = new BrowserWindow({ width: 1200, height: 900, show: true });
  const host = makeViewHost(win);
  const { engine } = bootstrap(host);

  const fail = (msg: string): never => {
    console.error(`SMOKE FAIL: ${msg}`);
    app.exit(1);
    throw new Error(msg);
  };

  const tab = await engine.openTab({ url: 'https://example.com' });
  if (!tab.ok) fail(`openTab: ${tab.error.message}`);
  else console.log(`opened ${tab.value.id}: "${tab.value.title}" @ ${tab.value.url}`);

  if (!tab.ok) return;
  const tree = await engine.getA11yTree(tab.value.id);
  if (!tree.ok) fail(`getA11yTree: ${tree.error.message}`);
  else {
    const text = renderA11yTree(tree.value.root);
    writeFileSync(join(outDir, 'a11y.txt'), text);
    console.log('--- a11y tree (what the model would read) ---');
    console.log(text);
  }

  const shot = await engine.screenshot(tab.value.id);
  if (!shot.ok) fail(`screenshot: ${shot.error.message}`);
  else {
    writeFileSync(join(outDir, 'screenshot.png'), Buffer.from(shot.value.data));
    console.log(
      `screenshot: ${shot.value.width}x${shot.value.height} @${shot.value.scale}x → .smoke/screenshot.png`,
    );
  }

  console.log('SMOKE OK');
  app.exit(0);
}

/**
 * --smoke-ui: prove the FULL user path — React chrome loads, the preload
 * bridge exists, and window.wab.openTab drives the engine over IPC. This is
 * the layer the engine smoke can't see.
 */
function runSmokeUi(): void {
  setTimeout(() => {
    console.error('SMOKE-UI FAIL: timed out after 60s');
    app.exit(1);
  }, 60_000).unref();

  const win = createChromeWindow();
  win.webContents.on('did-finish-load', () => {
    void (async () => {
      try {
        const bridgeType = (await win.webContents.executeJavaScript('typeof window.wab')) as string;
        if (bridgeType !== 'object') throw new Error(`window.wab is ${bridgeType}`);
        console.log('preload bridge: OK');
        const title = (await win.webContents.executeJavaScript(
          `window.wab.openTab('https://example.com').then(t => t.title)`,
        )) as string;
        console.log(`openTab via bridge: OK ("${title}")`);
        console.log('SMOKE-UI OK');
        app.exit(0);
      } catch (e) {
        console.error('SMOKE-UI FAIL:', e);
        app.exit(1);
      }
    })();
  });
}

function createChromeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#1b1b1f',
    webPreferences: {
      preload: preloadCjs,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const host = makeViewHost(win);
  const { engine } = bootstrap(host);
  registerIpc(engine, win);
  void win.loadFile(uiIndexHtml);
  return win;
}

app.whenReady().then(() => {
  if (process.argv.includes('--smoke')) {
    runSmoke().catch((e) => {
      console.error('SMOKE FAIL (uncaught):', e);
      app.exit(1);
    });
  } else if (process.argv.includes('--smoke-ui')) {
    runSmokeUi();
  } else {
    createChromeWindow();
  }
});

app.on('window-all-closed', () => app.quit());
