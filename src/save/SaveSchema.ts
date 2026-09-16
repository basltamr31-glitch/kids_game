/**
 * Save data schema.
 *
 * RULES FOR CHANGING THIS FILE
 * 1. Never remove or repurpose an existing field. Add new ones.
 * 2. Bump SAVE_VERSION and add a migration in Migrations.ts for every change.
 * 3. Every new field must have a default in `createNewSave` so an old save that
 *    lacks it still loads. A child losing their farm to an update is the single
 *    worst bug this project can ship.
 */

export const SAVE_VERSION = 3;
export const SAVE_KEY = 'lad.save.v1'; // key is stable; the *contents* are versioned
export const SETTINGS_KEY = 'lad.settings.v1';

export type Season = 'spring' | 'summer' | 'autumn' | 'winter';
export type Weather = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'fog';
export type DayPhase = 'morning' | 'midday' | 'afternoon' | 'evening' | 'night';

export interface CharacterAppearance {
  preset: 'boy' | 'girl';
  skinTone: number; // index into Palette.SKIN_TONES
  hairStyle: number;
  hairColor: number;
  outfit: number;
  name: string;
}

export interface AnimalSaveState {
  id: string;
  /** 0..1 — drifts down over a day, topped up by feeding. Never reaches "unhappy". */
  fed: number;
  watered: number;
  /** Cows only: refills overnight. */
  milkReady: boolean;
  /** Chickens only. */
  eggsAvailable: number;
  /** Rises when the child feeds, pets or plays with this animal. */
  bond: number;
  petToday: boolean;
}

export interface PlantSaveState {
  id: string;
  /** 0 = seed, 1 = ripe. */
  growth: number;
  watered: boolean;
  harvestable: boolean;
}

export interface DayRecord {
  day: number;
  season: Season;
  weather: Weather;
  tasksCompleted: number;
  tasksTotal: number;
  hearts: number;
}

export interface SaveData {
  version: number;
  createdAt: number;
  updatedAt: number;

  /** Seeds the whole procedural world; fixed at first launch. */
  worldSeed: number;

  child: CharacterAppearance;

  /* --- progression --- */
  day: number;
  phase: DayPhase;
  /** In-world clock, 0..24. */
  hour: number;
  season: Season;
  /** Days elapsed inside the current season. */
  seasonDay: number;
  weather: Weather;

  /** Activity ids finished during the current day. */
  completedToday: string[];
  /** Total completions per activity id, across all days — drives variety weighting. */
  completionCounts: Record<string, number>;

  hearts: number;
  stickers: string[];
  /** Nature Book entries the child has found. */
  discoveries: string[];

  animals: AnimalSaveState[];
  plants: PlantSaveState[];
  inventory: Record<string, number>;

  unlockedAreas: string[];
  history: DayRecord[];

  /** True once the day-1 guided sequence has been seen. */
  tutorialDone: boolean;
  /** Ids of one-off story beats already played, so they never repeat. */
  seenStoryBeats: string[];
}

export interface SettingsData {
  version: number;
  locale: string;
  /** null = follow the device language. */
  localeIsExplicit: boolean;
  musicVolume: number;
  sfxVolume: number;
  ambienceVolume: number;
  haptics: boolean;
  /** null = auto-detect + adapt. */
  qualityOverride: 'low' | 'medium' | 'high' | null;
  /** Scales all UI by this factor, for accessibility. */
  uiScale: number;
  subtitles: boolean;
  reducedMotion: boolean;
  /** Premium entitlement cache. Authoritative source is always the store. */
  premiumUnlocked: boolean;
}

export function createNewSave(worldSeed: number, now = Date.now()): SaveData {
  return {
    version: SAVE_VERSION,
    createdAt: now,
    updatedAt: now,
    worldSeed,
    child: {
      preset: 'girl',
      skinTone: 1,
      hairStyle: 0,
      hairColor: 2,
      outfit: 0,
      name: '',
    },
    day: 1,
    phase: 'morning',
    hour: 7,
    season: 'summer',
    seasonDay: 1,
    weather: 'sunny',
    completedToday: [],
    completionCounts: {},
    hearts: 0,
    stickers: [],
    discoveries: [],
    animals: [],
    plants: [],
    inventory: {},
    unlockedAreas: ['farmyard', 'house', 'barn', 'coop', 'pasture', 'garden'],
    history: [],
    tutorialDone: false,
    seenStoryBeats: [],
  };
}

export function createDefaultSettings(deviceLocale: string): SettingsData {
  return {
    version: SAVE_VERSION,
    locale: deviceLocale,
    localeIsExplicit: false,
    musicVolume: 0.6,
    sfxVolume: 0.85,
    ambienceVolume: 0.7,
    haptics: true,
    qualityOverride: null,
    uiScale: 1,
    subtitles: true,
    reducedMotion: false,
    premiumUnlocked: false,
  };
}
