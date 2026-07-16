// CDP session over Electron's webContents.debugger — the agent's control
// surface. One session per tab, attached lazily and kept for the tab's life.

import type { WebContents } from 'electron';

export class CdpSession {
  private attached = false;

  constructor(private readonly wc: WebContents) {}

  attach(): void {
    if (this.attached) return;
    // '1.3' is the stable CDP protocol version.
    this.wc.debugger.attach('1.3');
    this.attached = true;
  }

  detach(): void {
    if (!this.attached) return;
    try {
      this.wc.debugger.detach();
    } catch {
      // Already detached (e.g. target destroyed) — fine.
    }
    this.attached = false;
  }

  async send<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
    this.attach();
    return (await this.wc.debugger.sendCommand(method, params)) as T;
  }
}
