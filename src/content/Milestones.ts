/**
 * Heart milestones: what hearts are for.
 *
 * Every milestone is known in advance and reached the same way by every
 * child: no randomness, no shop, nothing to lose. Hearts are never spent, so
 * whether something is unlocked is a pure function of the heart total, and
 * the save only records which celebrations have already played.
 *
 * Spacing: a full day earns roughly fifteen to twenty hearts, so the first few
 * arrive on day one and later ones every couple of days, which keeps something
 * to look forward to well past the first week.
 *
 * TO ADD A MILESTONE: add a row here, a `milestone.<id>` key in every locale,
 * and for a new farm feature a builder in world/FarmFeatures.ts.
 */

export type FarmFeature = 'swing' | 'bench' | 'birdhouse' | 'scarecrow' | 'lanterns';

export type MilestoneReward =
  | { kind: 'hat'; hat: number }
  | { kind: 'outfit'; outfit: number }
  | { kind: 'farm'; feature: FarmFeature };

export interface Milestone {
  id: string;
  hearts: number;
  icon: string;
  reward: MilestoneReward;
}

export const MILESTONES: readonly Milestone[] = [
  { id: 'strawhat', hearts: 5, icon: '👒', reward: { kind: 'hat', hat: 1 } },
  { id: 'swing', hearts: 15, icon: '🛝', reward: { kind: 'farm', feature: 'swing' } },
  { id: 'tealoutfit', hearts: 30, icon: '👕', reward: { kind: 'outfit', outfit: 6 } },
  { id: 'bench', hearts: 50, icon: '🪑', reward: { kind: 'farm', feature: 'bench' } },
  { id: 'flowercrown', hearts: 75, icon: '🌼', reward: { kind: 'hat', hat: 2 } },
  { id: 'birdhouse', hearts: 100, icon: '🐦', reward: { kind: 'farm', feature: 'birdhouse' } },
  { id: 'pinkoutfit', hearts: 130, icon: '👗', reward: { kind: 'outfit', outfit: 7 } },
  { id: 'scarecrow', hearts: 165, icon: '🌾', reward: { kind: 'farm', feature: 'scarecrow' } },
  { id: 'bobblehat', hearts: 200, icon: '🧶', reward: { kind: 'hat', hat: 3 } },
  { id: 'lanterns', hearts: 240, icon: '🏮', reward: { kind: 'farm', feature: 'lanterns' } },
  { id: 'crown', hearts: 290, icon: '👑', reward: { kind: 'hat', hat: 4 } },
];

/** Hats 1..HAT_COUNT-1 exist; 0 is "no hat". */
export const HAT_COUNT = 5;
/** Outfits below this index are free from the start. */
export const FREE_OUTFITS = 6;

export const MILESTONES_BY_ID = new Map(MILESTONES.map((m) => [m.id, m]));

/** Hearts needed for a hat, or 0 if it is free. */
export function heartsForHat(hat: number): number {
  if (hat === 0) return 0;
  const m = MILESTONES.find((x) => x.reward.kind === 'hat' && x.reward.hat === hat);
  return m ? m.hearts : Infinity;
}

/** Hearts needed for an outfit, or 0 if it is free. */
export function heartsForOutfit(outfit: number): number {
  if (outfit < FREE_OUTFITS) return 0;
  const m = MILESTONES.find((x) => x.reward.kind === 'outfit' && x.reward.outfit === outfit);
  return m ? m.hearts : Infinity;
}

export function farmFeaturesAt(hearts: number): FarmFeature[] {
  const out: FarmFeature[] = [];
  for (const m of MILESTONES) {
    if (m.reward.kind === 'farm' && hearts >= m.hearts) out.push(m.reward.feature);
  }
  return out;
}

/** Ids of every milestone reached at this heart total. */
export function milestonesReachedAt(hearts: number): string[] {
  return MILESTONES.filter((m) => hearts >= m.hearts).map((m) => m.id);
}

/** The next milestone still ahead, for "N more hearts" hints. */
export function nextMilestone(hearts: number): Milestone | null {
  return MILESTONES.find((m) => m.hearts > hearts) ?? null;
}
