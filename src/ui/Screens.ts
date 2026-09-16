import { el, onTap, removeAnimated } from './dom';
import type { GameContext } from '../core/GameContext';
import { SKIN_TONES, HAIR_COLORS, OUTFIT_PRIMARY } from '../art/Palette';
import { DISCOVERIES } from '../content';
import { PRODUCT_FULL_GAME } from '../monetization/IStore';
import type { CharacterAppearance } from '../save/SaveSchema';
import type { DaySummary } from '../core/EventBus';
import type { QualityTier } from '../core/DeviceProfile';

/**
 * Modal screens.
 *
 * Each builder returns a detached element plus a `close` callback. UIRoot owns
 * the stack; screens never know about each other, which keeps the child flow
 * and the parent flow genuinely separate.
 */

export interface Screen {
  node: HTMLElement;
  /** Called when the screen is dismissed by any route. */
  onClose?: () => void;
}

function shell(
  ctx: GameContext,
  titleKey: string,
  body: HTMLElement[],
  options: { dismissable?: boolean; onDismiss?: () => void } = {},
): HTMLElement {
  const card = el('div', { class: 'screen__card', role: 'dialog', 'aria-modal': 'true' }, [
    el('h2', { class: 'screen__title', text: ctx.loc.t(titleKey) }),
    ...body,
  ]);

  const screen = el('div', { class: 'screen' }, [card]);

  if (options.dismissable !== false) {
    // Tapping the dim area closes — but only the dim area, not the card.
    onTap(screen, (event) => {
      if (event.target === screen) options.onDismiss?.();
    });
  }
  return screen;
}

/* ------------------------------------------------------------------ */
/* Character customization (first launch)                              */
/* ------------------------------------------------------------------ */

export function buildCustomizeScreen(
  ctx: GameContext,
  appearance: CharacterAppearance,
  onChange: (next: CharacterAppearance) => void,
  onDone: (final: CharacterAppearance) => void,
): Screen {
  const working: CharacterAppearance = { ...appearance };

  const notify = (): void => onChange({ ...working });

  const presetRow = row(ctx, 'actor.child', [
    chips(
      [
        { label: ctx.loc.t('welcome.girl'), value: 'girl' },
        { label: ctx.loc.t('welcome.boy'), value: 'boy' },
      ],
      working.preset,
      (value) => {
        working.preset = value as 'girl' | 'boy';
        notify();
      },
    ),
  ]);

  const skinRow = row(ctx, 'welcome.skin', [
    swatches(SKIN_TONES, working.skinTone, (index) => {
      working.skinTone = index;
      notify();
    }),
  ]);

  const hairColorRow = row(ctx, 'welcome.haircolor', [
    swatches(HAIR_COLORS, working.hairColor, (index) => {
      working.hairColor = index;
      notify();
    }),
  ]);

  const hairStyleRow = row(ctx, 'welcome.hair', [
    chips(
      [0, 1, 2, 3].map((i) => ({ label: ['🧒', '👧', '👱', '🧑‍🦱'][i], value: String(i) })),
      String(working.hairStyle),
      (value) => {
        working.hairStyle = Number(value);
        notify();
      },
    ),
  ]);

  const outfitRow = row(ctx, 'welcome.outfit', [
    swatches(OUTFIT_PRIMARY as unknown as string[], working.outfit, (index) => {
      working.outfit = index;
      notify();
    }),
  ]);

  const startButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.loc.t('welcome.start'),
  });

  const node = shell(
    ctx,
    'welcome.title',
    [
      el('div', { class: 'customize' }, [
        presetRow,
        skinRow,
        hairStyleRow,
        hairColorRow,
        outfitRow,
      ]),
      el('div', { class: 'screen__actions' }, [startButton]),
    ],
    { dismissable: false },
  );

  onTap(startButton, () => {
    ctx.audio.play('confirm');
    onDone({ ...working });
  });

  return { node };
}

function row(ctx: GameContext, labelKey: string, controls: HTMLElement[]): HTMLElement {
  return el('div', { class: 'customize__row' }, [
    el('span', { class: 'customize__label', text: ctx.loc.t(labelKey) }),
    ...controls,
  ]);
}

