import type { IPlatform, HapticStyle, Orientation, SafeAreaInsets } from './IPlatform';

/**
 * Browser / desktop implementation. This is what runs during development and
 * what a future web build would ship; it is also the fallback the Capacitor
 * platform inherits from for anything a native plugin does not cover.
 */
export class WebPlatform implements IPlatform {
  readonly id: 'web' | 'android' | 'ios' = 'web';

  protected pauseHandlers: (() => void)[] = [];
  protected resumeHandlers: (() => void)[] = [];

  /** Subclasses call these when a native lifecycle event arrives. */
  protected firePause(): void {
    this.pauseHandlers.forEach((h) => h());
  }

  protected fireResume(): void {
    this.resumeHandlers.forEach((h) => h());
  }

  async init(): Promise<void> {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.firePause();
      else this.fireResume();
    });
    window.addEventListener('pagehide', () => this.firePause());
  }

  async read(key: string): Promise<string | null> {
    try {
      return window.localStorage.getItem(key);
    } catch {
      // Private mode / disabled storage: the game still runs, it just cannot save.
      return null;
    }
  }

  async write(key: string, value: string): Promise<void> {
    try {
      window.localStorage.setItem(key, value);
    } catch (error) {
      console.warn('[WebPlatform] storage write failed', error);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  }

  speak(text: string, lang: string, pitch = 1.1): void {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (!synth || typeof SpeechSynthesisUtterance === 'undefined') return;
    try {
      synth.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      // A touch slow and bright: this is read to a four-year-old.
      utterance.rate = 0.9;
      utterance.pitch = pitch;
      // Only voices on the device: a network voice would send the text away.
      const local = synth.getVoices().find((v) => v.localService && v.lang.startsWith(lang.slice(0, 2)));
      if (local) utterance.voice = local;
      synth.speak(utterance);
    } catch {
      /* no voice here */
    }
  }

  stopSpeaking(): void {
    try {
      window.speechSynthesis?.cancel();
    } catch {
      /* ignore */
    }
  }

  haptic(style: HapticStyle): void {
    if (!('vibrate' in navigator)) return;
    const patterns: Record<HapticStyle, number | number[]> = {
      light: 10,
      medium: 20,
      heavy: 35,
      success: [12, 40, 18],
      warning: [20, 60, 20],
    };
    try {
      navigator.vibrate(patterns[style]);
    } catch {
      /* ignore */
    }
  }

  async lockOrientation(orientation: Orientation): Promise<void> {
    const so = screen.orientation as ScreenOrientation & {
      lock?: (o: string) => Promise<void>;
    };
    try {
      await so?.lock?.(orientation);
    } catch {
      // Desktop browsers reject this; harmless.
    }
  }

  getSafeAreaInsets(): SafeAreaInsets {
    const style = getComputedStyle(document.documentElement);
    const read = (name: string): number => {
      const raw = style.getPropertyValue(name).trim();
      return raw ? parseFloat(raw) || 0 : 0;
    };
    return {
      top: read('--sa-top'),
      right: read('--sa-right'),
      bottom: read('--sa-bottom'),
      left: read('--sa-left'),
    };
  }

  async setStatusBarHidden(_hidden: boolean): Promise<void> {
    /* Browsers do not expose this. */
  }

  onPause(handler: () => void): void {
    this.pauseHandlers.push(handler);
  }

  onResume(handler: () => void): void {
    this.resumeHandlers.push(handler);
  }

  async openExternal(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  getPreferredLanguage(): string {
    return navigator.language || 'en';
  }
}
