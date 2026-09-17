import { describe, it, expect } from 'vitest';
import {
  ACTIVITIES,
  ACTIVITIES_BY_ID,
  ANIMALS,
  ANIMALS_BY_ID,
  DISCOVERIES,
  ITEMS_BY_ID,
  AREAS_BY_ID,
  SCRIPTED_DAYS,
  FIXED_ACTIVITIES,
  validateContent,
  animalsFor,
} from '../src/content';
import { LOCALES, resolveLocale } from '../src/localization/Localization';
import { readFileSync } from 'node:fs';
import { HOUSE_ROUTINE_IDS } from '../src/world/HouseInteractions';
import { FARM_ROUTINE_IDS } from '../src/world/FarmInteractions';

/**
 * Content and localization are the two places a typo becomes a soft lock or an
 * empty label rather than a compile error, so they get the most paranoid tests.
 */

describe('content tables', () => {
  it('passes the built-in integrity check', () => {
    expect(validateContent()).toEqual([]);
  });

  it('has unique ids everywhere', () => {
    expect(ACTIVITIES_BY_ID.size).toBe(ACTIVITIES.length);
    expect(ANIMALS_BY_ID.size).toBe(ANIMALS.length);
    expect(new Set(DISCOVERIES.map((d) => d.id)).size).toBe(DISCOVERIES.length);
  });

  it('gives every activity a reachable anchor', () => {
    const resolvable = new Set<string>([
      ...ANIMALS.map((a) => a.id),
      'mother',
      'father',
      // Static anchors registered by WorldBuilder.
      'bed', 'wardrobe', 'dinnertable', 'kitchen', 'livingroom', 'bathroom',
      'bedroomwindow', 'porch', 'haybale', 'well', 'trough', 'grainsack',
      'nestbox', 'gardenbeds', 'appletree', 'yardcenter', 'meadowview',
      'streambank', 'barn', 'mountains', 'barnhay',
    ]);

    for (const activity of ACTIVITIES) {
      expect(resolvable.has(activity.anchor), `${activity.id} -> ${activity.anchor}`).toBe(true);
      for (const step of activity.steps) {
        if (!step.target) continue;
        if (step.kind === 'emote') continue; // emote targets are actors, incl. 'child'
        expect(resolvable.has(step.target), `${activity.id} step -> ${step.target}`).toBe(true);
      }
    }
  });

  it('never creates a circular prerequisite', () => {
    const seen = new Map<string, number>();
    const visit = (id: string, stack: string[]): void => {
      if (stack.includes(id)) throw new Error(`cycle: ${[...stack, id].join(' -> ')}`);
      if (seen.get(id) === 1) return;
      seen.set(id, 1);
      const activity = ACTIVITIES_BY_ID.get(id);
      for (const required of activity?.requiresActivities ?? []) {
        visit(required, [...stack, id]);
      }
    };
    expect(() => ACTIVITIES.forEach((a) => visit(a.id, []))).not.toThrow();
  });

  it('keeps every prerequisite available in an earlier or equal phase', () => {
    const order = ['morning', 'midday', 'afternoon', 'evening', 'night'];
    const earliest = (id: string): number => {
      const activity = ACTIVITIES_BY_ID.get(id)!;
      return Math.min(...activity.phases.map((p) => order.indexOf(p)));
    };
    for (const activity of ACTIVITIES) {
      for (const required of activity.requiresActivities ?? []) {
        expect(
          earliest(required),
          `${activity.id} requires ${required}, which is never available early enough`,
        ).toBeLessThanOrEqual(earliest(activity.id));
      }
    }
  });

  it('gives every scripted day a full fixed rhythm, in order', () => {
    for (const day of SCRIPTED_DAYS) {
      const flat = day.schedule.flatMap((entry) => entry.activities);
      for (const required of ['wakeup', 'breakfast', 'dinner', 'brushteeth', 'bedtime']) {
        expect(flat, `${day.id} is missing ${required}`).toContain(required);
      }
      // Bedtime must be last, or the day cannot end.
      expect(flat[flat.length - 1]).toBe('bedtime');
      expect(flat.indexOf('dinner')).toBeLessThan(flat.indexOf('brushteeth'));
      // No duplicates: every activity here is once-per-day.
      expect(new Set(flat).size).toBe(flat.length);
    }
  });

  it('only references activities that exist from scripted days', () => {
    for (const day of SCRIPTED_DAYS) {
      for (const entry of day.schedule) {
        for (const id of entry.activities) {
          expect(ACTIVITIES_BY_ID.has(id), `${day.id} -> ${id}`).toBe(true);
        }
      }
    }
  });

  it('marks the fixed rhythm as unweighted so the generator never draws it twice', () => {
    for (const id of FIXED_ACTIVITIES) {
      expect(ACTIVITIES_BY_ID.get(id)?.weight, id).toBe(0);
    }
  });

  it('keeps the free game genuinely playable', () => {
    const free = animalsFor(false);
    // A cow, sheep and chickens: enough for the whole core loop.
    expect(free.some((a) => a.kind === 'cow')).toBe(true);
    expect(free.filter((a) => a.kind === 'sheep').length).toBeGreaterThanOrEqual(2);
    expect(free.filter((a) => a.kind === 'chicken').length).toBeGreaterThanOrEqual(2);

    // None of the daily-rhythm activities may be paywalled.
    for (const id of FIXED_ACTIVITIES) {
      expect(ACTIVITIES_BY_ID.get(id)?.requiresPremium).toBeFalsy();
    }
    // Neither may core animal care.
    for (const id of ['feedcow', 'feedsheep', 'feedchickens', 'collecteggs', 'milkcow']) {
      expect(ACTIVITIES_BY_ID.get(id)?.requiresPremium, id).toBeFalsy();
    }
  });

  it('premium gates only ever widen the game, never block a free day', () => {
    const premiumAreas = [...AREAS_BY_ID.values()].filter((a) => a.requiresPremium);
    for (const area of premiumAreas) {
      const activitiesThere = ACTIVITIES.filter((activity) => {
        const animal = ANIMALS_BY_ID.get(activity.anchor);
        return animal?.area === area.id;
      });
      for (const activity of activitiesThere) {
        expect(activity.requiresPremium, `${activity.id} is in premium area ${area.id}`).toBe(true);
      }
    }
  });

  it('gives every carried item a hand prop or marks it uncarried', () => {
    for (const activity of ACTIVITIES) {
      for (const step of activity.steps) {
        if (step.kind !== 'takeItem' || !step.item) continue;
        expect(ITEMS_BY_ID.get(step.item)?.carried, `${step.item} must be carriable`).toBe(true);
      }
    }
  });
});

