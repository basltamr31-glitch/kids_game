import type { ItemDefinition, DiscoveryDefinition, AreaDefinition } from './Types';

export const ITEMS: ItemDefinition[] = [
  { id: 'hay', nameKey: 'item.hay', icon: '🌾', carried: true, max: 3 },
  { id: 'grain', nameKey: 'item.grain', icon: '🌰', carried: true, max: 3 },
  { id: 'bucket', nameKey: 'item.bucket', icon: '🪣', carried: true, max: 1 },
  { id: 'milk', nameKey: 'item.milk', icon: '🥛', carried: true, max: 3 },
  { id: 'egg', nameKey: 'item.egg', icon: '🥚', carried: false, max: 12 },
  { id: 'apple', nameKey: 'item.apple', icon: '🍎', carried: false, max: 12 },
  { id: 'carrot', nameKey: 'item.carrot', icon: '🥕', carried: false, max: 12 },
  { id: 'tomato', nameKey: 'item.tomato', icon: '🍅', carried: false, max: 12 },
  { id: 'wateringcan', nameKey: 'item.wateringcan', icon: '🪴', carried: true, max: 1 },
  { id: 'flower', nameKey: 'item.flower', icon: '🌼', carried: false, max: 12 },
];

export const ITEMS_BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

/** Nature Book entries. Finding one is always a pleasant surprise, never a task. */
export const DISCOVERIES: DiscoveryDefinition[] = [
  {
    id: 'butterfly',
    nameKey: 'discovery.butterfly',
    icon: '🦋',
    category: 'creature',
    area: 'garden',
    seasons: ['spring', 'summer'],
    weather: ['sunny', 'cloudy'],
    chance: 0.55,
  },
  {
    id: 'bluebird',
    nameKey: 'discovery.bluebird',
    icon: '🐦',
    category: 'creature',
    area: 'orchard',
    weather: ['sunny', 'cloudy'],
    chance: 0.4,
  },
  {
    id: 'mushroom',
    nameKey: 'discovery.mushroom',
    icon: '🍄',
    category: 'plant',
    area: 'woods',
    seasons: ['autumn', 'summer'],
    chance: 0.5,
  },
  {
    id: 'alpineflower',
    nameKey: 'discovery.alpineflower',
    icon: '🌸',
    category: 'plant',
    area: 'meadow',
    seasons: ['spring', 'summer'],
    chance: 0.6,
  },
  {
    id: 'stream',
    nameKey: 'discovery.stream',
    icon: '💧',
    category: 'place',
    area: 'stream',
    chance: 1.0,
  },
  {
    id: 'viewpoint',
    nameKey: 'discovery.viewpoint',
    icon: '⛰️',
    category: 'place',
    area: 'meadow',
    chance: 0.9,
  },
  {
    id: 'beehive',
    nameKey: 'discovery.beehive',
    icon: '🐝',
    category: 'creature',
    area: 'orchard',
    seasons: ['spring', 'summer'],
    chance: 0.35,
  },
  {
    id: 'rabbit',
    nameKey: 'discovery.rabbit',
    icon: '🐇',
    category: 'creature',
    area: 'woods',
    chance: 0.35,
  },
  {
    id: 'pinecone',
    nameKey: 'discovery.pinecone',
    icon: '🌲',
    category: 'plant',
    area: 'woods',
    chance: 0.65,
  },
  {
    id: 'rainbow',
    nameKey: 'discovery.rainbow',
    icon: '🌈',
    category: 'place',
    area: 'meadow',
    weather: ['rain'],
    chance: 0.8,
  },
];

export const DISCOVERIES_BY_ID = new Map(DISCOVERIES.map((d) => [d.id, d]));

/**
 * Walkable areas. Bounds are in world units on the ground plane and are used
 * for animal wandering, discovery spawning and the premium gate.
 */
export const AREAS: AreaDefinition[] = [
  { id: 'farmyard', bounds: { minX: -14, maxX: 10, minZ: -6, maxZ: 14 }, indoor: false },
  { id: 'house', bounds: { minX: -26, maxX: -14, minZ: -8, maxZ: 4 }, indoor: true },
  { id: 'barn', bounds: { minX: 10, maxX: 26, minZ: -10, maxZ: 4 }, indoor: true },
  { id: 'coop', bounds: { minX: -8, maxX: 4, minZ: 14, maxZ: 26 }, indoor: false },
  { id: 'pasture', bounds: { minX: 12, maxX: 40, minZ: 6, maxZ: 34 }, indoor: false },
  { id: 'garden', bounds: { minX: -26, maxX: -12, minZ: 8, maxZ: 24 }, indoor: false },
  { id: 'orchard', bounds: { minX: -44, maxX: -28, minZ: -4, maxZ: 16 }, indoor: false },
  { id: 'meadow', bounds: { minX: -20, maxX: 24, minZ: 34, maxZ: 62 }, indoor: false },
  { id: 'stream', bounds: { minX: -50, maxX: 50, minZ: 60, maxZ: 76 }, indoor: false },
  {
    id: 'woods',
    bounds: { minX: 30, maxX: 64, minZ: 30, maxZ: 70 },
    indoor: false,
    requiresPremium: true,
  },
  {
    id: 'lake',
    bounds: { minX: -70, maxX: -40, minZ: 40, maxZ: 74 },
    indoor: false,
    requiresPremium: true,
  },
];

export const AREAS_BY_ID = new Map(AREAS.map((a) => [a.id, a]));
