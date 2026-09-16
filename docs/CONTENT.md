# Adding content

Everything a designer can change lives in `src/content/`. Nothing in this guide
requires touching `src/gameplay`, `src/world` or `src/ui`.

After any change, run:

```bash
npm test          # content integrity + locale parity
npm run typecheck
```

`validateContent()` also runs at boot in dev builds and prints problems to the
console.

---

## Add an animal

1. Add an entry to `src/content/Animals.ts`:

```ts
{
  id: 'clover',
  kind: 'goat',
  nameKey: 'animal.clover',
  temperament: 'curious',      // drives its behaviour, see AnimalAgent
  area: 'pasture',             // must exist in AREAS
  colorVariant: 0,
  scale: 0.9,
  verbs: ['feed', 'pet'],
  eats: 'hay',
  voice: { base: 300, kind: 'bleat' },
  moveSpeed: 0.9,
  requiresPremium: true,
}
```

2. Add `animal.clover` to **all six** files in `src/localization/locales/`.
3. If the species is new, add a body function to `src/animals/AnimalRig.ts`
   and a case to its `switch`. Existing species need nothing.

`temperament` is the personality dial. `curious` animals walk over to the child;
`shy` ones keep their distance; `sleepy` ones idle and lie down a lot. A child
should be able to say "Luna is the nosy chicken" after two days.

---

## Add an activity

1. Add an entry to `src/content/Activities.ts`:

```ts
{
  id: 'brushhorse',
  titleKey: 'activity.brushhorse',
  icon: '🐴',
  verb: 'pet',
  anchor: 'clover',            // an anchor, animal id, or 'mother'/'father'
  steps: [
    { kind: 'walkTo', target: 'clover' },
    { kind: 'animate', clip: 'crouchPet', duration: 2.2 },
    { kind: 'animalReact', target: 'clover', emote: '💗', duration: 1.6 },
  ],
  rewards: { hearts: 2, stickerId: 'animalfriend' },
  phases: ['midday', 'afternoon'],
  seasons: ['spring', 'summer'],   // optional
  weather: ['sunny', 'cloudy'],    // optional
  weight: 7,                        // 0 = never auto-scheduled
  oncePerDay: true,
  hoursCost: 0.5,
}
```

2. Add `activity.brushhorse` to all six locale files.

### Step kinds

| kind | what it does | fields |
|---|---|---|
| `walkTo` | child walks to the target | `target` |
| `face` | turn toward a target | `target`, `duration` |
| `animate` | play a child clip | `clip`, `duration` |
| `wait` | pause | `duration` |
| `speech` | a parent says a line | `target`, `textKey`, `duration` |
| `emote` | floating emoji | `target`, `emote`, `duration` |
| `animalReact` | animal reacts + vocalises | `target`, `emote`, `duration` |
| `takeItem` | fetch an item into the hand | `item`, `target` (source) |
| `giveItem` | hand the carried item over | `item`, `count` |
| `cameraFocus` | pull the camera to a point | `target`, `duration` |
| `fadeTo` | screen fade (bedtime) | `duration` |
| `setFlag` | record a one-off story beat | `flag` |

Clip names are the `ClipName` union in `src/characters/CharacterRig.ts`. Adding
a clip means adding a case to `applyClip` — about 15 lines of sine curves.

### Scheduling rules

- `weight: 0` means the generator never draws it; use for the fixed daily
  rhythm, which is added explicitly.
- `requiresActivities` must be satisfiable **in an earlier or equal phase** —
  `tests/content.test.ts` enforces this, because a prerequisite that can only
  happen later is a soft lock.
- `requiresPremium` activities are filtered out of a free player's plan
  entirely, so they never appear as an unreachable task.

---

## Add a scripted day

Add a `DayDefinition` to `SCRIPTED_DAYS` in `src/content/Days.ts` with a `day`
number. The tests require every scripted day to contain the full fixed rhythm,
end on `bedtime`, and have `dinner` before `brushteeth`.

To change how *generated* days feel, edit `DAY_GENERATION` (activities per
phase, repeat penalty, discovery chance, season length) and `WEATHER_TABLE`
(per-season weather probabilities) in the same file.

---

## Add a discovery

Add to `DISCOVERIES` in `src/content/Items.ts` plus a `discovery.*` key in all
six locales. Discoveries are seeded into an area at the start of a day and found
by walking near them — they are never a task.

---

## Add an area

1. Add to `AREAS` in `src/content/Items.ts` with its ground-plane bounds.
2. Register anchors for it in `buildWorld` in `src/world/WorldBuilder.ts`:

```ts
add('lakeshore', -55, 58, 'lake', 1.5);
```

3. Build whatever geometry it needs and add it to `root` or `seasonal`.

Setting `requiresPremium: true` on an area gates every animal living in it, and
the test suite verifies that activities anchored to premium-area animals are
themselves marked premium.

---

## Add a language

1. Copy `src/localization/locales/en.json` to e.g. `pt.json` and translate.
2. Add it to `LOCALES` in `src/localization/Localization.ts`.
3. Add `<locale android:name="pt" />` to
   `android/app/src/main/res/xml/locales_config.xml`.

`tests/content.test.ts` will then enforce, for the new file:

- exact key parity with English
- no empty or whitespace-only strings
- every `{placeholder}` preserved

Speech keys ending `.1`, `.2`, … are variant pools; `tVariant()` picks one so
Mum does not greet the child with the same sentence every morning.
