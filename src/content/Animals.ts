import type { AnimalDefinition } from './Types';

/**
 * The farm's animals.
 *
 * Personality is deliberately simple but *recognisable*: a child should be able
 * to say "Luna is the nosy chicken" after two days. The AnimalAgent turns
 * `temperament` into actual behaviour.
 */
export const ANIMALS: AnimalDefinition[] = [
  /* ---------------- cows ---------------- */
  {
    id: 'bella',
    kind: 'cow',
    nameKey: 'animal.bella',
    temperament: 'gentle',
    area: 'pasture',
    colorVariant: 0,
    scale: 1.0,
    verbs: ['feed', 'water', 'milk', 'pet'],
    produces: [{ item: 'milk', verb: 'milk', count: 1 }],
    eats: 'hay',
    voice: { base: 118, kind: 'moo' },
    moveSpeed: 0.55,
  },
  {
    id: 'rosie',
    kind: 'cow',
    nameKey: 'animal.rosie',
    temperament: 'sleepy',
    area: 'pasture',
    colorVariant: 1,
    scale: 0.96,
    verbs: ['feed', 'pet'],
    eats: 'hay',
    voice: { base: 104, kind: 'moo' },
    moveSpeed: 0.42,
    requiresPremium: true,
  },

  /* ---------------- sheep ---------------- */
  {
    id: 'milo',
    kind: 'sheep',
    nameKey: 'animal.milo',
    temperament: 'playful',
    area: 'pasture',
    colorVariant: 0,
    scale: 1.0,
    verbs: ['feed', 'pet'],
    eats: 'hay',
    voice: { base: 320, kind: 'baa' },
    moveSpeed: 0.85,
  },
  {
    id: 'wooly',
    kind: 'sheep',
    nameKey: 'animal.wooly',
    temperament: 'shy',
    area: 'pasture',
    colorVariant: 1,
    scale: 0.92,
    verbs: ['feed', 'pet'],
    eats: 'hay',
    voice: { base: 355, kind: 'baa' },
    moveSpeed: 0.8,
  },
  {
    id: 'pip',
    kind: 'sheep',
    nameKey: 'animal.pip',
    temperament: 'playful',
    area: 'pasture',
    colorVariant: 2,
    scale: 0.7, // a lamb
    verbs: ['feed', 'pet'],
    eats: 'hay',
    voice: { base: 460, kind: 'bleat' },
    moveSpeed: 1.1,
  },

  /* ---------------- chickens ---------------- */
  {
    id: 'luna',
    kind: 'chicken',
    nameKey: 'animal.luna',
    temperament: 'curious',
    area: 'coop',
    colorVariant: 0,
    scale: 1.0,
    verbs: ['feed', 'collect', 'pet'],
    produces: [{ item: 'egg', verb: 'collect', count: 1 }],
    eats: 'grain',
    voice: { base: 720, kind: 'cluck' },
    moveSpeed: 1.25,
  },
  {
    id: 'speckle',
    kind: 'chicken',
    nameKey: 'animal.speckle',
    temperament: 'playful',
    area: 'coop',
    colorVariant: 1,
    scale: 0.95,
    verbs: ['feed', 'collect', 'pet'],
    produces: [{ item: 'egg', verb: 'collect', count: 1 }],
    eats: 'grain',
    voice: { base: 790, kind: 'cluck' },
    moveSpeed: 1.3,
  },
  {
    id: 'henny',
    kind: 'chicken',
    nameKey: 'animal.henny',
    temperament: 'sleepy',
    area: 'coop',
    colorVariant: 2,
    scale: 1.02,
    verbs: ['feed', 'collect', 'pet'],
    produces: [{ item: 'egg', verb: 'collect', count: 1 }],
    eats: 'grain',
    voice: { base: 660, kind: 'cluck' },
    moveSpeed: 1.1,
  },
];

export const ANIMALS_BY_ID = new Map(ANIMALS.map((a) => [a.id, a]));

export function animalsFor(premium: boolean): AnimalDefinition[] {
  return ANIMALS.filter((a) => premium || !a.requiresPremium);
}
