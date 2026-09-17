# Architecture

## Engine choice

**TypeScript + three.js (WebGL 2) + Vite, packaged natively with Capacitor.**

The alternatives considered were Unity and Godot. Neither was installed on the
target machine, and more importantly neither could be *run and verified* during
development here. The chosen stack:

- ships one codebase to Android today and iOS with `npx cap add ios`
- has no runtime dependency on a network, an account or a backend
- produces a ~200 KB gzipped bundle because every asset is generated in code
- renders through the same WebGL 2 driver on both platforms, so "works on
  Android" and "works on iOS" are close to the same statement

The trade-off is honest: a WebView game gives up native-engine tooling (a scene
editor, a profiler, an animation timeline) and pays a small startup cost for
WebView init. For a stylized, low-geometry, 60 fps cozy game those costs are
cheap; for a physics-heavy or high-poly title they would not be.

## Layer map

```
src/
  core/          Frame loop, event bus, quality tiers, RNG, config
  platform/      IPlatform + Web and Capacitor implementations
  save/          Versioned schema, migration chain, SaveManager
  localization/  Localization + six locale JSON files
  audio/         Procedural synthesis (Synth) and the soundscape (AudioManager)
  content/       ALL game data: animals, activities, items, days, areas
  art/           Palette, material factory, procedural mesh construction
  world/         Terrain, sky, landscape, buildings, props, WorldBuilder
                 Furniture + House/FarmInteractions (the interactive world)
                 AmbientLife (butterflies, birds, chimney smoke)
  characters/    CharacterRig, Face, FamilyAgent
  animals/       AnimalRig, AnimalAgent
  gameplay/      Player, camera, input, interaction, activities, day, weather
  gameplay/interact/  Physical interaction: sockets, props, hinges, the runner
  ui/            DOM overlay: HUD, screens, responsive layout
  monetization/  IStore + Entitlements
```

### Dependency direction

```
        content  ──────────────┐
           │                   │  (data only, no engine imports)
           ▼                   ▼
  gameplay ◄──── core ────► platform
     │            ▲              ▲
     ▼            │              │
   world/art   save/loc/audio  monetization
     │
     ▼
    ui
```

Rules that are actually enforced by review (and partly by tests):

1. **`content/` imports nothing from `gameplay/`, `world/` or `ui/`.** It is
   pure data plus type definitions. This is what makes new content additive.
2. **No gameplay or UI file imports a Capacitor plugin.** Everything device-
   shaped goes through `IPlatform`. This is the entire iOS-portability story.
3. **No user-visible string is written inline.** Everything is a key through
   `Localization.t()`, and `tests/content.test.ts` checks key parity across all
   six languages plus placeholder preservation.
4. **The business model is not in gameplay.** Gameplay asks
   `entitlements.has('full_game')` and nothing else. Swapping DevStore for
   Google Play Billing touches one file.

## Key decisions

### Everything is generated, nothing is loaded

There is not a single mesh, texture, animation or audio file in this project.
Models are assembled from primitives by `art/MeshKit.ts`, animation is
procedural (sine-driven poses in `CharacterRig.ts`), and all audio is
synthesised by `audio/Synth.ts`.

This buys a guaranteed-coherent art style (one palette drives every surface), a
tiny install, instant startup, and zero licensing risk — see `ASSETS.md`. It
costs the ability to hand-author a specific hero prop, which a future release
can add as an optional glTF without disturbing anything else.

### Draw-call discipline

`PartBuilder` accumulates dozens of coloured primitives, bakes colour into
vertex attributes, and merges them into **one** geometry. A whole chalet —
walls, roof, balcony, shutters, flower boxes, chimney, firewood — is one mesh
with one material. Anything appearing more than ~20 times (grass, flowers,
rocks, fence posts) is an `InstancedMesh`.

Measured on the development machine: **148 draw calls, 266K triangles, 12 shader
programs, 61 fps** at the `high` tier.

> **Instancing gotcha, learned the hard way:** an `InstancedMesh` multiplies the
> geometry's vertex colour by the per-instance colour. Baking green into both
> squares it, and the meadow fills with near-black tufts. Instanced geometry
> must be painted white and tinted only per instance. See `buildGrassField`.

### One lighting model

Everything uses a soft, wide-stepped toon ramp (`art/Materials.ts`). It is cheap
(no PBR), reads well on low-end GPUs, and gives the storybook look. The ramp's
dark end is lifted to 0.45 so shadows read as a cooler shade of the same colour
rather than as darkness.

Tone mapping is **linear, not ACES**. A filmic curve is designed to tame
photographic highlights; applied to a flat stylized palette it desaturates the
greens and crushes the shadows.