function swatches(
  colors: readonly string[],
  selected: number,
  onPick: (index: number) => void,
): HTMLElement {
  const container = el('div', { class: 'swatches' });
  colors.forEach((hex, index) => {
    const button = el('button', {
      class: 'swatch',
      style: `background:${hex}`,
      'aria-pressed': String(index === selected),
      'aria-label': `${index + 1}`,
    });
    onTap(button, () => {
      container.querySelectorAll('.swatch').forEach((s) => s.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      onPick(index);
    });
    container.appendChild(button);
  });
  return container;
}

function chips(
  options: { label: string; value: string }[],
  selected: string,
  onPick: (value: string) => void,
): HTMLElement {
  const container = el('div', { class: 'chips' });
  for (const option of options) {
    const button = el('button', {
      class: 'chip',
      text: option.label,
      'aria-pressed': String(option.value === selected),
    });
    onTap(button, () => {
      container.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      onPick(option.value);
    });
    container.appendChild(button);
  }
  return container;
}

/* ------------------------------------------------------------------ */
/* End of day                                                          */
/* ------------------------------------------------------------------ */

export function buildDayEndScreen(
  ctx: GameContext,
  summary: DaySummary,
  onNext: () => void,
): Screen {
  const stats = el('div', { class: 'dayend__stats' }, [
    stat(String(summary.tasksCompleted), ctx.loc.t('dayend.tasks', { count: summary.tasksCompleted })),
    stat(String(summary.hearts), ctx.loc.t('hud.hearts', { count: summary.hearts })),
    stat(
      String(summary.discoveries.length),
      ctx.loc.t('dayend.discoveries', { count: summary.discoveries.length }),
    ),
  ]);

  const newStickers = ctx.save.save.stickers.slice(-4);
  const stickerRow = el(
    'div',
    { class: 'stickers' },
    newStickers.map((id, index) =>
      el('div', {
        class: 'sticker',
        text: STICKER_ICON[id] ?? '⭐',
        style: `animation-delay:${index * 90}ms`,
        'aria-label': ctx.loc.t(`sticker.${id}`),
      }),
    ),
  );

  const nextButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.loc.t('dayend.next', { day: summary.day + 1 }),
  });

  const node = shell(
    ctx,
    'dayend.title',
    [
      el('p', { class: 'screen__body', text: ctx.loc.t('dayend.goodnight') }),
      stats,
      stickerRow,
      el('div', { class: 'screen__actions' }, [nextButton]),
    ],
    { dismissable: false },
  );

  onTap(nextButton, () => {
    ctx.audio.play('confirm');
    onNext();
  });

  return { node };
}

const STICKER_ICON: Record<string, string> = {
  firstday: '🌄',
  animalfriend: '🐄',
  gardener: '🌱',
  explorer: '🧭',
  helper: '🤝',
  weekone: '📅',
};

function stat(value: string, label: string): HTMLElement {
  return el('div', { class: 'dayend__stat' }, [
    el('span', { class: 'dayend__value', text: value }),
    el('span', { class: 'dayend__label', text: label }),
  ]);
}

/* ------------------------------------------------------------------ */
/* Nature book                                                         */
/* ------------------------------------------------------------------ */

export function buildNatureBookScreen(ctx: GameContext, onClose: () => void): Screen {
  const found = ctx.save.save.discoveries;

  const grid = el(
    'div',
    { class: 'book__grid' },
    DISCOVERIES.map((discovery) => {
      const isFound = found.includes(discovery.id);
      return el('div', { class: `book__entry${isFound ? '' : ' book__entry--locked'}` }, [
        el('span', { class: 'book__icon', text: isFound ? discovery.icon : '❔' }),
        el('span', {
          class: 'book__name',
          text: isFound ? ctx.loc.t(discovery.nameKey) : '???',
        }),
      ]);
    }),
  );

  const closeButton = el('button', { class: 'btn btn--wide', text: ctx.loc.t('common.close') });

  const node = shell(ctx, 'naturebook.title', [
    el('p', {
      class: 'screen__body',
      text:
        found.length === 0
          ? ctx.loc.t('naturebook.empty')
          : ctx.loc.t('naturebook.found', { found: found.length, total: DISCOVERIES.length }),
    }),
    grid,
    el('div', { class: 'screen__actions' }, [closeButton]),
  ], { onDismiss: onClose });

  onTap(closeButton, onClose);
  return { node };
}

/* ------------------------------------------------------------------ */
/* Parent gate                                                         */
/* ------------------------------------------------------------------ */

/**
 * The parent gate.
 *
 * A 3-second press-and-hold. This is deliberately NOT a maths question: those
 * are trivially solved by a 7-year-old and are hostile to a parent with poor
 * numeracy or a screen reader. A sustained hold is something a toddler does not
 * do by accident, is language-free, and takes a grown-up one unhurried moment.
 */
