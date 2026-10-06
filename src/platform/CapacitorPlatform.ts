import { WebPlatform } from './WebPlatform';
import type { HapticStyle, Orientation } from './IPlatform';

/**
 * Native (Android now, iOS later) implementation.
 *
 * Plugins are imported lazily so the web/dev build never pays for them and a
 * missing plugin degrades to the web behaviour instead of crashing the boot.
 */
export class CapacitorPlatform extends WebPlatform {
  override readonly id: 'android' | 'ios';

  private prefs: typeof import('@capacitor/preferences').Preferences | null = null;
  private haptics: typeof import('@capacitor/haptics') | null = null;

  constructor(platformId: 'android' | 'ios') {
    super();
    this.id = platformId;
  }

  override async init(): Promise<void> {
    await super.init();

    // Preferences: native key/value store that survives app updates and is
    // included in Android auto-backup. Falls back to localStorage if missing.
    try {
      const mod = await import('@capacitor/preferences');
      this.prefs = mod.Preferences;
    } catch {
      console.warn('[CapacitorPlatform] Preferences unavailable, using web storage');
    }

    try {
      this.haptics = await import('@capacitor/haptics');
    } catch {
      /* fall back to navigator.vibrate */
    }

    try {
      const { App } = await import('@capacitor/app');
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) this.fireResume();
        else this.firePause();
      });
    } catch {
      /* visibilitychange from WebPlatform still covers us */
    }

    try {
      const { StatusBar } = await import('@capacitor/status-bar');
      await StatusBar.hide();
      await StatusBar.setOverlaysWebView({ overlay: true });
    } catch {
      /* ignore */
    }
  }

  override async read(key: string): Promise<string | null> {
    if (!this.prefs) return super.read(key);
    try {
      const { value } = await this.prefs.get({ key });
      return value ?? null;
    } catch (error) {
      console.warn('[CapacitorPlatform] read failed, falling back', error);
      return super.read(key);
    }
  }

  override async write(key: string, value: string): Promise<void> {
    if (!this.prefs) return super.write(key, value);
    try {
      await this.prefs.set({ key, value });
    } catch (error) {
      console.warn('[CapacitorPlatform] write failed, falling back', error);
      await super.write(key, value);
    }
  }

  override async remove(key: string): Promise<void> {
    if (!this.prefs) return super.remove(key);
    try {
      await this.prefs.remove({ key });
    } catch {
      await super.remove(key);
    }
  }

  override haptic(style: HapticStyle): void {
    if (!this.haptics) {
      super.haptic(style);
      return;
    }
    const { Haptics, ImpactStyle, NotificationType } = this.haptics;
    try {
      switch (style) {
        case 'light':
          void Haptics.impact({ style: ImpactStyle.Light });
          break;
        case 'medium':
          void Haptics.impact({ style: ImpactStyle.Medium });
          break;
        case 'heavy':
          void Haptics.impact({ style: ImpactStyle.Heavy });
          break;
        case 'success':
          void Haptics.notification({ type: NotificationType.Success });
          break;
        case 'warning':
          void Haptics.notification({ type: NotificationType.Warning });
          break;
      }
    } catch {
      super.haptic(style);
    }
  }

  /**
   * The Android WebView has no speechSynthesis, so on device this goes
   * through the system text-to-speech engine, which runs offline.
   */
  override speak(text: string, lang: string, pitch = 1.1): void {
    void (async () => {
      try {
        const { TextToSpeech } = await import('@capacitor-community/text-to-speech');
        await TextToSpeech.stop();
        await TextToSpeech.speak({ text, lang, rate: 0.9, pitch, volume: 1.0 });
      } catch {
        super.speak(text, lang, pitch);
      }
    })();
  }

  override stopSpeaking(): void {
    void import('@capacitor-community/text-to-speech')
      .then(({ TextToSpeech }) => TextToSpeech.stop())
      .catch(() => super.stopSpeaking());
  }

  override async lockOrientation(orientation: Orientation): Promise<void> {
    try {
      const { ScreenOrientation } = await import('@capacitor/screen-orientation');
      await ScreenOrientation.lock({ orientation });
    } catch {
      await super.lockOrientation(orientation);
    }
  }

  override async setStatusBarHidden(hidden: boolean): Promise<void> {
    try {
      const { StatusBar } = await import('@capacitor/status-bar');
      await (hidden ? StatusBar.hide() : StatusBar.show());
    } catch {
      /* ignore */
    }
  }

  // openExternal is inherited: window.open hands the URL to the system browser
  // on both Android and iOS WebViews, which is exactly what we want for the
  // privacy / terms / support links in the Parent Area.

}

/** Chooses the right platform for wherever this build is running. */
export async function createPlatform(): Promise<import('./IPlatform').IPlatform> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform?.()) {
      const native = Capacitor.getPlatform();
      if (native === 'android' || native === 'ios') {
        return new CapacitorPlatform(native);
      }
    }
  } catch {
    /* not a native build */
  }
  return new WebPlatform();
}
