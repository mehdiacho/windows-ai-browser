// @wab/memory — local, inspectable memory. Storage-agnostic interface so v1 can
// ship markdown files (recommended: no native build) and swap in better-sqlite3
// later without touching callers. NO electron.

export interface MemoryRecord {
  readonly id: string;
  readonly kind: 'episodic' | 'semantic';
  readonly text: string;
  readonly at: number;
}

export interface MemoryStore {
  append(record: MemoryRecord): Promise<void>;
  query(text: string, limit?: number): Promise<readonly MemoryRecord[]>;
}

/** Markdown-file store (e.g. episodic/2026-07-12.md) — stub for now. */
export function createMarkdownMemoryStore(_dir: string): MemoryStore {
  return {
    async append() {
      throw new Error('markdown memory store not implemented yet');
    },
    async query() {
      return [];
    },
  };
}
