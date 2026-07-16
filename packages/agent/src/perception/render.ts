// agent/perception — render the curated A11ySnapshot as the compact text the
// model actually reads: one line per node, `role "name" [ref=e12] {state}`,
// indented by depth. Pure over engine-core types; no engine implementation here.

import type { A11yNode } from '@wab/engine-core';

export function renderA11yTree(node: A11yNode, depth = 0): string {
  const pad = '  '.repeat(depth);
  const parts: string[] = [node.role];
  if (node.name !== undefined) parts.push(JSON.stringify(node.name));
  if (node.value !== undefined) parts.push(`value=${JSON.stringify(node.value)}`);
  parts.push(`[ref=${node.ref}]`);
  if (node.level !== undefined) parts.push(`level=${node.level}`);
  if (node.state) {
    const flags = Object.entries(node.state)
      .map(([k, v]) => (v === true ? k : `${k}=${String(v)}`))
      .join(' ');
    if (flags) parts.push(`{${flags}}`);
  }
  const lines = [pad + parts.join(' ')];
  for (const child of node.children ?? []) lines.push(renderA11yTree(child, depth + 1));
  return lines.join('\n');
}