export function buildParentGateScreen(
  ctx: GameContext,
  onPass: () => void,
  onCancel: () => void,
): Screen {
  const HOLD_SECONDS = 3;

  const fill = el('div', { class: 'gate__fill' });
  const holdButton = el('button', { class: 'gate__hold' }, [
    fill,
    el('span', { class: 'gate__label', text: ctx.loc.t('parent.gate.hold') }),
  ]);

  let raf = 0;
  let startedAt = 0;
  let holding = false;

  const tick = (): void => {
    if (!holding) return;
    const progress = Math.min(1, (performance.now() - startedAt) / (HOLD_SECONDS * 1000));
    fill.style.transform = `scaleY(${progress})`;
    if (progress >= 1) {
      holding = false;
      ctx.audio.play('confirm');
      ctx.platform.haptic('success');
      onPass();
      return;
    }
    raf = requestAnimationFrame(tick);
  };

  const start = (event: PointerEvent): void => {
    event.preventDefault();
    holding = true;
    startedAt = performance.now();
    ctx.platform.haptic('light');
    raf = requestAnimationFrame(tick);
  };

  const stop = (): void => {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    fill.style.transform = 'scaleY(0)';
  };

  holdButton.addEventListener('pointerdown', start);
  holdButton.addEventListener('pointerup', stop);
  holdButton.addEventListener('pointercancel', stop);
  holdButton.addEventListener('pointerleave', stop);

  const cancelButton = el('button', { class: 'btn', text: ctx.loc.t('common.cancel') });
  onTap(cancelButton, onCancel);

  const node = shell(ctx, 'parent.gate.title', [
    el('p', { class: 'screen__body', text: ctx.loc.t('parent.gate.instruction') }),
    el('div', { class: 'gate' }, [holdButton]),
    el('p', { class: 'footnote', text: ctx.loc.t('parent.gate.hint') }),
    el('div', { class: 'screen__actions' }, [cancelButton]),
  ], { onDismiss: onCancel });

  return {
    node,
    onClose: () => {
      holding = false;
      cancelAnimationFrame(raf);
    },
  };
}

/* ------------------------------------------------------------------ */
/* Parent area                                                         */
/* ------------------------------------------------------------------ */

export interface ParentAreaHandlers {
  onClose: () => void;
  onOpenStore: () => void;
  onResetProgress: () => void;
  onQualityChange: (tier: QualityTier | null) => void;
  onLocaleChange: (locale: string) => void;
  onUiScaleChange: (scale: number) => void;
  appVersion: string;
  links: { privacy: string; terms: string; support: string };
}

