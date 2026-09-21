# Testing

```bash
npm test          # 65 tests, ~3s
npm run typecheck # strict TS, noUnusedLocals, noImplicitOverride
```

## What is covered

### `tests/save.test.ts` — 13 tests

Save integrity is the highest-stakes thing in this project: a child losing their
farm to an update is worse than any crash.

- a v1 save walks the whole migration chain to the current version with nothing
  lost and every new field defaulted
- a migration exists for every version below the current one
- every migration advances the version by exactly one (catches a migration that
  silently no-ops and would loop)
- a save from a *newer* build is left untouched rather than reinterpreted
- garbage (`null`, a string, a number, an array) recovers instead of throwing
- wrong-typed fields are repaired individually; a partial nested object is
  merged, not replaced
- migration is idempotent
- the **backup slot** is used when the primary save is corrupt — simulated by
  writing a truncated JSON string, as a power-off mid-write would
- a failed disk write does not lose the in-memory save
- locale follows the device until the player picks one explicitly
- **resetting progress does not destroy a purchase**

### `tests/content.test.ts` — 19 tests

The place where a typo becomes a soft lock rather than a compile error.

- `validateContent()` passes (anchors, items, discoveries, areas all resolve)
- ids are unique across activities, animals and discoveries
- every activity anchor and step target resolves to a real anchor, animal or
  actor
- **no circular prerequisites**
- every prerequisite is available in an earlier or equal phase — a prerequisite
  that can only happen later is a soft lock
- every scripted day contains the full fixed rhythm, ends on `bedtime`, has
  dinner before teeth, and contains no duplicates
- the fixed rhythm has `weight: 0` so the generator never draws it twice
- **the free game is genuinely playable**: a cow, sheep and chickens are free,
  and neither the daily rhythm nor core animal care is ever paywalled
- premium gates are consistent: an activity anchored to an animal in a premium
  area is itself premium
- every `takeItem` references an item marked carriable
- all six locales have exact key parity with English
- no locale ships an empty or whitespace-only string
- every `{placeholder}` survives translation in every language
- every key the content tables reference has a translation
- regional tags resolve (`de-CH` → `de`, `ja-JP` → `en`)
- **every `routine` step names a routine the world actually registers** — a
  rename here fails silently at runtime, not at build time
- **every `interact.*` label the world code asks for has a translation** —
  found by scanning `House/FarmInteractions.ts` for the literals, because these
  keys live in code rather than in the content tables

### `tests/gameplay.test.ts` — 21 tests

- RNG is deterministic per seed, forks into independent reproducible streams,
  stays in range, and honours weights
- terrain noise is bounded and continuous (no cliffs from a discontinuity)
- `clamp` / `smoothstep` / `damp` behave, and `damp` converges without overshoot
- day 1 uses the authored plan and completes into day 2 with the save rolled
  over correctly
- phases advance in order as tasks finish
- **an activity is never offered before its prerequisite**
- **30 consecutive generated days are each completable** and each contain the
  full rhythm with no duplicates — the soft-lock regression test
- generation is deterministic for a given seed and day
- seasons roll over after `seasonLength` days
- generated days respect each activity's season and weather constraints
- day history stays bounded so the save cannot grow without limit
- a free player's plan never contains premium content
- entitlements: cached premium survives with no store attached (offline),
  a purchase persists and fires its event exactly once, cancelling grants
  nothing, and restore works from a fresh instance

### `tests/quality.test.ts` — 12 tests

The adaptive monitor is the only thing in the engine that can permanently
change how the game looks without anybody asking it to, so the tests are
written as device descriptions rather than as assertions about numbers — that
is how it fails, by drawing the wrong conclusion about a plausible device.

- a healthy 60 Hz device is left alone
- **a healthy 30 Hz device is left alone** — every one of its frames is over the
  old absolute limit, and it used to lose its shadows within twenty seconds of
  boot on hardware that was not struggling at all
- one bad window among good ones is a hitch, not a verdict (replayed from a
  real session: a steady 33ms with one four-second stretch of 50ms frames)
- a 60 Hz device genuinely rendering at 15 fps is stepped down
- a device whose frames are too long to even measure is stepped down rather
  than dismissed as a stalled tab
- tab stalls and the negative delta a resume can produce are ignored
- it never steps below `low`, and never more than twice in a session
- it reports the numbers it decided on
- `reset()` forgets everything, including a half-armed downgrade
- every tier a downgrade can reach keeps shadows except the floor


## What is not covered by automated tests

Honest gaps:

- **Rendering.** No screenshot or pixel tests. Verified by hand in the browser
  during development; several real bugs were found that way and fixed (shadow
  acne, sky colour space, instanced-colour multiplication, a full-screen overlay
  swallowing taps).
