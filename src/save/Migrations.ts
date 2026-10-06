import { SAVE_VERSION, createNewSave, type SaveData } from './SaveSchema';
import { milestonesReachedAt } from '../content/Milestones';

/**
 * Save migrations.
 *
 * Each entry upgrades a save from version N to N+1. They run in sequence, so a
 * v1 save from the launch build walks v1 -> v2 -> v3 and arrives intact. Adding
 * a field is usually a two-line migration; never skip writing one, because the
 * chain is also what the migration tests exercise.
 */

type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

export const MIGRATIONS: Record<number, Migration> = {
  /** v1 -> v2: introduced the Nature Book and per-animal bonding. */
  1: (data) => {
    data.discoveries = Array.isArray(data.discoveries) ? data.discoveries : [];
    data.stickers = Array.isArray(data.stickers) ? data.stickers : [];
    const animals = Array.isArray(data.animals) ? data.animals : [];
    data.animals = animals.map((a) => {
      const animal = a as Record<string, unknown>;
      return {
        ...animal,
        bond: typeof animal.bond === 'number' ? animal.bond : 0,
        petToday: Boolean(animal.petToday),
      };
    });
    data.version = 2;
    return data;
  },

  /** v2 -> v3: seasons, day history and per-activity completion counts. */
  2: (data) => {
    data.season = typeof data.season === 'string' ? data.season : 'summer';
    data.seasonDay = typeof data.seasonDay === 'number' ? data.seasonDay : 1;
    data.history = Array.isArray(data.history) ? data.history : [];
    data.completionCounts =
      data.completionCounts && typeof data.completionCounts === 'object'
        ? data.completionCounts
        : {};
    data.seenStoryBeats = Array.isArray(data.seenStoryBeats) ? data.seenStoryBeats : [];
    data.version = 3;
    return data;
  },

  /** v3 -> v4: hats, and heart milestones that have been celebrated. */
  3: (data) => {
    const child =
      data.child && typeof data.child === 'object' ? (data.child as Record<string, unknown>) : {};
    child.hat = typeof child.hat === 'number' ? child.hat : 0;
    data.child = child;
    // An existing player has already earned whatever their hearts unlock, so
    // mark those as seen rather than firing a burst of celebrations on update.
    data.milestonesSeen = Array.isArray(data.milestonesSeen)
      ? data.milestonesSeen
      : milestonesReachedAt(typeof data.hearts === 'number' ? data.hearts : 0);
    data.version = 4;
    return data;
  },
};

export interface MigrationResult {
  data: SaveData;
  migrated: boolean;
  /** Set when the save was unreadable and had to be replaced. */
  recovered: boolean;
  fromVersion: number;
}

/**
 * Brings any stored save up to the current version, repairing it if needed.
 * This function must never throw — a corrupt save becomes a fresh save rather
 * than a boot loop.
 */
export function migrateSave(raw: unknown, fallbackSeed: number): MigrationResult {
  if (!raw || typeof raw !== 'object') {
    return { data: createNewSave(fallbackSeed), migrated: false, recovered: true, fromVersion: 0 };
  }

  let data = raw as Record<string, unknown>;
  const fromVersion = typeof data.version === 'number' ? data.version : 0;

  if (fromVersion > SAVE_VERSION) {
    // Save came from a NEWER build (sideload, or a downgrade). Do not attempt to
    // interpret it — keep it untouched on disk and start a fresh session so we
    // never destroy data we do not understand.
    return {
      data: createNewSave(fallbackSeed),
      migrated: false,
      recovered: true,
      fromVersion,
    };
  }

  let version = fromVersion;
  try {
    while (version < SAVE_VERSION) {
      const migration = MIGRATIONS[version];
      if (!migration) {
        // Gap in the chain: fill forward rather than losing the save.
        data.version = version + 1;
        version++;
        continue;
      }
      data = migration(data);
      const next = typeof data.version === 'number' ? data.version : version + 1;
      if (next <= version) {
        throw new Error(`migration ${version} did not advance the version`);
      }
      version = next;
    }
  } catch (error) {
    console.error('[Migrations] failed, starting fresh', error);
    return { data: createNewSave(fallbackSeed), migrated: false, recovered: true, fromVersion };
  }

  return {
    data: reconcile(data, fallbackSeed),
    migrated: fromVersion !== SAVE_VERSION,
    recovered: false,
    fromVersion,
  };
}

/**
 * Final safety net: fills in anything still missing or of the wrong type with a
 * default. Cheap insurance against a hand-edited or partially-written file.
 */
function reconcile(data: Record<string, unknown>, fallbackSeed: number): SaveData {
  const defaults = createNewSave(
    typeof data.worldSeed === 'number' ? data.worldSeed : fallbackSeed,
  ) as unknown as Record<string, unknown>;

  const out: Record<string, unknown> = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const value = data[key];
    if (value === undefined || value === null) continue;
    if (Array.isArray(defaults[key]) && !Array.isArray(value)) continue;
    if (typeof defaults[key] === 'number' && typeof value !== 'number') continue;
    if (typeof defaults[key] === 'string' && typeof value !== 'string') continue;
    if (typeof defaults[key] === 'boolean' && typeof value !== 'boolean') continue;
    out[key] = value;
  }

  // `child` is nested, so merge it field-by-field too.
  const child = data.child;
  if (child && typeof child === 'object') {
    out.child = { ...(defaults.child as object), ...(child as object) };
  }

  out.version = SAVE_VERSION;
  return out as unknown as SaveData;
}