export function buildParentAreaScreen(ctx: GameContext, handlers: ParentAreaHandlers): Screen {
  const settings = ctx.save.settings;

  /* --- sound --- */
  const soundGroup = group(ctx, 'parent.area.sound', [
    slider(ctx, 'parent.area.music', settings.musicVolume, (value) => {
      ctx.save.updateSettings((s) => {
        s.musicVolume = value;
      });
      ctx.audio.applySettings(ctx.save.settings);
    }),
    slider(ctx, 'parent.area.sfx', settings.sfxVolume, (value) => {
      ctx.save.updateSettings((s) => {
        s.sfxVolume = value;
      });
      ctx.audio.applySettings(ctx.save.settings);
      ctx.audio.play('tap');
    }),
    slider(ctx, 'parent.area.ambience', settings.ambienceVolume, (value) => {
      ctx.save.updateSettings((s) => {
        s.ambienceVolume = value;
      });
      ctx.audio.applySettings(ctx.save.settings);
    }),
    toggleRow(ctx, 'parent.area.haptics', settings.haptics, (value) => {
      ctx.save.updateSettings((s) => {
        s.haptics = value;
      });
      if (value) ctx.platform.haptic('light');
    }),
  ]);

  /* --- language --- */
  const languageChips = el('div', { class: 'chips' });
  for (const locale of ctx.loc.availableLocales) {
    const button = el('button', {
      class: 'chip',
      text: locale.nativeName,
      'aria-pressed': String(locale.code === ctx.loc.locale),
      lang: locale.code,
    });
    onTap(button, () => {
      languageChips
        .querySelectorAll('.chip')
        .forEach((c) => c.setAttribute('aria-pressed', 'false'));
      button.setAttribute('aria-pressed', 'true');
      handlers.onLocaleChange(locale.code);
    });
    languageChips.appendChild(button);
  }
  const languageGroup = group(ctx, 'parent.area.language', [
    el('div', { class: 'settings__row' }, [languageChips]),
  ]);

  /* --- display --- */
  const qualityOptions: { label: string; value: string }[] = [
    { label: ctx.loc.t('parent.area.quality.auto'), value: 'auto' },
    { label: ctx.loc.t('parent.area.quality.low'), value: 'low' },
    { label: ctx.loc.t('parent.area.quality.medium'), value: 'medium' },
    { label: ctx.loc.t('parent.area.quality.high'), value: 'high' },
  ];
  const qualityRow = el('div', { class: 'settings__row' }, [
    el('span', { class: 'settings__name', text: ctx.loc.t('parent.area.quality') }),
    chips(qualityOptions, settings.qualityOverride ?? 'auto', (value) => {
      handlers.onQualityChange(value === 'auto' ? null : (value as QualityTier));
    }),
  ]);

  const displayGroup = group(ctx, 'parent.area.quality', [
    qualityRow,
    slider(
      ctx,
      'parent.area.uiscale',
      (settings.uiScale - 0.85) / 0.5,
      (value) => {
        const scale = 0.85 + value * 0.5;
        ctx.save.updateSettings((s) => {
          s.uiScale = scale;
        });
        handlers.onUiScaleChange(scale);
      },
    ),
    toggleRow(ctx, 'parent.area.subtitles', settings.subtitles, (value) => {
      ctx.save.updateSettings((s) => {
        s.subtitles = value;
      });
    }),
    toggleRow(ctx, 'parent.area.reducedmotion', settings.reducedMotion, (value) => {
      ctx.save.updateSettings((s) => {
        s.reducedMotion = value;
      });
      document.body.classList.toggle('reduced-motion', value);
    }),
  ]);

  /* --- purchase --- */
  const storeButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.entitlements.isPremium
      ? ctx.loc.t('store.owned')
      : ctx.loc.t('parent.area.store'),
    disabled: ctx.entitlements.isPremium,
  });
  onTap(storeButton, handlers.onOpenStore);

  /* --- links & danger zone --- */
  const links = el('div', { class: 'linkrow' }, [
    linkButton(ctx, 'parent.area.privacy', () => void ctx.platform.openExternal(handlers.links.privacy)),
    linkButton(ctx, 'parent.area.terms', () => void ctx.platform.openExternal(handlers.links.terms)),
    linkButton(ctx, 'parent.area.support', () => void ctx.platform.openExternal(handlers.links.support)),
  ]);

  const resetButton = el('button', { class: 'link', text: ctx.loc.t('parent.area.reset') });
  let resetArmed = false;
  onTap(resetButton, () => {
    if (!resetArmed) {
      // Two-step, in-place confirmation — no chance of a stray tap wiping a farm.
      resetArmed = true;
      resetButton.textContent = ctx.loc.t('parent.area.reset.confirm');
      resetButton.style.color = 'var(--red)';
      window.setTimeout(() => {
        if (!resetArmed) return;
        resetArmed = false;
        resetButton.textContent = ctx.loc.t('parent.area.reset');
        resetButton.style.color = '';
      }, 6000);
      return;
    }
    resetArmed = false;
    handlers.onResetProgress();
  });

  const closeButton = el('button', { class: 'btn btn--wide', text: ctx.loc.t('common.done') });
  onTap(closeButton, handlers.onClose);

  const node = shell(ctx, 'parent.area.title', [
    soundGroup,
    languageGroup,
    displayGroup,
    group(ctx, 'parent.area.store', [storeButton]),
    links,
    el('div', { class: 'linkrow' }, [resetButton]),
    el('p', { class: 'footnote', text: ctx.loc.t('parent.area.offline') }),
    el('p', {
      class: 'footnote',
      text: ctx.loc.t('parent.area.about', { version: handlers.appVersion }),
    }),
    el('div', { class: 'screen__actions' }, [closeButton]),
  ], { onDismiss: handlers.onClose });

  return { node };
}

function group(ctx: GameContext, headingKey: string, rows: HTMLElement[]): HTMLElement {
  return el('div', { class: 'settings__group' }, [
    el('div', { class: 'settings__heading', text: ctx.loc.t(headingKey) }),
    ...rows,
  ]);
}

