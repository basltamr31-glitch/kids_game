import type { Vector3 } from 'three';
import type { ActivityDefinition } from '../content/Types';
import type { DayPhase, Weather } from '../save/SaveSchema';

/**
 * What the child might like to do next.
 *
 * The day already knew what was left on the list; it did not know anything
 * about the moment the child is standing in. The same five tasks were offered
 * in the same order whether it was raining or sunny, whether the animals had
 * been fed, and whether the child was in the kitchen or out at the far fence.
 *
 * This does not add activities or invent a new system. It reorders the ones
 * the day already holds and gives them a heading that sounds like somebody
 * asking, which is the difference between a checklist and a question.
 *
 * Deliberately a handful of legible rules rather than a scoring model nobody
 * can reason about. Each one should be explainable to a parent watching over
 * a child's shoulder: it is raining, so the indoor things came first.
 */

export interface SuggestionContext {
  phase: DayPhase;
  weather: Weather;
  /** Where the child is standing. */
  position: Vector3;
  /** True when they are indoors. */
  indoors: boolean;
  /** Animals with an unmet need right now. */
  hungryAnimals: number;
  thirstyAnimals: number;
  /** Resolves an activity's anchor, for "what is near me". */
  anchorPosition: (id: string) => Vector3 | null;
}

/** Ids that happen inside the house. */
const INDOOR = new Set([
  'wakeup', 'getdressed', 'breakfast', 'dinner', 'brushteeth', 'bedtime',
  'helpcook', 'indoorplay', 'bringmilk',
]);

/** Ids that are no fun in the rain. */
const OUTDOOR_PLAY = new Set([
  'playoutside', 'explore', 'visitstream', 'smellflowers', 'pickapples', 'sweepyard',
]);

const FEEDING = new Set(['feedcow', 'feedsheep', 'feedchickens']);
const WATERING = new Set(['watercow', 'waterplants']);

/**
 * The line above the list.
 *
 * Phase first, because that is what a child actually feels; weather only
 * overrides it when the weather is the notable thing about right now.
 */
export function suggestionHeading(context: SuggestionContext): string {
  if (context.weather === 'rain' && context.phase !== 'night') return 'suggest.rain';
  if (context.weather === 'snow' && context.phase !== 'night') return 'suggest.snow';
  switch (context.phase) {
    case 'morning': return 'suggest.morning';
    case 'midday': return 'suggest.midday';
    case 'afternoon': return 'suggest.afternoon';
    case 'evening': return 'suggest.evening';
    default: return 'suggest.night';
  }
}

/**
 * Orders the day's remaining activities by how well they fit right now.
 *
 * Stable: equal scores keep the day plan's own order, so the fixed rhythm
 * still reads as a rhythm rather than shuffling about.
 */
export function rankSuggestions(
  activities: ActivityDefinition[],
  context: SuggestionContext,
): ActivityDefinition[] {
  const scored = activities.map((activity, index) => ({
    activity,
    index,
    score: scoreActivity(activity, context),
  }));
  scored.sort((a, b) => (b.score - a.score) || (a.index - b.index));
  return scored.map((s) => s.activity);
}

function scoreActivity(activity: ActivityDefinition, context: SuggestionContext): number {
  let score = 0;

  // An animal that needs something is the most pressing thing on a farm, and
  // it is the clearest cause-and-effect a small child can follow.
  if (context.hungryAnimals > 0 && FEEDING.has(activity.id)) score += 40;
  if (context.thirstyAnimals > 0 && WATERING.has(activity.id)) score += 30;

  // Weather. Rain does not stop chores — animals still eat — but it does make
  // running about outside a worse suggestion than staying in.
  const wet = context.weather === 'rain' || context.weather === 'snow';
  if (wet && OUTDOOR_PLAY.has(activity.id)) score -= 35;
  if (wet && INDOOR.has(activity.id)) score += 20;

  // Where they already are. Being inside and being offered the kitchen first
  // is simply more helpful than being offered the far fence.
  if (context.indoors && INDOOR.has(activity.id)) score += 18;
  if (!context.indoors && !INDOOR.has(activity.id)) score += 10;

  // Distance, as a gentle tiebreak rather than a deciding factor: the nearest
  // thing is not always the thing you most want to do.
  const anchor = context.anchorPosition(activity.anchor);
  if (anchor) {
    const distance = Math.hypot(
      anchor.x - context.position.x,
      anchor.z - context.position.z,
    );
    score += Math.max(0, 12 - distance * 0.35);
  }

  // Meals belong to their part of the day, and a child who is being asked
  // "what shall we do?" at dinner time should see dinner near the top.
  if (activity.phases.length === 1 && activity.phases[0] === context.phase) score += 14;

  return score;
}
