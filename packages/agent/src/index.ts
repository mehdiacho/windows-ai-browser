// @wab/agent — perceive→plan→act→verify loop. The crown jewel; ports untouched
// across engine tiers because it reaches ONLY these engine-core interfaces.
//
// NOTE: importing from '@wab/engine-core' is allowed. Importing 'electron' or
// '@wab/engine-electron' is a dependency-cruiser ERROR by design — try it and CI fails.

import type { BrowserEngine, TrustPorts } from '@wab/engine-core';

export { renderA11yTree } from './perception/render.js';

/** Everything the agent needs, injected by the shell (composition root). */
export interface AgentDeps {
  readonly engine: BrowserEngine;
  readonly trust: TrustPorts;
}

export interface Agent {
  run(goal: string): Promise<void>;
}

/**
 * Placeholder factory — the real perceive/plan/act/verify loop lands in a later
 * session (task graph step 7). Present now so the boundary has real code to check.
 */
export function createAgent(deps: AgentDeps): Agent {
  return {
    async run(_goal: string): Promise<void> {
      void deps;
      throw new Error('agent loop not implemented yet');
    },
  };
}
