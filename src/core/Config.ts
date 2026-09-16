/**
 * Build-time configuration.
 *
 * Deliberately NOT part of the save file or the content tables: these are
 * deployment facts (version, store URLs, product ids) that change per release
 * rather than per player. Keeping them here means the business model is never
 * hardcoded into gameplay — see docs/ARCHITECTURE.md.
 */

export const APP_VERSION = '0.1.0';

export const APP_ID = 'com.meadowlark.littlealpinedays';

/**
 * Links opened from the Parent Area only, and only after the parent gate.
 * They must be real, reachable pages before a store submission — both Google
 * Play and the App Store reject children's apps with dead privacy links.
 */
export const LINKS = {
  privacy: 'https://littlealpinedays.example/privacy',
  terms: 'https://littlealpinedays.example/terms',
  support: 'https://littlealpinedays.example/support',
};

/** Displayed if the store cannot supply a localized price (e.g. offline). */
export const FALLBACK_PRICE = '€4.99';

/**
 * Free vs premium.
 *
 * The free game is the whole farm and an unlimited number of days. Premium adds
 * breadth. Nothing here gates a *complete* experience, which is the rule the
 * brief sets and the one that keeps parents on side.
 */
export const FREE_CONTENT = {
  areas: ['farmyard', 'house', 'barn', 'coop', 'pasture', 'garden', 'orchard', 'meadow', 'stream'],
  animalKinds: ['cow', 'sheep', 'chicken'],
  maxSeasons: 4,
};
