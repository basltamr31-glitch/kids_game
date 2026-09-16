import type { DayDefinition } from './Types';

/**
 * Scripted opening days.
 *
 * Day 1 is the tutorial, but it never says the word "tutorial" and never stops
 * the child to explain a control. It simply gives them a short, clear list of
 * lovely things to do, in an order that teaches one idea at a time:
 *   walk -> interact -> carry something -> give it to someone -> rest.
 *
 * Days 2 and 3 widen the world a little. From Day 4 the DayDirector generates
 * days from the activity pool, so the rhythm continues indefinitely.
 */
export const SCRIPTED_DAYS: DayDefinition[] = [
  {
    id: 'day1',
    day: 1,
    weather: 'sunny',
    season: 'summer',
    schedule: [
      { phase: 'morning', activities: ['wakeup', 'getdressed', 'breakfast', 'feedcow'] },
      { phase: 'midday', activities: ['feedsheep', 'feedchickens', 'collecteggs', 'milkcow'] },
      { phase: 'afternoon', activities: ['bringmilk', 'helpcook', 'playoutside'] },
      { phase: 'evening', activities: ['dinner'] },
      { phase: 'night', activities: ['brushteeth', 'bedtime'] },
    ],
    beats: [
      { phase: 'morning', actor: 'mother', textKey: 'speech.mother.goodmorning' },
      { phase: 'midday', actor: 'mother', textKey: 'speech.mother.animals' },
      { phase: 'evening', actor: 'father', textKey: 'speech.father.thanks' },
    ],
  },
  {
    id: 'day2',
    day: 2,
    weather: 'cloudy',
    season: 'summer',
    schedule: [
      { phase: 'morning', activities: ['wakeup', 'getdressed', 'breakfast', 'feedchickens'] },
      { phase: 'midday', activities: ['feedcow', 'watercow', 'waterplants', 'collecteggs'] },
      { phase: 'afternoon', activities: ['helpfence', 'pickapples', 'petanimal'] },
      { phase: 'evening', activities: ['dinner'] },
      { phase: 'night', activities: ['brushteeth', 'bedtime'] },
    ],
    beats: [
      { phase: 'morning', actor: 'father', textKey: 'speech.father.hello' },
      { phase: 'afternoon', actor: 'father', textKey: 'speech.father.fence' },
    ],
  },
  {
    id: 'day3',
    day: 3,
    weather: 'rain',
    season: 'summer',
    schedule: [
      { phase: 'morning', activities: ['wakeup', 'getdressed', 'breakfast'] },
      { phase: 'midday', activities: ['feedcow', 'feedsheep', 'feedchickens', 'indoorplay'] },
      { phase: 'afternoon', activities: ['helpcook', 'collecteggs', 'petanimal'] },
      { phase: 'evening', activities: ['dinner'] },
      { phase: 'night', activities: ['brushteeth', 'bedtime'] },
    ],
    beats: [
      { phase: 'morning', actor: 'mother', textKey: 'speech.mother.rain' },
      { phase: 'midday', actor: 'mother', textKey: 'speech.mother.cook' },
    ],
  },
];

export const SCRIPTED_DAYS_BY_NUMBER = new Map(
  SCRIPTED_DAYS.filter((d) => d.day !== undefined).map((d) => [d.day!, d]),
);

/** Tuning for the procedural day generator (day 4 onwards). */
export const DAY_GENERATION = {
  /** Variable (non-fixed) activities offered per phase. */
  activitiesPerPhase: { morning: 2, midday: 3, afternoon: 3, evening: 0, night: 0 } as Record<
    string,
    number
  >,
  /**
   * An activity done recently is temporarily less likely, so days feel
   * different without ever locking a favourite chore away from the child.
   */
  repeatPenalty: 0.45,
  /** How many days back the penalty looks. */
  repeatMemoryDays: 3,
  /** Chance that a discovery is seeded somewhere in the world for the day. */
  discoveryChance: 0.75,
  /** Days in a season before it rolls over. */
  seasonLength: 12,
};

/** Weather probabilities per season. Columns: sunny, cloudy, rain, snow, fog. */
export const WEATHER_TABLE: Record<string, Record<string, number>> = {
  spring: { sunny: 0.38, cloudy: 0.27, rain: 0.25, snow: 0.0, fog: 0.1 },
  summer: { sunny: 0.55, cloudy: 0.24, rain: 0.15, snow: 0.0, fog: 0.06 },
  autumn: { sunny: 0.3, cloudy: 0.3, rain: 0.24, snow: 0.02, fog: 0.14 },
  winter: { sunny: 0.24, cloudy: 0.26, rain: 0.04, snow: 0.38, fog: 0.08 },
};

export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'] as const;
