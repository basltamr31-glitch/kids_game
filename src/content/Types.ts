import type { Season, Weather, DayPhase } from '../save/SaveSchema';

/**
 * Content definition types.
 *
 * Everything the designer can tune lives in these shapes. Adding a new animal,
 * activity or day requires a new entry in the relevant registry and no engine
 * changes at all — that is the whole point of this layer.
 */

export type InteractionVerb =
  | 'feed'
  | 'water'
  | 'milk'
  | 'collect'
  | 'pick'
  | 'pet'
  | 'talk'
  | 'open'
  | 'take'
  | 'give'
  | 'use'
  | 'sleep'
  | 'look'
  | 'play';

export type AnimalKind = 'cow' | 'sheep' | 'chicken' | 'horse' | 'goat' | 'rabbit' | 'dog' | 'cat';

/** How an animal behaves when nobody is asking anything of it. */
export type AnimalTemperament =
  | 'gentle' // drifts slowly, likes being near the child
  | 'playful' // wanders more, small hops
  | 'curious' // actively walks toward the child sometimes
  | 'shy' // keeps a little distance, still friendly
  | 'sleepy'; // idles a lot, lies down

export interface AnimalDefinition {
  id: string;
  kind: AnimalKind;
  /** Localization key for the animal's name. */
  nameKey: string;
  temperament: AnimalTemperament;
  /** Home area id; the animal wanders within this area's bounds. */
  area: string;
  /** Body tint index into the palette for this kind. */
  colorVariant: number;
  scale: number;
  /** Which interactions this animal offers. */
  verbs: InteractionVerb[];
  /** Produces these when the matching activity runs. */
  produces?: { item: string; verb: InteractionVerb; count: number }[];
  /** Item id this animal eats. */
  eats?: string;
  /** Voice parameters for the procedural sound synth. */
  voice: { base: number; kind: 'moo' | 'baa' | 'cluck' | 'neigh' | 'bleat' | 'squeak' | 'woof' };
  moveSpeed: number;
  /** Premium gate. Free animals have no requirement. */
  requiresPremium?: boolean;
}

export type StepKind =
  | 'walkTo' // child walks to a world anchor
  | 'face' // turn toward a target
  | 'animate' // play a child animation clip
  | 'wait'
  | 'speech' // a character says a line
  | 'emote' // floating emoji above a character
  | 'giveItem'
  | 'takeItem'
  | 'setFlag'
  | 'animalReact'
  | 'cameraFocus'
  | 'fadeTo'; // screen fade (used for sleeping / entering the house)

export interface ActivityStep {
  kind: StepKind;
  /** World anchor id, actor id, or item id depending on `kind`. */
  target?: string;
  /** Animation clip name for `animate`. */
  clip?: string;
  /** Seconds. */
  duration?: number;
  /** Localization key for `speech`. */
  textKey?: string;
  item?: string;
  count?: number;
  emote?: string;
  flag?: string;
}

export interface ActivityDefinition {
  id: string;
  titleKey: string;
  /** Emoji-style icon rendered in the task card and world bubble. */
  icon: string;
  verb: InteractionVerb;
  /** World anchor the child must be near for the prompt to appear. */
  anchor: string;
  /** Ordered steps that play out when the activity runs. */
  steps: ActivityStep[];
  rewards: {
    hearts: number;
    items?: { id: string; count: number }[];
    stickerId?: string;
    discoveryId?: string;
  };
  /** Phases in which this activity may be offered. */
  phases: DayPhase[];
  /** Seasons in which it makes sense. Empty means any. */
  seasons?: Season[];
  /** Weather in which it makes sense. Empty means any. */
  weather?: Weather[];
  /** Item ids that must be in the inventory to start. */
  requiresItems?: string[];
  /** Other activity ids that must be done first, same day. */
  requiresActivities?: string[];
  /** Higher = more likely to be picked for a generated day. */
  weight: number;
  /** Once per day at most (almost everything is). */
  oncePerDay: boolean;
  requiresPremium?: boolean;
  /** Advances the in-world clock by this many hours on completion. */
  hoursCost: number;
}

export interface DayDefinition {
  id: string;
  /** Scripted days pin the day number; generated days leave it undefined. */
  day?: number;
  weather?: Weather;
  season?: Season;
  /** Ordered activity ids, grouped by the phase they belong to. */
  schedule: { phase: DayPhase; activities: string[] }[];
  /** Story beats keyed by phase, played once. */
  beats?: { phase: DayPhase; textKey: string; actor: string }[];
}

export interface ItemDefinition {
  id: string;
  nameKey: string;
  icon: string;
  /** Carried items appear in the child's hands and block picking up another. */
  carried: boolean;
  /** Stack limit in the inventory. */
  max: number;
}

export interface DiscoveryDefinition {
  id: string;
  nameKey: string;
  icon: string;
  category: 'creature' | 'plant' | 'place';
  /** Where in the world it can appear. */
  area: string;
  seasons?: Season[];
  weather?: Weather[];
  /** Chance per eligible day that it spawns at all. */
  chance: number;
}

export interface AreaDefinition {
  id: string;
  /** Axis-aligned bounds on the ground plane, used for wandering and spawning. */
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  indoor: boolean;
  requiresPremium?: boolean;
}
