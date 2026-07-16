// @wab/shell — bootstrap.ts (composition root)
//
// The ONE place that knows about everyone. It constructs the concrete Electron
// engine, the trust implementations, memory, and wires them into the agent —
// which itself only sees engine-core interfaces.

import type { BrowserEngine } from '@wab/engine-core';
import { createAgent, type Agent } from '@wab/agent';
import { createElectronBrowserEngine, type ViewHost } from '@wab/engine-electron';
import { createTrustPorts } from '@wab/trust';

export interface WiredApp {
  readonly engine: BrowserEngine;
  readonly agent: Agent;
}

/** Compose the object graph. Called once from main.ts after app is ready. */
export function bootstrap(host: ViewHost): WiredApp {
  const engine = createElectronBrowserEngine({
    host,
    defaultPartition: 'persist:default',
  });
  const trust = createTrustPorts();

  // The agent receives ONLY engine-core interfaces (engine + trust ports).
  const agent = createAgent({ engine, trust });

  return { engine, agent };
}
