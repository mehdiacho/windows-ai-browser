// Curates CDP's Accessibility.getFullAXTree output into the compact,
// ref-addressed A11yNode tree the agent perceives (engine-core contract).
//
// Curation rules (Handoff §7.2 — never feed the model the raw tree):
//   - ignored nodes and pure-layout roles are dropped, their children promoted
//   - StaticText/InlineTextBox are folded away (parents already carry the name)
//   - refs ("e1", "e2", …) are assigned ONLY to nodes backed by a DOM node,
//     depth-first, and map to CDP backendNodeIds via the returned RefMap
//   - name/value strings are trimmed and capped so one node can't eat the budget

import type { A11yNode, A11yNodeState, NodeRef } from '@wab/engine-core';

/** Raw AX node shape from CDP Accessibility.getFullAXTree (the parts we use). */
export interface RawAXNode {
  nodeId: string;
  ignored: boolean;
  role?: { value?: string };
  name?: { value?: string };
  value?: { value?: unknown };
  properties?: { name: string; value: { value?: unknown } }[];
  childIds?: string[];
  backendDOMNodeId?: number;
}

/** ref → CDP backendNodeId, valid for exactly one snapshot. */
export type RefMap = Map<NodeRef, number>;

const MAX_TEXT = 200;

/** Roles that are pure layout noise — drop the node, keep its children. */
const PASSTHROUGH_ROLES = new Set([
  'none',
  'generic',
  'presentation',
  'LayoutTable',
  'LayoutTableRow',
  'LayoutTableCell',
  'Section',
  'GenericContainer',
]);

/** Sub-text fragments always redundant with their StaticText parent. */
const DROP_ROLES = new Set(['InlineTextBox', 'LineBreak']);

/** Roles the agent acts on — always kept, even unnamed. */
const INTERACTIVE_ROLES = new Set([
  'button', 'link', 'textbox', 'searchbox', 'checkbox', 'radio', 'switch',
  'combobox', 'listbox', 'option', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'slider', 'spinbutton', 'tab', 'textfield', 'ComboBox',
]);

const clip = (s: string): string =>
  s.length > MAX_TEXT ? `${s.slice(0, MAX_TEXT)}…` : s;

function stateOf(raw: RawAXNode): A11yNodeState | undefined {
  const state: Record<string, unknown> = {};
  for (const p of raw.properties ?? []) {
    switch (p.name) {
      case 'disabled': if (p.value.value === true) state['disabled'] = true; break;
      case 'checked': {
        const v = p.value.value;
        if (v === 'true' || v === true) state['checked'] = true;
        else if (v === 'false' || v === false) state['checked'] = false;
        else if (v === 'mixed') state['checked'] = 'mixed';
        break;
      }
      case 'expanded': state['expanded'] = p.value.value === true; break;
      case 'selected': if (p.value.value === true) state['selected'] = true; break;
      case 'focused': if (p.value.value === true) state['focused'] = true; break;
      case 'required': if (p.value.value === true) state['required'] = true; break;
      case 'invalid': {
        // CDP reports invalid as a token: 'false' | 'true' | 'spelling' | 'grammar'.
        const v = p.value.value;
        if (v === true || (typeof v === 'string' && v !== 'false')) state['invalid'] = true;
        break;
      }
      case 'hidden': if (p.value.value === true) state['hidden'] = true; break;
    }
  }
  return Object.keys(state).length > 0 ? (state as A11yNodeState) : undefined;
}

function levelOf(raw: RawAXNode): number | undefined {
  const p = (raw.properties ?? []).find((q) => q.name === 'level');
  const v = p?.value.value;
  return typeof v === 'number' ? v : undefined;
}

export interface SerializedA11y {
  root: A11yNode;
  refs: RefMap;
}

/**
 * Build the curated tree from the flat CDP node list. Returns undefined only
 * for a degenerate tree (no usable root) — the vision-fallback trigger upstream.
 */
export function serializeA11yTree(rawNodes: RawAXNode[]): SerializedA11y | undefined {
  const byId = new Map<string, RawAXNode>(rawNodes.map((n) => [n.nodeId, n]));
  const hasParent = new Set<string>();
  for (const n of rawNodes) for (const c of n.childIds ?? []) hasParent.add(c);
  const rawRoot = rawNodes.find((n) => !hasParent.has(n.nodeId));
  if (!rawRoot) return undefined;

  const refs: RefMap = new Map();
  let refCounter = 0;

  const nextRef = (backendId: number): NodeRef => {
    const ref = `e${++refCounter}` as NodeRef;
    refs.set(ref, backendId);
    return ref;
  };

  /** Convert one raw node → zero or more curated nodes (passthroughs flatten). */
  const convert = (raw: RawAXNode | undefined, parentName: string): A11yNode[] => {
    if (!raw) return [];
    const role = raw.role?.value ?? '';
    const name = typeof raw.name?.value === 'string' ? raw.name.value.trim() : '';
    const children = (raw.childIds ?? []).flatMap((id) =>
      convert(byId.get(id), name !== '' ? name : parentName),
    );

    if (raw.ignored || DROP_ROLES.has(role)) return children;
    if (PASSTHROUGH_ROLES.has(role)) return children;

    // StaticText carries page prose (paragraphs have no accessible name of
    // their own) — keep it as a `text` line UNLESS an ancestor's name already
    // contains it (links/buttons/headings repeat their text as name).
    if (role === 'StaticText') {
      if (name === '' || parentName.includes(name)) return children;
      return [{ ref: `e${++refCounter}` as NodeRef, role: 'text', name: clip(name) }];
    }
    const rawValue = raw.value?.value;
    const value =
      typeof rawValue === 'string' && rawValue.trim() !== '' ? clip(rawValue.trim()) : undefined;
    const interactive = INTERACTIVE_ROLES.has(role);

    // Unnamed, non-interactive, single-child wrappers add depth but no signal.
    if (!interactive && name === '' && value === undefined) {
      if (children.length <= 1) return children;
    }

    const node: A11yNode = {
      ref:
        raw.backendDOMNodeId !== undefined
          ? nextRef(raw.backendDOMNodeId)
          : (`e${++refCounter}` as NodeRef),
      role: role || 'unknown',
      ...(name !== '' ? { name: clip(name) } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(stateOf(raw) !== undefined ? { state: stateOf(raw) } : {}),
      ...(levelOf(raw) !== undefined ? { level: levelOf(raw) } : {}),
      ...(children.length > 0 ? { children } : {}),
    };
    return [node];
  };

  const roots = convert(rawRoot, '');
  const root = roots[0];
  if (!root) return undefined;
  return { root, refs };
}
