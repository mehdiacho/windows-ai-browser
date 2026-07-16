// Browser chrome strip: omnibox + live tab title. Deliberately conservative,
// Chrome-like (Handoff §7.7). Talks to main ONLY via the preload bridge.

import { useEffect, useRef, useState } from 'react';
import type { TabInfo } from '@wab/shared';
import { bridge } from './index.js';

const normalizeUrl = (raw: string): string => {
  const s = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) return `https://${s}`;
  // Not URL-shaped → search. (Ask-AI toggle lands with the sidebar.)
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`;
};

export function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabInfo | null>(null);
  const [input, setInput] = useState('');
  const tabRef = useRef<TabInfo | null>(null);
  tabRef.current = tab;

  useEffect(() => bridge().onTabUpdated((t) => {
    // Single-tab slice: adopt updates for our tab (or the first one created).
    if (!tabRef.current || tabRef.current.tabId === t.tabId) setTab(t);
  }), []);

  const go = async (): Promise<void> => {
    if (input.trim() === '') return;
    const url = normalizeUrl(input);
    const current = tabRef.current;
    const next = current
      ? await bridge().navigate(current.tabId, url)
      : await bridge().openTab(url);
    setTab(next);
  };

  return (
    <div
      style={{
        height: 76, boxSizing: 'border-box', padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 6,
        background: '#1b1b1f', color: '#e6e6ea',
      }}
    >
      <div style={{ fontSize: 12, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {tab ? `${tab.loading ? '⟳ ' : ''}${tab.title || tab.url}` : 'No tab — enter a URL below'}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void go(); }}
          placeholder="Search or enter address"
          style={{
            flex: 1, padding: '6px 12px', borderRadius: 8, border: '1px solid #3a3a42',
            background: '#26262c', color: 'inherit', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={() => void go()}
          style={{
            padding: '6px 16px', borderRadius: 8, border: '1px solid #3a3a42',
            background: '#31313a', color: 'inherit', fontSize: 14, cursor: 'pointer',
          }}
        >
          Go
        </button>
      </div>
    </div>
  );
}
