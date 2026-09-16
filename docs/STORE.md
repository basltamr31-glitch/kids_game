# Store preparation

## Name

**Little Alpine Days** — `com.meadowlark.littlealpinedays`

Chosen over the working title "Cozy Alpine Childhood" because it is shorter,
easier for a non-English speaker to pronounce, reads well in a store list, and
does not contain "childhood", which searches poorly and sounds clinical.

"Alpine" is geographic and descriptive rather than distinctive, and "Little" is
extremely common in the category, so the combination is likely registrable but
**the name has not been cleared**. Before launch:

- search both stores for "Alpine" and "Little Alpine"
- check EUIPO and USPTO for live marks in class 9 / 41
- confirm `littlealpinedays.com` and the social handles
- have a fallback ready (*Bella's Meadow*, *Little Farm Days*, *A Little Valley*)

The publisher name `meadowlark` in the bundle id is a placeholder; change it
before the first upload, because **an application id can never be changed once
published**.

## Listing copy

### Short description (80 characters)

> A gentle 3D farm day for little ones. No ads, no timers, works offline.

### Full description

> **Spend a beautiful day with your family.**
>
> High in a green mountain valley there is a little wooden farmhouse, and in it
> lives a child a lot like yours.
>
> Wake up to the morning sun. Have breakfast with Mum. Go outside and give Bella
> the cow her hay, scatter grain for the chickens, find the warm eggs in the
> nest box. Help Dad mend the fence. Water the garden and see what has grown.
> Chase a butterfly. Sit down to dinner together, brush your teeth, and look at
> the mountains from your window before you sleep.
>
> Then it is tomorrow, and the weather has changed.
>
> **A calm game, made on purpose**
> • No timers, no scores, no way to lose, no way to be told off
> • Nothing to read — children play by looking, tapping and listening
> • Every animal has a name and a personality of its own
> • Rain, snow, fog and sunshine, and four changing seasons
> • A Nature Book to fill with the things you find
>
> **For grown-ups**
> • Works completely offline. No internet needed, ever.
> • No advertising of any kind
> • No data collected. No account. No chat. Nothing to type.
> • Settings and purchases sit behind a press-and-hold parent gate
> • One optional purchase unlocks everything. No subscription.
>
> In English, German, French, Italian, Spanish and Finnish.

## Screenshots

Seven shots, landscape, captured on both a phone and a 10" tablet. The order is
deliberate — the first two must sell the feeling before the features.

1. **The hero.** The child on the meadow, chalet on the left, mountains behind,
   warm morning light. This is the whole pitch in one frame.
2. **Feeding Bella.** Child mid-offer, cow reacting with a 💛, prompt bubble
   visible so the interaction reads.
3. **Collecting eggs** at the coop, close in, chickens around the child's feet.
4. **Helping Mum in the garden**, both characters in frame — the family angle.
5. **Family dinner** through the doll's-house cutaway, showing interiors exist.
6. **The stream**, wide, with the bridge and the forest — shows there is a world
   beyond the farm.
7. **Bedtime.** Dark room, moonlight, mountains through the window. The
   emotional close.

Overlay a short localized caption on each; keep it to four words.

Also needed: a 1024×500 feature graphic (generate from
`android-res/master/feature-graphic.svg`) and, optionally, a 30-second video —
one uninterrupted morning, no cuts faster than two seconds, no voice-over.

## Icon

`android-res/master/icon.svg` — a child and a cow on a green meadow with three
snow-capped peaks and a warm sky. Four large shapes, no text, no thin lines, so
it still reads at 48px.

`android-res/preview.html` renders it under the round, rounded-square and
squircle launcher masks and down to 32px. Check it there before submitting.

## Play Console

| Field | Value |
|---|---|
| Category | Games → Educational (secondary: Simulation) |
| Target age | Ages 5 and under **and** 6–8 |
| Contains ads | **No** |
| In-app purchases | Yes, single item |
| Content rating | Expect Everyone / PEGI 3 / USK 0 |
| Data safety | No data collected, no data shared |
| Government apps | No |
| Designed for Families | Opt in |

Families-programme requirements already satisfied: no Advertising ID, no
third-party analytics, no social features, purchases behind a parent gate, and a
privacy policy that is true.

## App Store

| Field | Value |
|---|---|
| Category | Games → Family (secondary: Education) |
| Age rating | 4+ |
| Kids Category | 5 and under |
| Privacy label | Data Not Collected (every category) |

The Kids Category **prohibits** third-party analytics and advertising outright.
The app already complies — do not add either later without re-reading the rules.

## Products

| Product id | Type | Price point | What it unlocks |
|---|---|---|---|
| `full_game` | Non-consumable | ~€4.99 | Everything below |

Premium content, all already wired in `src/content/`:
- Rosie the second cow, and the horse / goat / rabbit / dog / cat definitions
- The woods and the mountain lake areas
- More activities per generated day
- More clothing and seasonal outfits

`PRODUCT_WINTER_PACK`, `PRODUCT_HORSE_PACK` and `PRODUCT_VILLAGE_PACK` are
declared in `src/monetization/IStore.ts` and reported `available: false`. The
plumbing supports them; do not create them in the console until you intend to
ship one.

## Release checklist

- [ ] Change the publisher segment of the application id
- [ ] Clear the name
- [ ] Replace `DevStore` with real billing, and test a purchase on a real
      account in a closed track
- [ ] Verify `restore()` works on a fresh device with the same account
- [ ] Point `LINKS` in `src/core/Config.ts` at live privacy/terms/support pages
- [ ] Add third-party licence texts (three.js, Capacitor — both MIT) to Credits
- [ ] Decide emoji vs. SVG icons, and whether to embed a rounded font
- [ ] Create and back up the upload keystore; enrol in Play App Signing
- [ ] Bump `versionCode` / `versionName` in `android/app/build.gradle` **and**
      `APP_VERSION` in `src/core/Config.ts`
- [ ] Profile on a low-end phone and a mid-range tablet (see TESTING.md)
- [ ] Run the full manual checklist in TESTING.md
- [ ] Test an upgrade: install the previous build, play two days, install the
      new one, confirm the save migrates and the farm is intact