### Physical interaction, not menus

The child does not select "breakfast" from a list and watch an animation. They
walk to the dresser, pick up a plate, carry it to the table, put it down, fetch
bread, pour milk, sit, eat, and stand up. `gameplay/interact/` is the machinery:

- **`Prop`** — a carryable object. One at a time, held in the right hand.
- **`Socket`** — a named slot something can be put into: a place at the table,
  a hook for the egg basket, a shelf in the kitchen.
- **`Seat`** — somewhere to sit, which changes the child's pose until they stand.
- **`Hinge`** — a door or wardrobe leaf, with an open and closed angle.
- **`Interactable`** — an object offering at most ONE verb at a time, decided
  per frame from what the child is holding. A bucket offers "fill" at the well
  and "pour" at the trough; nothing has a menu.
- **`InteractStep`** — the vocabulary a sequence is written in: `walkTo`,
  `takeProp`, `placeProp`, `dropProp`, `sit`, `swing`, `reward`, and so on.
- **`InteractionRunner`** — plays a step list, tweening props along an arc so
  they never slide through a table.

Because every step is a real operation on a real object, a four-year-old can do
them out of order, or just carry the bucket around, and nothing breaks.

`dropProp` and `placeProp` are deliberately separate. Sockets model defined
slots in furniture; a pile of hay set down in front of a cow is not a slot, and
inventing an invisible socket per animal per feed would have been the wrong
shape.

The scheduled activities delegate to these sequences rather than duplicating
them, so the day's task list and free play drive exactly the same actions. A
routine owns its own payout, since it is the thing actually performed; the
activity that delegates declares none, so nothing pays twice.

### Doll's-house cutaway instead of interior scenes

Walking into the chalet does not load anything. The building's shell fades out
and the interior — always present — is revealed. `updateCutaways` triggers on
either the child *or the camera* entering the footprint, because walking along
an outside wall can put the camera indoors.

Two things this depends on that are easy to get wrong:

- **The fade has to reach the GPU.** three only re-uploads a material's uniforms
  when its version changes, so damping `material.opacity` toward zero does
  nothing on its own — the walls stay solid at any setting. `updateCutaways`
  bumps the version while the value is moving and settles exactly so it stops.
- **The camera has to be on the open face.** A doll's-house interior keeps its
  back and side walls so a room reads as a room; only ONE face is left open. A
  camera anywhere else sees the back of a solid wall however far the shell has
  faded. Each cutaway therefore carries `openTheta`, and indoors the camera
  orbits the *building* at its own radius — not the child, whose boom would end
  up inside a wall whenever they stood at the back of a deep room — and drops
  nearly level to look in under the upper floor.

A door set in a wall shares that wall's material, so it ghosts with it
automatically instead of needing its own list.

Every room the child uses is on the **ground floor**, so a four-year-old never
has to navigate stairs to reach a task.

### Data-driven activities

An `ActivityDefinition` is a list of `ActivityStep`s, played back by a small
interpreter in `gameplay/ActivitySystem.ts`. "Feed the goats" is a data entry,
not a function.

**Failure policy: an activity can never fail.** The worst outcome is a friendly
toast. The step interpreter has a walk timeout so an unreachable destination
advances the script rather than stranding the child.

### Day generation

Days 1–3 are authored (`content/Days.ts`) and teach the loop one idea at a time.
From day 4 `DayDirector` generates them:

1. the fixed rhythm always happens (wake → dress → eat → … → dinner → bed)
2. animal care is always offered — a child must never be unable to feed Bella
3. the rest is a weighted draw, penalised for recent repeats, filtered by
   season, weather and ownership
4. there is always at least one gentle, no-chore thing to do

Generation is seeded on `(worldSeed, day)`, so reloading mid-day gives the same
plan. `tests/gameplay.test.ts` plays 30 consecutive generated days and asserts
every one is completable — that is the soft-lock regression test.

### Offline-first entitlement

The premium flag is cached in settings and trusted at launch. A child on a plane
gets the game their parent paid for. Verification happens only when the player
actively purchases or restores. Connectivity is treated as unknown-unless-
definitely-false, because `navigator.onLine` is absent in some WebViews and
refusing a purchase to a connected player is worse than attempting one offline.

## Frame order

```
input → interactables → house → runner → activities → player → animals
      → parents → interaction → discoveries → camera → sky → weather → water
      → wind → ambient life → cutaways → audio → HUD → render
```

Simulation before presentation; the camera reads a settled player position, and
the HUD projects against the camera the frame actually rendered with.
