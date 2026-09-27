import { describe, it, expect } from 'vitest';
import {
  MILESTONES,
  HAT_COUNT,
  FREE_OUTFITS,
  heartsForHat,
  heartsForOutfit,
  farmFeaturesAt,
  milestonesReachedAt,
  nextMilestone,
} from '../src/content/Milestones';
import { OUTFIT_PRIMARY, OUTFIT_SECONDARY } from '../src/art/Palette';
import { LOCALES } from '../src/localization/Localization';
import { migrateSave } from '../src/save/Migrations';

/**
 * Heart milestones are the game's only progression, so they must be
 * reachable, never lost, and never celebrated twice.
 */
describe('heart milestones', () => {
  it('have unique ids and strictly rising thresholds', () => {
    const ids = MILESTONES.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (let i = 1; i < MILESTONES.length; i++) {
      expect(MILESTONES[i].hearts, MILESTONES[i].id).toBeGreaterThan(MILESTONES[i - 1].hearts);
    }
    expect(MILESTONES[0].hearts).toBeGreaterThan(0);
  });

  it('every milestone has a line in every language', () => {
    for (const locale of LOCALES) {
      for (const m of MILESTONES) {
        expect(locale.table[`milestone.${m.id}`], `${locale.code}:${m.id}`).toBeTruthy();
      }
    }
  });

  it('every hat and outfit reward exists, and each is earned exactly once', () => {
    const hats = MILESTONES.flatMap((m) => (m.reward.kind === 'hat' ? [m.reward.hat] : []));
    const outfits = MILESTONES.flatMap((m) => (m.reward.kind === 'outfit' ? [m.reward.outfit] : []));
    expect(new Set(hats).size).toBe(hats.length);
    expect(new Set(outfits).size).toBe(outfits.length);
    for (const hat of hats) expect(hat).toBeGreaterThan(0), expect(hat).toBeLessThan(HAT_COUNT);
    for (let hat = 1; hat < HAT_COUNT; hat++) expect(heartsForHat(hat), `hat ${hat}`).toBeLessThan(Infinity);
    for (const outfit of outfits) expect(outfit).toBeGreaterThanOrEqual(FREE_OUTFITS);
    expect(OUTFIT_PRIMARY.length).toBe(OUTFIT_SECONDARY.length);
    for (let o = 0; o < OUTFIT_PRIMARY.length; o++) {
      expect(heartsForOutfit(o), `outfit ${o}`).toBeLessThan(Infinity);
    }
  });

  it('the starting look is free', () => {
    expect(heartsForHat(0)).toBe(0);
    for (let o = 0; o < FREE_OUTFITS; o++) expect(heartsForOutfit(o)).toBe(0);
  });

  it('unlocks follow the heart total', () => {
    expect(milestonesReachedAt(0)).toEqual([]);
    expect(farmFeaturesAt(0)).toEqual([]);
    const all = MILESTONES[MILESTONES.length - 1].hearts;
    expect(milestonesReachedAt(all)).toHaveLength(MILESTONES.length);
    expect(nextMilestone(all)).toBeNull();
    expect(nextMilestone(0)?.id).toBe(MILESTONES[0].id);
  });
});

describe('v3 -> v4 migration', () => {
  it('adds a bare head and marks already-earned milestones as seen', () => {
    const v3 = {
      version: 3,
      worldSeed: 7,
      day: 9,
      hearts: 60,
      child: { preset: 'boy', skinTone: 2, hairStyle: 1, hairColor: 0, outfit: 3, name: '' },
    };
    const { data } = migrateSave(v3, 1);
    expect(data.child.hat).toBe(0);
    expect(data.child.outfit).toBe(3);
    // Someone updating mid-game must not get a burst of old celebrations.
    expect(data.milestonesSeen).toEqual(milestonesReachedAt(60));
    expect(data.hearts).toBe(60);
  });
});

import { pickSpread } from '../src/gameplay/Storybook';

describe('storybook photo choice', () => {
  const shots = (ids: string[]) => ids.map((activityId, i) => ({ activityId, image: String(i) }));

  it('keeps everything when there are few photos', () => {
    expect(pickSpread(shots(['a', 'b']), 3).map((s) => s.activityId)).toEqual(['a', 'b']);
  });

  it('spreads across the day, first to last', () => {
    const picked = pickSpread(shots(['a', 'b', 'c', 'd', 'e', 'f', 'g']), 3);
    expect(picked.map((s) => s.activityId)).toEqual(['a', 'd', 'g']);
  });

  it('never shows the same activity twice', () => {
    const picked = pickSpread(shots(['a', 'a', 'a', 'b', 'b', 'c']), 3);
    expect(picked.map((s) => s.activityId)).toEqual(['a', 'b', 'c']);
  });
});