describe('localization', () => {
  const english = LOCALES.find((l) => l.code === 'en')!;

  it('ships all six launch languages', () => {
    expect(LOCALES.map((l) => l.code).sort()).toEqual(['de', 'en', 'es', 'fi', 'fr', 'it']);
  });

  it('has complete key parity across every locale', () => {
    const keys = Object.keys(english.table).sort();
    for (const locale of LOCALES) {
      expect(Object.keys(locale.table).sort(), `${locale.code} key set`).toEqual(keys);
    }
  });

  it('never ships an empty or whitespace-only string', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(locale.table)) {
        expect(value.trim().length, `${locale.code}:${key}`).toBeGreaterThan(0);
      }
    }
  });

  it('preserves every interpolation placeholder in translation', () => {
    const placeholders = (s: string): string[] =>
      (s.match(/\{(\w+)\}/g) ?? []).sort();

    for (const [key, source] of Object.entries(english.table)) {
      const expected = placeholders(source);
      if (expected.length === 0) continue;
      for (const locale of LOCALES) {
        expect(placeholders(locale.table[key]), `${locale.code}:${key}`).toEqual(expected);
      }
    }
  });

  it('has a translation for every key the content tables reference', () => {
    const needed = new Set<string>();
    for (const activity of ACTIVITIES) needed.add(activity.titleKey);
    for (const animal of ANIMALS) needed.add(animal.nameKey);
    for (const discovery of DISCOVERIES) needed.add(discovery.nameKey);
    for (const item of ITEMS_BY_ID.values()) needed.add(item.nameKey);

    for (const key of needed) {
      expect(english.table[key], `missing translation: ${key}`).toBeTypeOf('string');
    }
  });

  it('resolves regional tags to the closest shipped language', () => {
    expect(resolveLocale('de-CH')).toBe('de');
    expect(resolveLocale('de_AT')).toBe('de');
    expect(resolveLocale('fr-CA')).toBe('fr');
    expect(resolveLocale('it')).toBe('it');
    // Unsupported languages fall back to English rather than breaking.
    expect(resolveLocale('ja-JP')).toBe('en');
    expect(resolveLocale('')).toBe('en');
  });
});

/**
 * These two guard the seams between hand-written content and hand-written
 * code, which are the places a rename silently breaks the game at runtime
 * instead of at build time.
 */
describe('content/code seams', () => {
  it('resolves every routine step to a registered routine', () => {
    const registered = new Set<string>([...HOUSE_ROUTINE_IDS, ...FARM_ROUTINE_IDS]);
    for (const activity of ACTIVITIES) {
      for (const step of activity.steps) {
        if (step.kind !== 'routine') continue;
        expect(step.flag, `${activity.id}: routine step needs a flag`).toBeTypeOf('string');
        expect(registered.has(step.flag!), `${activity.id} -> routine "${step.flag}"`).toBe(true);
      }
    }
  });

  it('translates every interaction label the world code asks for', () => {
    const english = LOCALES.find((l) => l.code === 'en')!;
    const sources = [
      readFileSync(new URL('../src/world/HouseInteractions.ts', import.meta.url), 'utf8'),
      readFileSync(new URL('../src/world/FarmInteractions.ts', import.meta.url), 'utf8'),
    ].join('\n');
    const keys = new Set(sources.match(/'interact\.[A-Za-z.]+'/g)?.map((k) => k.slice(1, -1)) ?? []);
    expect(keys.size).toBeGreaterThan(10);
    for (const key of keys) {
      expect(english.table[key], `missing translation: ${key}`).toBeTypeOf('string');
    }
  });
});
