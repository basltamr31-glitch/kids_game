/**
 * Everything the game needs from the device, behind one interface.
 *
 * No gameplay, UI or content code may import a Capacitor plugin or a browser
 * API that differs per platform. That rule is the entire reason the iOS port is
 * expected to be a build configuration rather than a project.
 */

export type HapticStyle = 'light' | 'medium' | 'heavy' | 'success' | 'warning';
export type Orientation = 'portrait' | 'landscape';

export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface IPlatform {
  readonly id: 'web' | 'android' | 'ios';

  init(): Promise<void>;

  /* --- persistent key/value storage (must work offline, always) --- */
  read(key: string): Promise<string | null>;
  write(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;

  /* --- device feedback --- */
  haptic(style: HapticStyle): void;

  /* --- display --- */
  lockOrientation(orientation: Orientation): Promise<void>;
  getSafeAreaInsets(): SafeAreaInsets;
  setStatusBarHidden(hidden: boolean): Promise<void>;

  /* --- app lifecycle; the game autosaves and pauses on background --- */
  onPause(handler: () => void): void;
  onResume(handler: () => void): void;

  /** Opens privacy policy / support links. Always behind the Parent Gate. */
  openExternal(url: string): Promise<void>;

  /** Device language as a BCP-47-ish tag, e.g. "de" or "de-CH". */
  getPreferredLanguage(): string;

  /**
   * Reads a short line aloud with the device's own offline voice, for players
   * who cannot read yet. Silently does nothing where no voice is available;
   * nothing is ever sent off the device.
   */
  speak(text: string, lang: string, pitch?: number): void;
  stopSpeaking(): void;
}
