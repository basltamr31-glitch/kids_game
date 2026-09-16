import { Game } from './core/Game';
import { EventBus } from './core/EventBus';
import { Rng } from './core/Rng';
import { detectFormFactor, detectQualityTier, qualityFor } from './core/DeviceProfile';
import type { GameContext } from './core/GameContext';
import { createPlatform } from './platform/CapacitorPlatform';
import { SaveManager } from './save/SaveManager';
import { Localization } from './localization/Localization';
import { AudioManager } from './audio/AudioManager';
import { Entitlements } from './monetization/Entitlements';
import { DevStore } from './monetization/IStore';
import { validateContent } from './content';

/**
 * Entry point.
 *
 * Boot order matters and is deliberate:
 *   1. platform  - so storage is available
 *   2. save      - so settings (language, quality, entitlement) are known
 *   3. locale    - so the very first frame is already in the right language
 *   4. entitlement from cache - so an offline premium player is never gated
 *   5. world     - the expensive part, built once we know what to build
 *
 * Nothing in this sequence touches the network.
 */
async function boot(): Promise<void> {
  const canvas = document.getElementById('scene') as HTMLCanvasElement | null;
  const uiMount = document.getElementById('ui-root');
  const bootScreen = document.getElementById('boot');

  if (!canvas || !uiMount) {
    showFatalError('The game could not start.');
    return;
  }

  try {
    /* --- 1. platform --- */
    const platform = await createPlatform();
    await platform.init();
    await platform.lockOrientation('landscape');
    await platform.setStatusBarHidden(true);

    /* --- 2. save --- */
    const bus = new EventBus();
    const save = new SaveManager(platform, bus);
    await save.load();

    if (save.migrationInfo.recovered) {
      console.warn('[Boot] previous save could not be read; started a fresh farm');
    }

    /* --- 3. localization --- */
    const loc = new Localization(bus);
    loc.setLocale(save.settings.locale);
    document.documentElement.lang = loc.locale;
    document.title = loc.t('app.title');

    const bootLabel = bootScreen?.querySelector('.boot-title');
    if (bootLabel) bootLabel.textContent = loc.t('app.title');

    /* --- 4. entitlement (from cache, offline-safe) --- */
    const entitlements = new Entitlements(save, bus);
    entitlements.loadFromCache();

    /* --- 5. audio & context --- */
    const audio = new AudioManager();
    audio.applySettings(save.settings);

    const tier = save.settings.qualityOverride ?? detectQualityTier();

    const ctx: GameContext = {
      bus,
      platform,
      save,
      loc,
      audio,
      entitlements,
      worldRng: new Rng(save.save.worldSeed),
      quality: qualityFor(tier),
      formFactor: detectFormFactor(),
      dt: 0,
      elapsed: 0,
      paused: false,
    };

    // Content tables are validated in dev so a bad id is caught by whoever
    // typed it, not by a child whose task list will not complete.
    if (import.meta.env.DEV) {
      const problems = validateContent();
      if (problems.length > 0) {
        console.error('[Content] validation failed:\n' + problems.join('\n'));
      } else {
        console.info('[Content] validated OK');
      }
    }

    /* --- 6. the game --- */
    const game = new Game(ctx, canvas);

    // The dev store needs a UI to confirm through; wire it to the game's modal.
    const store = new DevStore((productId) => game.confirmPurchase(productId));
    await store.init();
    entitlements.attachStore(store);

    await game.init(uiMount);
    game.start();

    // Persist on the way out. `pagehide` is the only event that reliably fires
    // on mobile; `beforeunload` does not.
    window.addEventListener('pagehide', () => void save.flush(true));

    if (import.meta.env.DEV) {
      (window as unknown as { __lad: unknown }).__lad = { game, ctx, entitlements };
      console.info('[Boot] dev handle available as window.__lad');
    }

    // Fade the boot screen only once the first frame has actually rendered.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        bootScreen?.classList.add('hidden');
        window.setTimeout(() => bootScreen?.remove(), 700);
      });
    });
  } catch (error) {
    console.error('[Boot] failed', error);
    showFatalError(
      error instanceof Error ? error.message : 'Something went wrong starting the game.',
    );
  }
}

/**
 * Last-resort error screen.
 *
 * Written in plain English with no jargon and no stack trace: the person
 * reading it is a parent, not a developer.
 */
function showFatalError(message: string): void {
  const boot = document.getElementById('boot');
  if (!boot) return;
  boot.innerHTML = '';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'text-align:center;padding:24px;color:#6B4A2F;max-width:30em';
  wrap.innerHTML = `
    <div style="font-size:3rem">🐄</div>
    <h1 style="font-size:1.3rem;margin:.6em 0">The farm is having a quiet morning</h1>
    <p style="font-weight:600;line-height:1.5">Please close the app and open it again.</p>
  `;
  const detail = document.createElement('p');
  detail.style.cssText = 'font-size:.75rem;opacity:.6;margin-top:1.5em;font-weight:600';
  detail.textContent = message;
  wrap.appendChild(detail);
  boot.appendChild(wrap);
}

void boot();