function slider(
  ctx: GameContext,
  labelKey: string,
  value: number,
  onInput: (value: number) => void,
): HTMLElement {
  const input = el('input', {
    type: 'range',
    min: '0',
    max: '1',
    step: '0.05',
    value: String(value),
    'aria-label': ctx.loc.t(labelKey),
  });
  let lastFired = 0;
  input.addEventListener('input', () => {
    const now = performance.now();
    // Throttle: an audio setting change per pixel of drag is wasteful.
    if (now - lastFired < 60) return;
    lastFired = now;
    onInput(Number(input.value));
  });
  input.addEventListener('change', () => onInput(Number(input.value)));

  return el('div', { class: 'settings__row' }, [
    el('span', { class: 'settings__name', text: ctx.loc.t(labelKey) }),
    el('div', { class: 'settings__control' }, [input]),
  ]);
}

function toggleRow(
  ctx: GameContext,
  labelKey: string,
  value: boolean,
  onChange: (value: boolean) => void,
): HTMLElement {
  const button = el('button', {
    class: 'toggle',
    'aria-pressed': String(value),
    'aria-label': ctx.loc.t(labelKey),
  });
  let state = value;
  onTap(button, () => {
    state = !state;
    button.setAttribute('aria-pressed', String(state));
    onChange(state);
  });
  return el('div', { class: 'settings__row' }, [
    el('span', { class: 'settings__name', text: ctx.loc.t(labelKey) }),
    el('div', { class: 'settings__control' }, [button]),
  ]);
}

function linkButton(ctx: GameContext, labelKey: string, onClick: () => void): HTMLElement {
  const button = el('button', { class: 'link', text: ctx.loc.t(labelKey) });
  onTap(button, onClick);
  return button;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export function buildStoreScreen(
  ctx: GameContext,
  price: string,
  handlers: { onClose: () => void; onBuy: () => void; onRestore: () => void },
): Screen {
  const features = [
    'store.feature.animals',
    'store.feature.areas',
    'store.feature.seasons',
    'store.feature.activities',
    'store.feature.customization',
  ];

  const buyButton = el('button', {
    class: 'btn btn--primary btn--wide',
    text: ctx.loc.t('store.buy'),
  });
  const restoreButton = el('button', { class: 'link', text: ctx.loc.t('store.restore') });
  const closeButton = el('button', { class: 'btn', text: ctx.loc.t('common.back') });

  onTap(buyButton, handlers.onBuy);
  onTap(restoreButton, handlers.onRestore);
  onTap(closeButton, handlers.onClose);

  const node = shell(ctx, 'store.title', [
    el('p', { class: 'screen__body', text: ctx.loc.t('store.body') }),
    el(
      'ul',
      { class: 'store__features' },
      features.map((key) => el('li', { class: 'store__feature', text: ctx.loc.t(key) })),
    ),
    el('div', { class: 'store__price', text: price }),
    buyButton,
    el('div', { class: 'linkrow' }, [restoreButton]),
    el('div', { class: 'screen__actions' }, [closeButton]),
  ], { onDismiss: handlers.onClose });

  return { node };
}

/** Shown when a child taps something premium. Never a hard sell. */
export function buildLockedScreen(
  ctx: GameContext,
  handlers: { onClose: () => void; onShowGrownUp: () => void },
): Screen {
  const closeButton = el('button', { class: 'btn btn--wide', text: ctx.loc.t('common.ok') });
  const askButton = el('button', { class: 'link', text: ctx.loc.t('locked.ask') });
  onTap(closeButton, handlers.onClose);
  onTap(askButton, handlers.onShowGrownUp);

  const node = shell(ctx, 'locked.title', [
    el('div', { class: 'screen__body', text: ctx.loc.t('locked.body') }),
    el('div', { class: 'screen__actions' }, [closeButton]),
    el('div', { class: 'linkrow' }, [askButton]),
  ], { onDismiss: handlers.onClose });

  return { node };
}

/** Simple confirm used by the DevStore so the purchase flow is exercised. */
export function buildConfirmScreen(
  ctx: GameContext,
  titleKey: string,
  bodyText: string,
  onResult: (confirmed: boolean) => void,
): Screen {
  const yes = el('button', { class: 'btn btn--primary', text: ctx.loc.t('common.yes') });
  const no = el('button', { class: 'btn', text: ctx.loc.t('common.cancel') });
  onTap(yes, () => onResult(true));
  onTap(no, () => onResult(false));

  const node = shell(ctx, titleKey, [
    el('p', { class: 'screen__body', text: bodyText }),
    el('div', { class: 'screen__actions' }, [no, yes]),
  ], { onDismiss: () => onResult(false) });

  return { node };
}

export function dismiss(node: HTMLElement): void {
  removeAnimated(node, 'screen--out', 240);
}

export { PRODUCT_FULL_GAME };
