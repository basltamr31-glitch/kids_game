/**
 * Store abstraction.
 *
 * The business model is not baked into the game: gameplay only ever asks
 * `entitlements.has('full_game')`. Swapping Google Play Billing for StoreKit,
 * or changing to a bundle of packs, is a new IStore implementation and nothing
 * else.
 */

export const PRODUCT_FULL_GAME = 'full_game';

/** Future content packs. Declared now so the plumbing already supports them. */
export const PRODUCT_WINTER_PACK = 'pack_winter';
export const PRODUCT_HORSE_PACK = 'pack_horse';
export const PRODUCT_VILLAGE_PACK = 'pack_village';

export interface StoreProduct {
  id: string;
  /** Localised, currency-formatted price string from the platform store. */
  price: string;
  available: boolean;
}

export type PurchaseResult =
  | { status: 'purchased'; productId: string }
  | { status: 'restored'; productId: string }
  | { status: 'cancelled' }
  | { status: 'offline' }
  | { status: 'unavailable' }
  | { status: 'failed'; reason: string };

export interface IStore {
  readonly id: string;
  init(): Promise<void>;
  /** Prices for display. Never blocks gameplay; may return [] when offline. */
  getProducts(): Promise<StoreProduct[]>;
  purchase(productId: string): Promise<PurchaseResult>;
  /** Required by both stores' policies; must be reachable in the Parent Area. */
  restore(): Promise<PurchaseResult[]>;
}

/**
 * Only a definite `false` counts as offline.
 *
 * `navigator.onLine` is absent in some WebViews and in non-browser hosts, and
 * treating "unknown" as offline would refuse a purchase from a player who is
 * perfectly well connected. Let the store itself be the judge instead.
 */
function isKnownOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * The store used in development and in the web build.
 *
 * It is a *real* implementation of the interface, not a fake success path: it
 * models cancellation and offline so the UI for those cases gets exercised. It
 * is swapped for the Google Play implementation in the Android build (see
 * docs/BUILDING.md); shipping this one to a store would be a bug, so it
 * announces itself loudly in the console.
 */
export class DevStore implements IStore {
  readonly id = 'dev';
  private owned = new Set<string>();

  constructor(private prompt: (productId: string) => Promise<boolean>) {}

  async init(): Promise<void> {
    console.warn(
      '[Store] DevStore active — no real billing. Android release builds must use GooglePlayStore.',
    );
  }

  async getProducts(): Promise<StoreProduct[]> {
    return [
      { id: PRODUCT_FULL_GAME, price: '€4.99', available: true },
      { id: PRODUCT_WINTER_PACK, price: '€1.99', available: false },
      { id: PRODUCT_HORSE_PACK, price: '€1.99', available: false },
      { id: PRODUCT_VILLAGE_PACK, price: '€2.99', available: false },
    ];
  }

  async purchase(productId: string): Promise<PurchaseResult> {
    if (isKnownOffline()) return { status: 'offline' };
    const confirmed = await this.prompt(productId);
    if (!confirmed) return { status: 'cancelled' };
    this.owned.add(productId);
    return { status: 'purchased', productId };
  }

  async restore(): Promise<PurchaseResult[]> {
    if (isKnownOffline()) return [{ status: 'offline' }];
    return [...this.owned].map((productId) => ({ status: 'restored' as const, productId }));
  }
}
