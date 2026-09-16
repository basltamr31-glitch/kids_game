import type { IPlatform } from '../platform/IPlatform';
import type { EventBus } from '../core/EventBus';
import {
  SAVE_KEY,
  SETTINGS_KEY,
  SAVE_VERSION,
  createDefaultSettings,
  createNewSave,
  type SaveData,
  type SettingsData,
} from './SaveSchema';
import { migrateSave } from './Migrations';

/**
 * Owns the player's progress and settings.
 *
 * Writes are debounced and double-buffered: we always keep the previous good
 * save under a backup key, so a power-off mid-write can lose at most a few
 * seconds rather than the whole farm.
 */
export class SaveManager {
  private data: SaveData;
  private settingsData: SettingsData;
  private dirty = false;
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  private writing = false;
  private lastMigration = { migrated: false, recovered: false, fromVersion: SAVE_VERSION };

  private static readonly BACKUP_KEY = `${SAVE_KEY}.bak`;
  private static readonly AUTOSAVE_DEBOUNCE_MS = 1500;

  constructor(
    private platform: IPlatform,
    private bus: EventBus,
  ) {
    this.data = createNewSave(Date.now() & 0x7fffffff);
    this.settingsData = createDefaultSettings('en');
  }

  get save(): SaveData {
    return this.data;
  }

  get settings(): SettingsData {
    return this.settingsData;
  }

  get migrationInfo(): { migrated: boolean; recovered: boolean; fromVersion: number } {
    return this.lastMigration;
  }

  /** True when this is a brand new player (drives the customization flow). */
  get isFreshSave(): boolean {
    return this.data.day === 1 && !this.data.tutorialDone && this.data.history.length === 0;
  }

  async load(): Promise<void> {
    await this.loadSettings();

    const fallbackSeed = Date.now() & 0x7fffffff;
    let parsed: unknown = null;

    const raw = await this.platform.read(SAVE_KEY);
    parsed = safeParse(raw);

    if (parsed === null && raw !== null) {
      // Primary slot exists but is unreadable — try the backup before giving up.
      console.warn('[SaveManager] primary save unreadable, trying backup');
      parsed = safeParse(await this.platform.read(SaveManager.BACKUP_KEY));
    }

    const result = migrateSave(parsed, fallbackSeed);
    this.data = result.data;
    this.lastMigration = {
      migrated: result.migrated,
      recovered: result.recovered && raw !== null,
      fromVersion: result.fromVersion,
    };

    if (result.migrated) {
      console.info(`[SaveManager] migrated save v${result.fromVersion} -> v${SAVE_VERSION}`);
      // Persist the migrated shape immediately so we never migrate twice.
      await this.flush(true);
    }
  }

  private async loadSettings(): Promise<void> {
    const deviceLocale = this.platform.getPreferredLanguage();
    const defaults = createDefaultSettings(deviceLocale);
    const parsed = safeParse(await this.platform.read(SETTINGS_KEY));

    if (parsed && typeof parsed === 'object') {
      const incoming = parsed as Partial<SettingsData>;
      this.settingsData = { ...defaults, ...incoming, version: SAVE_VERSION };
      // A stored locale only wins if the player actually chose it.
      if (!this.settingsData.localeIsExplicit) {
        this.settingsData.locale = deviceLocale;
      }
    } else {
      this.settingsData = defaults;
    }
  }

  /** Mutate the save and schedule an autosave. */
  update(mutator: (data: SaveData) => void): void {
    mutator(this.data);
    this.markDirty();
  }

  updateSettings(mutator: (settings: SettingsData) => void): void {
    mutator(this.settingsData);
    void this.writeSettings();
    this.bus.emit('settings:changed');
  }

  markDirty(): void {
    this.dirty = true;
    if (this.writeTimer !== null) return;
    this.writeTimer = setTimeout(() => {
      this.writeTimer = null;
      void this.flush();
    }, SaveManager.AUTOSAVE_DEBOUNCE_MS);
  }

  /**
   * Write immediately. Called on app background, day end, and purchase.
   * @param force writes even when nothing is marked dirty.
   */
  async flush(force = false): Promise<void> {
    if (this.writing) return;
    if (!this.dirty && !force) return;
    this.writing = true;
    try {
      this.data.updatedAt = Date.now();
      this.data.version = SAVE_VERSION;
      const serialized = JSON.stringify(this.data);

      // Keep the previous good copy before overwriting the primary slot.
      const previous = await this.platform.read(SAVE_KEY);
      if (previous) await this.platform.write(SaveManager.BACKUP_KEY, previous);

      await this.platform.write(SAVE_KEY, serialized);
      this.dirty = false;
      this.bus.emit('save:written');
    } catch (error) {
      console.error('[SaveManager] write failed', error);
    } finally {
      this.writing = false;
    }
  }

  private async writeSettings(): Promise<void> {
    try {
      await this.platform.write(SETTINGS_KEY, JSON.stringify(this.settingsData));
    } catch (error) {
      console.error('[SaveManager] settings write failed', error);
    }
  }

  /** Parent Area action. Requires an explicit confirmation in the UI first. */
  async resetProgress(): Promise<void> {
    const seed = Date.now() & 0x7fffffff;
    this.data = createNewSave(seed);
    this.dirty = true;
    await this.flush(true);
  }
}

function safeParse(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
