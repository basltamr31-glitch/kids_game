import { Color } from 'three';

/**
 * The visual identity of "Little Alpine Days" in one file.
 *
 * Every colour in the game comes from here. That single constraint is what
 * keeps a procedurally-built world looking authored rather than assembled:
 * the cow, the chalet, the fence and the UI all draw from the same 40 hues.
 *
 * Direction: warm morning light, saturated meadow greens, honey-toned wood,
 * dusty terracotta roofs, and cool blue-violet mountain distance.
 */

export const PALETTE = {
  /* --- sky & atmosphere --- */
  skyDawn: '#F7C7A0',
  skyDay: '#8FC4E8',
  skyNoon: '#7FBDEA',
  skyDusk: '#F2A18C',
  skyNight: '#1F2A52',
  skyOvercast: '#B6C3CC',
  /** Pale blue-grey the valley walls fade into with height and distance. */
  valleyHaze: '#A8C4D8',

  horizonDay: '#DCEEF7',
  horizonDusk: '#FFD9AE',
  horizonNight: '#2B3A66',

  sunWarm: '#FFF0D2',
  sunGold: '#FFD79A',
  moonPale: '#C9D8FF',

  /* --- terrain --- */
  grassLight: '#8FCB6B',
  grassMid: '#6FB254',
  grassDeep: '#4E8F42',
  grassDry: '#B7C765',
  grassAutumn: '#C9A45B',
  meadowFlowerA: '#F6E27A',
  meadowFlowerB: '#E88BB0',
  meadowFlowerC: '#9AB8F0',

  dirt: '#A9805A',
  dirtDark: '#8A6444',
  path: '#C7A87C',
  rock: '#9AA0A6',
  rockDark: '#767C84',
  snow: '#F4F8FF',
  snowShade: '#D3DEF0',

  /* --- water --- */
  water: '#6FB7D8',
  waterDeep: '#3F87AD',
  waterFoam: '#E8F7FF',

  /* --- mountains (cool, desaturated, reads as distance) --- */
  mountainNear: '#8E9BB5',
  mountainFar: '#A9B5CC',
  mountainShadow: '#6F7C99',
  mountainSnow: '#EFF4FF',

  /* --- trees --- */
  coniferLight: '#4E8A57',
  coniferDark: '#33663F',
  deciduousLight: '#79BC5C',
  deciduousDark: '#548F46',
  deciduousAutumn: '#E0913D',
  deciduousAutumnDeep: '#C4652C',
  trunk: '#7A5638',
  trunkDark: '#5E4029',

  /* --- buildings (alpine chalet) --- */
  wallPlaster: '#F6EDDC',
  wallPlasterShade: '#E4D7C0',
  woodWarm: '#B37A4A',
  woodMid: '#96603A',
  woodDark: '#6E4529',
  woodBalcony: '#A96F41',
  roofTile: '#B4553F',
  roofTileDark: '#8E3F2F',
  roofShingle: '#7A6650',
  barnRed: '#A8503F',
  barnRedDark: '#84392C',
  stoneFoundation: '#A39687',
  windowGlass: '#BCD9E8',
  windowGlassLit: '#FFDE9C',
  shutter: '#3F7A52',
  shutterAlt: '#8A4A3C',
  flowerBoxRed: '#E2544F',
  flowerBoxPink: '#EE8FB0',

  /* --- props --- */
  hay: '#E2C169',
  hayDark: '#C4A24E',
  metal: '#8E959C',
  metalDark: '#6C737A',
  fence: '#C09A6E',
  fenceDark: '#9A7850',
  bucket: '#9FA7AE',
  bucketRim: '#7C858D',

  /* --- animals --- */
  cowBody: '#FAF6EF',
  cowSpot: '#4A3A32',
  cowSpotBrown: '#8A5A3C',
  cowUdder: '#F0B3A8',
  cowHoof: '#4A3F38',
  sheepWool: '#F2EEE6',
  sheepWoolDark: '#DED7C9',
  sheepFace: '#4A4038',
  chickenBody: '#F6E8CF',
  chickenBrown: '#C98C4E',
  chickenSpeck: '#8B6239',
  chickenComb: '#D8484B',
  chickenBeak: '#E8A33C',

  /* --- characters --- */
  skinTones: ['#F6D3B8', '#EDBE99', '#D19A6E', '#A97148', '#7C4F31', '#5A3722'],
  hairColors: ['#3B2A1E', '#6B4226', '#A9703B', '#D9A441', '#E8DCC0', '#8C3B2B'],
  outfitPrimary: ['#5B8FD0', '#D9605E', '#68A860', '#E0A03C', '#8E6BBF', '#E08A3C'],
  outfitSecondary: ['#F4E8D6', '#FFF3E2', '#E9F0DC', '#FBEAD2', '#EFE6F7', '#FFEBD6'],
  shoe: '#5B4536',
  motherDress: '#C4607F',
  motherApron: '#F6EFE2',
  motherHair: '#7A4A2C',
  fatherShirt: '#4A7EA8',
  fatherTrousers: '#6B6255',
  fatherHair: '#4B382A',

  /* --- UI --- */
  uiCream: '#FFF8EC',
  uiCreamDeep: '#F4E6CE',
  uiBrown: '#6B4A2F',
  uiBrownSoft: '#8C6B4A',
  uiGreen: '#5FA353',
  uiGreenDeep: '#43803C',
  uiBlue: '#5B9FD4',
  uiRed: '#E0685F',
  uiGold: '#F2B544',
  uiHeart: '#E8677D',
  uiShadow: 'rgba(76, 48, 26, 0.24)',
} as const;

type PaletteKey = keyof typeof PALETTE;

const colorCache = new Map<string, Color>();

/** Resolve a palette entry to a cached THREE.Color. */
export function color(key: PaletteKey | string): Color {
  const raw =
    ((PALETTE as Record<string, unknown>)[key as string] as string | undefined) ??
    (typeof key === 'string' && key.startsWith('#') ? key : '#FF00FF');

  let cached = colorCache.get(raw);
  if (!cached) {
    cached = new Color(raw);
    // The renderer works in sRGB-in / linear-internally; convert once here.
    cached.convertSRGBToLinear();
    colorCache.set(raw, cached);
  }
  return cached;
}

/** Palette entry as a plain hex string (for UI / CSS). */
export function hex(key: PaletteKey | string): string {
  return (
    ((PALETTE as Record<string, unknown>)[key as string] as string | undefined) ?? '#FF00FF'
  );
}

export const OUTFIT_PRIMARY = PALETTE.outfitPrimary;

export const SKIN_TONES = PALETTE.skinTones;
export const HAIR_COLORS = PALETTE.hairColors;
export const OUTFIT_SECONDARY = PALETTE.outfitSecondary;
