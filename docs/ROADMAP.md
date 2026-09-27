# Roadmap: from vertical slice to a finished game

This plan comes from playing the current build start to finish in a browser,
not from reading the code alone. The foundation is strong: a solid world,
physical interactions, a day engine that never soft-locks, a save system that
survives version changes, and six languages. What stops it feeling like a
finished product is mostly the **first five minutes** and the **feel of each
small success**. That is where a four-to-eight-year-old decides whether they
love a game, and where a parent decides whether to pay for it.

The phases are ordered by impact on that first impression. Each one ships on
its own.

---

## What the playtest showed

| # | Observation | Why it matters |
|---|---|---|
| 1 | Launch drops straight into a settings form over a blurred world. No title, no name, no music moment. | The first ten seconds are the store listing's promise. Right now they feel like a debug menu. |
| 2 | The "Who are you today?" card covers the whole screen, so the child can't see themselves change. The live preview is already wired, just hidden. | Making your own character is the first joy in the game, and it is currently invisible. |
| 3 | Hair styles are shown as stock emoji faces that don't match the 3D hair they pick. | The choice means nothing to a pre-reader. |
| 4 | Day 1 starts in the farmyard, but the first suggestion is "Get out of bed", which plays a stretch in the middle of a field. | It breaks the one story the game is telling. |
| 5 | The task list is six wide text buttons, about a third of the screen, and most players can't read yet. | It covers the world the game is about and talks to the parent, not the child. |
| 6 | Finishing a chore bumps a number in the corner. No hearts fly, nothing sparkles, and there's no fanfare. | Reward feedback is the core loop of a game for young children. |
| 7 | Hearts pile up with nothing to spend them on. | A counter with no meaning stops being noticed by day three. |

---

## Phase 1: the first five minutes *(done)*

1. **Title screen.** The game's name over a slow camera drift round the
   valley, one Play button, and the day number for a returning player. The
   first tap also starts the audio.
2. **Character creator you can see.** The panel sits to the side and a portrait
   camera frames the child, so every tap visibly changes them. Haircuts are
   drawn as the real styles, in the child's own colours.
3. **A coherent first morning.** Every day, day 1 included, starts beside the
   bed, and getting up plays by itself. This also fixed a real bug: from day 2
   on, the child used to be placed inside the mattress, with the camera stuck
   behind the headboard.
4. **Pictures for pre-readers.** One suggestion in words; the rest are round
   picture buttons.
5. **Rewards you can feel.** Hearts fly from the child to the counter, which
   counts up with a rising note as each lands.

## Phase 2: hearts that mean something *(done)*

- **Faces that read in any light.** Characters get a viewer fill in the toon
  material, so a warm lamp or a low sun warms a face instead of turning skin
  and hair into the same orange.
- **Heart milestones** (`content/Milestones.ts`): four hats, two outfits, and
  five things that appear on the farm (a swing, a bench, a birdhouse, a
  scarecrow and lanterns). Each is celebrated once. Farm features appear first,
  with the camera turned toward them.
- **Wardrobe.** After the morning "get dressed" chore, the creator opens in
  wardrobe mode. Earned items show early, with a heart-count tag.
- **Album.** Three tabs (nature finds, stickers, heart rewards) with empty
  frames to fill, and a dot on the book when something is new.
- **Indoor camera.** It now steps round the half-height room dividers and
  furniture instead of pressing into them.

## Phase 3: a voice for pre-readers *(done)*

- **Read aloud** (on by default): the device's offline text-to-speech says a
  task's name when it starts, reads a tile when it is pressed and held, reads
  Mum's and Dad's lines at a pitch for each speaker, and reads reward cards.
- With read aloud off, parents talk in pitched babble syllables instead.
- The music already followed the time of day; bedtime now has an original
  lullaby.

## Phase 4: a day with a shape *(done)*

- **Storybook page.** Each finished activity takes a small photo of the
  moment, in memory only, and three of them, spread across the day, are
  pinned to the goodnight page.
- **Mornings.** A new season or new weather is announced, and read aloud,
  once the child is up.
- **Seasonal stickers** for first snow, the first rainy day, and each new
  season.
- *Not done:* bigger seasonal events such as a lamb born in spring or the
  apple harvest. They need new animals and new animation, which is a content
  project of its own.

## Phase 5: release quality *(code done; the rest needs people and devices)*

Done in code:
- **Accessibility.** A left-handed (mirrored) layout. The chore and object
  prompt rings now differ in shape (dashed) as well as colour. The heart
  flight honours the in-game reduced-motion setting as well as the OS one.
- **Crash log on the device.** Uncaught errors are kept locally, and the
  Parent Area can copy or clear them. Nothing is ever sent.
- **Store screenshots.** `npm run store:screenshots` captures real frames at
  the phone and tablet sizes Google Play asks for; see `docs/STORE.md`.

Needs a person, an account or a device:
- Testing on a real low-end Android tablet and phone. The quality tiers are
  still measured only on a desktop.
- Replacing `DevStore` with Play Billing (a Play Console app and products),
  and pointing `LINKS` at real privacy, terms and support pages.
- Clearing the name and choosing the final application id (`docs/STORE.md`).
- Checking the read-aloud voices on real devices in each of the six
  languages.

---

## Not doing

- **Timers, scores, streaks or loss states.** The design commitments in the
  README are the product.
- **Ads, accounts or chat.** Never.
- **Loot boxes or random rewards bought with hearts.** Every unlock is known in
  advance and earned the same way for every child.
