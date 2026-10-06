/**
 * Content registry — the single import point for all game data.
 *
 * TO ADD NEW CONTENT
 *   New animal    -> src/content/Animals.ts
 *   New activity  -> src/content/Activities.ts  (+ a title key in every locale)
 *   New item      -> src/content/Items.ts
 *   New discovery -> src/content/Items.ts (DISCOVERIES)
 *   New area      -> src/content/Items.ts (AREAS) + an anchor in WorldBuilder
 *   New fixed day -> src/content/Days.ts
 *   Heart reward  -> src/content/Milestones.ts
 * Nothing under src/gameplay needs to change for any of the above.
 */
export * from './Types';
export * from './Animals';
export * from './Activities';
export * from './Items';
export * from './Days';
export * from './Milestones';

import { ACTIVITIES_BY_ID } from './Activities';
import { ANIMALS_BY_ID } from './Animals';
import { ITEMS_BY_ID, DISCOVERIES_BY_ID, AREAS_BY_ID } from './Items';

/**
 * Integrity check for the content tables. Run by the test suite and, in dev
 * builds, at boot — a typo'd anchor or item id should be caught by the person
 * who wrote it, not by a child whose task list will not complete.
 */
export function validateContent(): string[] {
  const problems: string[] = [];

  for (const [id, activity] of ACTIVITIES_BY_ID) {
    for (const needed of activity.requiresItems ?? []) {
      if (!ITEMS_BY_ID.has(needed)) {
        problems.push(`activity "${id}" requires unknown item "${needed}"`);
      }
    }
    for (const needed of activity.requiresActivities ?? []) {
      if (!ACTIVITIES_BY_ID.has(needed)) {
        problems.push(`activity "${id}" requires unknown activity "${needed}"`);
      }
      if (needed === id) problems.push(`activity "${id}" requires itself`);
    }
    for (const reward of activity.rewards.items ?? []) {
      if (!ITEMS_BY_ID.has(reward.id)) {
        problems.push(`activity "${id}" rewards unknown item "${reward.id}"`);
      }
    }
    if (activity.rewards.discoveryId && !DISCOVERIES_BY_ID.has(activity.rewards.discoveryId)) {
      problems.push(`activity "${id}" rewards unknown discovery "${activity.rewards.discoveryId}"`);
    }
    for (const step of activity.steps) {
      if (step.item && !ITEMS_BY_ID.has(step.item)) {
        problems.push(`activity "${id}" step references unknown item "${step.item}"`);
      }
    }
    if (activity.phases.length === 0) {
      problems.push(`activity "${id}" is available in no phase`);
    }
  }

  for (const [id, animal] of ANIMALS_BY_ID) {
    if (!AREAS_BY_ID.has(animal.area)) {
      problems.push(`animal "${id}" lives in unknown area "${animal.area}"`);
    }
    if (animal.eats && !ITEMS_BY_ID.has(animal.eats)) {
      problems.push(`animal "${id}" eats unknown item "${animal.eats}"`);
    }
    for (const produced of animal.produces ?? []) {
      if (!ITEMS_BY_ID.has(produced.item)) {
        problems.push(`animal "${id}" produces unknown item "${produced.item}"`);
      }
    }
  }

  for (const [id, discovery] of DISCOVERIES_BY_ID) {
    if (!AREAS_BY_ID.has(discovery.area)) {
      problems.push(`discovery "${id}" is in unknown area "${discovery.area}"`);
    }
  }

  return problems;
}
