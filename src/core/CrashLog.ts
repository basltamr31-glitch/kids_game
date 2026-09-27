import type { IPlatform } from '../platform/IPlatform';
import { APP_VERSION } from './Config';

/**
 * A crash log that never leaves the device.
 *
 * Uncaught errors and rejected promises are kept, most recent last, in local
 * storage. There is no reporter and no network: a parent who wants to help
 * can copy the report from the Parent Area and send it themselves. Nothing
 * here may throw; a crash while recording a crash would be the worst kind.
 */

export interface CrashEntry {
  /** ms since epoch */
  at: number;
  version: string;
  message: string;
  /** First few frames only; enough to find the line, small enough to keep. */
  stack: string;
}

const KEY = 'lad.crashlog.v1';
const MAX_ENTRIES = 20;

export class CrashLog {
  private entries: CrashEntry[] = [];
  private installed = false;

  constructor(private platform: IPlatform) {}

  async load(): Promise<void> {
    try {
      const raw = await this.platform.read(KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : [];
      if (Array.isArray(parsed)) this.entries = parsed.filter(isEntry).slice(-MAX_ENTRIES);
    } catch {
      this.entries = [];
    }
  }

  /** Listens for anything uncaught, from here until the page closes. */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    window.addEventListener('error', (event) => {
      this.record(event.error ?? event.message);
    });
    window.addEventListener('unhandledrejection', (event) => {
      this.record(event.reason);
    });
  }

  record(error: unknown): void {
    try {
      const message =
        error instanceof Error ? `${error.name}: ${error.message}` : String(error ?? 'unknown error');
      const stack =
        error instanceof Error && error.stack
          ? error.stack.split('\n').slice(0, 7).join('\n')
          : '';
      // The same error firing every frame is one problem, not twenty.
      const last = this.entries[this.entries.length - 1];
      if (last && last.message === message && Date.now() - last.at < 60_000) return;
      this.entries.push({ at: Date.now(), version: APP_VERSION, message: message.slice(0, 300), stack });
      if (this.entries.length > MAX_ENTRIES) this.entries.splice(0, this.entries.length - MAX_ENTRIES);
      void this.platform.write(KEY, JSON.stringify(this.entries)).catch(() => undefined);
    } catch {
      /* never let the log itself fail */
    }
  }

  get count(): number {
    return this.entries.length;
  }

  /** Plain text for a parent to paste into an email. */
  report(): string {
    const header = `Little Alpine Days ${APP_VERSION}\n${navigator.userAgent}\n`;
    return (
      header +
      this.entries
        .map((e) => `\n[${new Date(e.at).toISOString()}] v${e.version}\n${e.message}\n${e.stack}`)
        .join('\n')
    );
  }

  async clear(): Promise<void> {
    this.entries = [];
    try {
      await this.platform.remove(KEY);
    } catch {
      /* ignore */
    }
  }
}

function isEntry(value: unknown): value is CrashEntry {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.at === 'number' && typeof v.message === 'string';
}
