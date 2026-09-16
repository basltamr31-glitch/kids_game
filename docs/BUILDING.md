# Building and running

## Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 20+ (developed on 24) | everything |
| JDK | 17 or 21 | Android builds |
| Android SDK | platform 35, build-tools 35 | Android builds |
| Xcode | 15+ | iOS builds (macOS only) |

## Run the game

```bash
npm install
npm run dev
```

Opens on <http://localhost:5173>. The dev build exposes `window.__lad` with the
game, context and entitlements for debugging, and validates the content tables
at boot.

Useful dev-console commands:

```js
__lad.entitlements.devGrant()      // unlock premium (dev builds only)
__lad.game.debug.director.endDay() // skip to the day-end screen
__lad.ctx.save.save                // inspect the live save
localStorage.clear()               // start a brand new farm
```

## Other scripts

```bash
npm run typecheck   # tsc --noEmit
npm test            # vitest, 51 tests
npm run build       # typecheck + production bundle into dist/
npm run preview     # serve the production bundle
npm run icons       # regenerate launcher icons from tools/generate-icons.mjs
```

## Android

### First-time setup

```bash
npm run build
npx cap add android
cp -r android-res/android/* android/app/src/main/res/
```

Create `android/local.properties`:

```properties
sdk.dir=C:\\Users\\you\\AppData\\Local\\Android\\Sdk
```

### Build

```bash
npm run android:apk   # debug/release APK for sideloading
npm run android:aab   # Android App Bundle for Play
npm run android:open  # open the project in Android Studio
```

Both scripts run `npm run build && cap sync` first, so the web layer is always
current. **`cap sync` is not optional** — without it the APK ships whatever was
in `dist/` last time.

Artifacts land in:

```
android/app/build/outputs/apk/release/app-release.apk
android/app/build/outputs/bundle/release/app-release.aab
```

A debug build has been run and verified on this project: **4.0 MB, 444 entries,
227 Gradle tasks, 8m 32s** on a cold cache. The archive was checked to contain
the web bundle under `assets/public/` and the vector adaptive icon under
`res/mipmap-anydpi-v26/`.

### If the build hangs

Symptom: Gradle prints a task such as `:app:mergeLibDexDebug` and then sits
there. The tell is **CPU time, not memory** — check whether the JVM's total CPU
is actually increasing:

```bash
# run twice, a minute apart; if CPU barely moves, it is deadlocked, not working
powershell -Command "Get-Process java | Select Id,CPU,WorkingSet"
```

The usual cause is a force-killed JVM leaving orphaned lock files. Fix:

```bash
taskkill //F //IM java.exe
rm -rf android/.gradle
find ~/.gradle/caches -name "*.lock" -delete
cd android && ./gradlew assembleDebug --no-daemon
```

Never `kill` a Gradle daemon to free a lock — use `./gradlew --stop`, which
shuts it down cleanly and releases what it holds.

### Signing a release

```bash
keytool -genkey -v -keystore little-alpine-days.keystore \
  -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Keep the keystore **out of the repository**. Put the credentials in
`android/keystore.properties` (already git-ignored):

```properties
storeFile=../little-alpine-days.keystore
storePassword=...
keyAlias=upload
keyPassword=...
```

Then uncomment the `signingConfig` line in `android/app/build.gradle`.

### Android configuration already applied

- `minSdkVersion 26` — WebGL 2 needs OpenGL ES 3.0, and vector adaptive icons
  need API 26. Shipping a 3D game below that would mean shipping a bad one.
- `screenOrientation="sensorLandscape"` — landscape is the only supported
  orientation; see `src/ui/ui.css` for why.
- `resizeableActivity="true"` — behaves correctly on tablets, foldables and
  Chromebooks in split screen.
- `glEsVersion 0x00030000` required; touchscreen, camera and microphone **not**
  required, so the app stays installable on desktop-class Android.
- Auto-backup restricted to `sharedpref`, which is where Capacitor Preferences
  keeps the save. A child keeps their farm when they change device.
- `localeConfig` lists all six languages for the Android 13+ per-app language
  picker.
- Release builds enable `minifyEnabled` and `shrinkResources`; the AAB splits by
  density and ABI but **not** by language, because the in-game picker must be
  able to reach all six at runtime.

## iOS

The architecture is ready; the platform has not been added because that needs
macOS.

```bash
npx cap add ios
npx cap sync ios
npx cap open ios
```

Then in Xcode:

1. Set the team and bundle id (`com.meadowlark.littlealpinedays`).
2. Device orientation: **Landscape Left + Landscape Right only**.
3. Status bar: hidden.
4. Add the 1024×1024 app icon exported from `android-res/master/icon.svg`.
5. Replace `DevStore` with a StoreKit 2 implementation of `IStore` (about 80
   lines; the interface is in `src/monetization/IStore.ts`).

Nothing under `src/gameplay`, `src/content`, `src/world` or `src/ui` should need
to change. `CapacitorPlatform` already reports `ios` and every plugin it uses
supports both platforms.

## Replacing DevStore with real billing

`DevStore` is a working implementation of `IStore` used for development — it
models cancellation and offline so those UI paths are exercised. It logs a loud
warning on init; **shipping it would be a bug.**

For Android, add `@capacitor-community/in-app-purchases` (or a thin custom
plugin around Play Billing 7) and implement:

```ts
class GooglePlayStore implements IStore {
  readonly id = 'google-play';
  async init(): Promise<void> { /* connect, query products */ }
  async getProducts(): Promise<StoreProduct[]> { /* localized prices */ }
  async purchase(productId: string): Promise<PurchaseResult> { /* + acknowledge */ }
  async restore(): Promise<PurchaseResult[]> { /* queryPurchases */ }
}
```

Then swap one line in `src/main.ts`. Two rules the interface already encodes:

- **acknowledge every purchase within three days** or Play refunds it
- **`restore()` must be reachable without a purchase**, which is why it has its
  own button in the Parent Area — both stores require it

## Exporting raster icons

Launcher icons are vector and need no export. The stores want rasters:

```bash
npx svgexport android-res/master/icon.svg play-icon-512.png 512:512
npx svgexport android-res/master/icon.svg appstore-icon-1024.png 1024:1024
npx svgexport android-res/master/feature-graphic.svg feature.png 1024:500
```

`android-res/preview.html` renders the icon under the round, rounded-square and
squircle launcher masks and down to 32px, so you can check it still reads before
submitting.