- **Audio.** The synthesis graph is not asserted. Verified by ear.
- **Touch input.** `InputManager` gesture disambiguation is not unit-tested;
  tap-to-move was verified manually in the browser.
- **Real device performance.** Numbers below are desktop-measured. What *is*
  covered is the monitor's judgement, which is the part that was getting real
  devices wrong; the frame costs it judges are still not measured on one.
- **The Capacitor layer.** `CapacitorPlatform` is exercised only by running the
  app; its fallbacks are structured so a missing plugin degrades to the web
  behaviour rather than crashing.

## Manual test checklist

Run before any release build.

**Boot and save**
- [ ] fresh install shows the customization screen
- [ ] choices are reflected live on the child behind the panel
- [ ] force-quit mid-day, relaunch: same day, same phase, same tasks
- [ ] `localStorage.clear()` then relaunch: clean new farm, no errors

**Core loop**
- [ ] tap ground → child walks and stops there
- [ ] tap an animal → child walks over, crouches, pets, animal reacts and vocalises
- [ ] walk near a task anchor → bubble appears; tapping it plays the activity
- [ ] complete every task in a day → day-end screen → day 2 starts
- [ ] play to day 5+ and confirm generated days are varied and completable

**Physical interaction** (regressions here are invisible to the unit tests)
- [ ] breakfast: the child really fetches the plate, bread and milk one at a
      time, sits, eats, and stands — nothing teleports into their hand
- [ ] feeding: the hay is carried across the yard, SET DOWN, and the animal
      walks over and eats it
- [ ] the child's hands are empty at the end of every routine except milking,
      which deliberately leaves them carrying the full bucket for `bringmilk`
- [ ] no routine pays out twice when run from the task list

**Interiors**
- [ ] walking into the chalet fades the shell and reveals the rooms
- [ ] the shell actually FADES — if it snaps between solid and gone, the
      material version bump in `updateCutaways` has been lost
- [ ] the camera swings round to the open front of the building, not to the
      solid back wall, and never ends up inside a wall or the roof underside
- [ ] the front door swings open as the child approaches and ghosts with the
      wall while inside

**Parents**
- [ ] Mum and Dad move to different places as the phase changes
- [ ] they wave when the child comes close
- [ ] in rain they move to their indoor alternative

**Quality**
- [ ] after a few minutes of play the console has not logged `[Quality] stepped
      down` — and if it has, the reason it gives should describe the device you
      are actually holding
- [ ] the child, the animals and the buildings cast shadows on the ground; if
      the scene looks flat and everything appears to float, the tier has
      dropped to `low`

**Weather and time**
- [ ] sky, light and fog change across the day
- [ ] rain and snow show particles and change the ambience
- [ ] the day-3 rain script produces indoor activities

**UI at three sizes** — phone landscape (≤420px tall), 8" tablet, 11" tablet
- [ ] no control smaller than a fingertip; nothing clipped
- [ ] modal action buttons stay reachable without scrolling
- [ ] task list does not overflow
- [ ] rotating to portrait shows the rotate hint rather than a broken layout

**Parent area**
- [ ] ⚙️ opens the gate; a short tap does not pass it
- [ ] a 3-second hold opens the Parent Area
- [ ] each volume slider audibly changes only its own bus
- [ ] switching language changes every visible string immediately
- [ ] quality override visibly changes vegetation density
- [ ] "start a new farm" needs two taps and keeps the purchase

**Offline** — enable airplane mode
- [ ] launch, play a full day, quit, relaunch: all normal
- [ ] purchase button reports the offline message politely

**Accessibility**
- [ ] UI scale slider visibly resizes controls
- [ ] reduced motion stops animations
- [ ] subtitles off hides speech bubbles but keeps voice sounds

## Measured performance

Desktop Chrome, 1024×640, `high` tier:

| Metric | Value |
|---|---|
| Frame rate | 61 fps (vsync-capped) |
| Draw calls | 148 |
| Triangles | 266K |
| Shader programs | 12 |
| Bundle (gzipped) | ~200 KB |

**These are not device numbers.** Before release, profile on a low-end phone
(something like a Moto G / Redmi A-series) and a mid-range tablet, and confirm:

- the `low` tier holds 30 fps with a stable frame time
- `AdaptiveQualityMonitor` steps down when it should and then stays put
- sustained play does not thermally throttle into a stutter
- battery drain over 20 minutes is acceptable

`AdaptiveQualityMonitor` uses the 80th-percentile frame time over 120 frames, so
one GC hitch does not downgrade the game, and it steps down at most twice per
session so it cannot oscillate.
