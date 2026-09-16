import type { EventBus } from '../core/EventBus';
import type { SaveManager } from '../save/SaveManager';
import type { IStore, PurchaseResult } from './IStore';
import { PRODUCT_FULL_GAME } from './IStore';

/**
 * What the player owns.
 *
 * OFFLINE-FIRST RULE
 * The entitlement is cached in settings and trusted on launch. A child on a
 * plane must get the full game they paid for, so we never re-verify at boot and
 * never revoke access because the network is unavailable. Verification happens
 * only when the player actively restores or purchases.
 *
 * FREE CONTENT
 * The free game is a complete, satisfying experience: the whole farm, one cow,
 * the sheep, the chickens, the garden, the family and the daily-life loop
 * forever. Premium adds breadth (areas, animals, seasons), never basic dignity.
 */
export class Entitlements {
  private owned = new Set<string>();
  private store: IStore | null = null;

  constructor(
    private save: SaveManager,
    private bus: EventBus,
  ) {}

  attachStore(store: IStore): void {
    this.store = store;
  }

  /** Reads the cached entitlement. Called before any network is touched. */
  loadFromCache(): void {
    if (this.save.settings.premiumUnlocked) this.owned.add(PRODUCT_FULL_GAME);
  }

  has(productId: string): boolean {
    return this.owned.has(productId);
  }

  get isPremium(): boolean {
    return this.owned.has(PRODUCT_FULL_GAME);
  }

  /** Called only from inside the Parent Area, after the gate. */
  async purchase(productId: string): Promise<PurchaseResult> {
    if (!this.store) return { status: 'unavailable' };
    const result = await this.store.purchase(productId);
    if (result.status === 'purchased' || result.status === 'restored') {
      this.grant(result.productId);
    }
    return result;
  }

  async restore(): Promise<PurchaseResult[]> {
    if (!this.store) return [{ status: 'unavailable' }];
    const results = await this.store.restore();
    for (const result of results) {
      if (result.status === 'restored' || result.status === 'purchased') {
        this.grant(result.productId);
      }
    }
    return results;
  }

  private grant(productId: string): void {
    if (this.owned.has(productId)) return;
    this.owned.add(productId);
    if (productId === PRODUCT_FULL_GAME) {
      this.save.updateSettings((s) => {
        s.premiumUnlocked = true;
      });
    }
    // Flush right away: losing a purchase to a crash is unacceptable.
    void this.save.flush(true);
    this.bus.emit('entitlement:changed', { premium: this.isPremium });
  }

  /**
   * Development helper for QA, exposed only in dev builds via
   * `window.__lad.grantPremium()`. Stripped from production by the bundler.
   */
  devGrant(productId = PRODUCT_FULL_GAME): void {
    if (!import.meta.env.DEV) return;
    this.grant(productId);
  }
}
