import { describe, it, expect, beforeEach } from 'vitest';
import { SaveManager } from '../src/save/SaveManager';
import { migrateSave, MIGRATIONS } from '../src/save/Migrations';
import { SAVE_VERSION, SAVE_KEY, createNewSave } from '../src/save/SaveSchema';
import { EventBus } from '../src/core/EventBus';
import type { IPlatform, SafeAreaInsets } from '../src/platform/IPlatform';

/**
 * Save integrity is the highest-stakes thing in this project: a child losing
 * their farm to an update is worse than any crash. These tests exercise the
 * whole migration chain, corruption recovery and the backup slot.
 */

class MemoryPlatform implements IPlatform {
  readonly id = 'web' as const;
  store = new Map<string, string>();
  /** Set to make the next write throw, simulating a full or locked disk. */
  failNextWrite = false;

  async init(): Promise<void> {}
  async read(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async write(key: string, value: string): Promise<void> {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error('disk full');
    }
    this.store.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.store.delete(key);
  }
  haptic(): void {}
  async lockOrientation(): Promise<void> {}
  getSafeAreaInsets(): SafeAreaInsets {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  async setStatusBarHidden(): Promise<void> {}
  onPause(): void {}
  onResume(): void {}
  async openExternal(): Promise<void> {}
  getPreferredLanguage(): string {
    return 'de-CH';
  }
}

describe('migrations', () => {
  it('walks a v1 save all the way to the current version', () => {
    const v1 = {
      version: 1,
      worldSeed: 4242,
      day: 5,
      hearts: 30,
      animals: [{ id: 'bella', fed: 0.8, watered: 0.5, milkReady: true, eggsAvailable: 0 }],
      completedToday: ['feedcow'],
    };

    const result = migrateSave(v1, 1);

    expect(result.recovered).toBe(false);
    expect(result.migrated).toBe(true);
    expect(result.fromVersion).toBe(1);
    expect(result.data.version).toBe(SAVE_VERSION);

    // Nothing the player had may be lost.
    expect(result.data.worldSeed).toBe(4242);
    expect(result.data.day).toBe(5);
    expect(result.data.hearts).toBe(30);
    expect(result.data.completedToday).toEqual(['feedcow']);

    // Fields added by v2 and v3 must exist with sane defaults.
    expect(result.data.animals[0].bond).toBe(0);
    expect(result.data.animals[0].petToday).toBe(false);
    expect(result.data.season).toBe('summer');
    expect(result.data.seasonDay).toBe(1);
    expect(Array.isArray(result.data.history)).toBe(true);
    expect(result.data.completionCounts).toEqual({});
  });

  it('has a migration for every version below the current one', () => {
    for (let version = 1; version < SAVE_VERSION; version++) {
      expect(MIGRATIONS[version], `missing migration for v${version}`).toBeTypeOf('function');
    }
  });

  it('each migration advances the version by exactly one', () => {
    for (let version = 1; version < SAVE_VERSION; version++) {
      const out = MIGRATIONS[version]({ version });
      expect(out.version).toBe(version + 1);
    }
  });

  it('treats a save from a newer build as unreadable rather than corrupting it', () => {
    const future = { version: SAVE_VERSION + 5, day: 99 };
    const result = migrateSave(future, 7);
    expect(result.recovered).toBe(true);
    expect(result.data.day).toBe(1);
  });

  it('recovers from garbage instead of throwing', () => {
    for (const junk of [null, undefined, 'not an object', 42, []]) {
      const result = migrateSave(junk, 1);
      expect(result.data.version).toBe(SAVE_VERSION);
      expect(result.data.day).toBe(1);
    }
  });

  it('repairs fields that have the wrong type', () => {
    const broken = {
      version: SAVE_VERSION,
      day: 'five',
      hearts: null,
      discoveries: 'nope',
      child: { preset: 'boy' },
    };
    const result = migrateSave(broken, 1);
    expect(result.data.day).toBe(1);
    expect(result.data.hearts).toBe(0);
    expect(Array.isArray(result.data.discoveries)).toBe(true);
    // A partial nested object is merged, not replaced.
    expect(result.data.child.preset).toBe('boy');
    expect(typeof result.data.child.skinTone).toBe('number');
  });

  it('is idempotent on an already-current save', () => {
    const current = createNewSave(999);
    const once = migrateSave(current, 1);
    const twice = migrateSave(once.data, 1);
    expect(once.migrated).toBe(false);
    expect(twice.data).toEqual(once.data);
  });
});

describe('SaveManager', () => {
  let platform: MemoryPlatform;
  let manager: SaveManager;

  beforeEach(async () => {
    platform = new MemoryPlatform();
    manager = new SaveManager(platform, new EventBus());
    await manager.load();
  });

  it('starts a fresh player on an empty device', () => {
    expect(manager.isFreshSave).toBe(true);
    expect(manager.save.day).toBe(1);
    expect(manager.migrationInfo.recovered).toBe(false);
  });

  it('persists and reloads progress', async () => {
    manager.update((data) => {
      data.day = 12;
      data.hearts = 88;
      data.discoveries.push('butterfly');
    });
    await manager.flush(true);

    const reloaded = new SaveManager(platform, new EventBus());
    await reloaded.load();

    expect(reloaded.save.day).toBe(12);
    expect(reloaded.save.hearts).toBe(88);
    expect(reloaded.save.discoveries).toContain('butterfly');
    expect(reloaded.isFreshSave).toBe(false);
  });

  it('falls back to the backup slot when the primary save is corrupt', async () => {
    manager.update((data) => {
      data.day = 7;
    });
    await manager.flush(true);
    // A second write moves the good copy into the backup slot.
    manager.update((data) => {
      data.day = 8;
    });
    await manager.flush(true);

    // Now corrupt the primary slot, as a power-off mid-write would.
    platform.store.set(SAVE_KEY, '{"version":3,"day":');

    const recovered = new SaveManager(platform, new EventBus());
    await recovered.load();

    // Day 7 is the backup: one step behind, but the farm survives.
    expect(recovered.save.day).toBe(7);
  });

  it('survives a failed write without losing the in-memory save', async () => {
    manager.update((data) => {
      data.hearts = 10;
    });
    platform.failNextWrite = true;
    await expect(manager.flush(true)).resolves.toBeUndefined();
    expect(manager.save.hearts).toBe(10);
  });

  it('follows the device language until the player picks one', async () => {
    expect(manager.settings.locale).toBe('de-CH');
    expect(manager.settings.localeIsExplicit).toBe(false);

    manager.updateSettings((s) => {
      s.locale = 'fi';
      s.localeIsExplicit = true;
    });

    const reloaded = new SaveManager(platform, new EventBus());
    await reloaded.load();
    expect(reloaded.settings.locale).toBe('fi');
  });

  it('keeps settings separate from progress when progress is reset', async () => {
    manager.updateSettings((s) => {
      s.musicVolume = 0.1;
      s.premiumUnlocked = true;
    });
    manager.update((data) => {
      data.day = 20;
    });
    await manager.flush(true);

    await manager.resetProgress();

    expect(manager.save.day).toBe(1);
    // A paid-for entitlement must never be destroyed by starting a new farm.
    expect(manager.settings.premiumUnlocked).toBe(true);
    expect(manager.settings.musicVolume).toBe(0.1);
  });
});
