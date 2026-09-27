import type { EventBus } from './EventBus';
import type { QualitySettings, FormFactor } from './DeviceProfile';
import type { SaveManager } from '../save/SaveManager';
import type { Localization } from '../localization/Localization';
import type { AudioManager } from '../audio/AudioManager';
import type { IPlatform } from '../platform/IPlatform';
import type { Entitlements } from '../monetization/Entitlements';
import type { Rng } from './Rng';
import type { CrashLog } from './CrashLog';

/**
 * The single object every system receives. It is deliberately a plain bag of
 * interfaces rather than a DI framework: it stays readable, and swapping any
 * implementation (platform, store, audio) is a one-line change in bootstrap.
 */
export interface GameContext {
  readonly bus: EventBus;
  readonly platform: IPlatform;
  readonly save: SaveManager;
  readonly loc: Localization;
  readonly audio: AudioManager;
  readonly entitlements: Entitlements;
  /** On-device problem log, shown in the Parent Area. Absent in tests. */
  readonly crashLog?: CrashLog;
  /** Seeded from the save file; the farm looks identical on every launch. */
  readonly worldRng: Rng;

  quality: QualitySettings;
  formFactor: FormFactor;

  /** Seconds since last frame, already clamped against tab-switch spikes. */
  dt: number;
  /** Seconds since the game started (excludes paused time). */
  elapsed: number;
  paused: boolean;
}

/**
 * Anything that participates in the frame loop. Systems are updated in the
 * order they were registered, which is the only ordering guarantee they get.
 */
export interface GameSystem {
  readonly name: string;
  init?(ctx: GameContext): void | Promise<void>;
  update?(ctx: GameContext): void;
  /** Called after all updates — use for camera / render-facing work. */
  lateUpdate?(ctx: GameContext): void;
  onQualityChanged?(ctx: GameContext): void;
  onResize?(width: number, height: number): void;
  dispose?(): void;
}
