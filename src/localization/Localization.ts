import type { EventBus } from '../core/EventBus';

/**
 * Localization.
 *
 * All six launch locales are bundled (they are a few KB of JSON each) because
 * the game must work with no network at all. Adding a language is: drop a JSON
 * file in `locales/`, add it to LOCALES below, done.
 *
 * Hard rule enforced by tests: no user-visible string is ever written inline in
 * gameplay or UI code, and no text is baked into an image.
 */

import en from './locales/en.json';
import de from './locales/de.json';
import fr from './locales/fr.json';
import it from './locales/it.json';
import es from './locales/es.json';
import fi from './locales/fi.json';

export type LocaleCode = 'en' | 'de' | 'fr' | 'it' | 'es' | 'fi';

export interface LocaleInfo {
  code: LocaleCode;
  /** Shown in the language picker, always in the language's own name. */
  nativeName: string;
  table: Record<string, string>;
}

export const LOCALES: LocaleInfo[] = [
  { code: 'en', nativeName: 'English', table: en as Record<string, string> },
  { code: 'de', nativeName: 'Deutsch', table: de as Record<string, string> },
  { code: 'fr', nativeName: 'Français', table: fr as Record<string, string> },
  { code: 'it', nativeName: 'Italiano', table: it as Record<string, string> },
  { code: 'es', nativeName: 'Español', table: es as Record<string, string> },
  { code: 'fi', nativeName: 'Suomi', table: fi as Record<string, string> },
];

const FALLBACK: LocaleCode = 'en';

export class Localization {
  private current: LocaleCode = FALLBACK;
  private table: Record<string, string> = en as Record<string, string>;
  private fallbackTable: Record<string, string> = en as Record<string, string>;
  private missing = new Set<string>();

  constructor(private bus: EventBus) {}

  get locale(): LocaleCode {
    return this.current;
  }

  get availableLocales(): LocaleInfo[] {
    return LOCALES;
  }

  /** Accepts full tags like "de-CH" or "pt-BR" and picks the best match. */
  setLocale(tag: string): void {
    const resolved = resolveLocale(tag);
    if (resolved === this.current) return;
    this.current = resolved;
    this.table = LOCALES.find((l) => l.code === resolved)!.table;
    this.missing.clear();
    this.bus.emit('locale:changed', { locale: resolved });
  }

  /**
   * Translate. Unknown keys fall back to English, then to the key itself — the
   * game must never render an empty label or crash over a missing string.
   */
  t(key: string, params?: Record<string, string | number>): string {
    let value = this.table[key];
    if (value === undefined) {
      value = this.fallbackTable[key];
      if (value === undefined) {
        if (!this.missing.has(key)) {
          this.missing.add(key);
          if (import.meta.env?.DEV) console.warn(`[i18n] missing key: ${key}`);
        }
        return key;
      }
    }
    return params ? interpolate(value, params) : value;
  }

  /** True when the key exists in the active or fallback table. */
  has(key: string): boolean {
    return this.table[key] !== undefined || this.fallbackTable[key] !== undefined;
  }

  /** Picks a random variant from keys named `${key}.1`, `${key}.2`, ... */
  tVariant(key: string, index: number, params?: Record<string, string | number>): string {
    const variants: string[] = [];
    for (let i = 1; i <= 8; i++) {
      const candidate = `${key}.${i}`;
      if (this.has(candidate)) variants.push(candidate);
      else break;
    }
    if (variants.length === 0) return this.t(key, params);
    return this.t(variants[index % variants.length], params);
  }
}

export function resolveLocale(tag: string): LocaleCode {
  const lower = (tag || '').toLowerCase();
  const base = lower.split(/[-_]/)[0];
  const match = LOCALES.find((l) => l.code === base);
  return match ? match.code : FALLBACK;
}

function interpolate(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}
