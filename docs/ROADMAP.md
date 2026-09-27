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

All five are in. Fixing the morning also turned up a real bug: from day 2 on,
the child was placed inside the mattress, with the camera buried behind the
headboard.

1. **Title screen.** The game's name over a slow camera drift across the
   valley, a big Play button, and the day number for a returning player. It
   covers the first rendered frame, and the first tap unlocks audio (browsers
   need a tap before they play sound).
2. **Character creator you can see.** The panel moves to the side and the
   camera frames the child close up, so every tap visibly changes them. Hair
   styles are drawn as simple shapes of the real haircuts instead of emoji.
3. **A coherent first morning.** Day 1 starts in bed, as every later day
   already does, so "Get out of bed" means what it says.
4. **A task list for children who can't read yet.** Big icon tiles in a
   compact column, labels shortened to one line, fewer choices on screen, and
   the whole list can be tucked away.
5. **Rewards you can feel.** Hearts rise from the child, fly to the counter one
   by one, each with a note of a rising chime, and the counter bounces as they
   land.

## Phase 2: hearts that mean something

- **Faces that read in any light.** In the low morning sun the child is
  backlit, and warm light pushes skin and hair toward the same orange, so the
  face loses its features. The child needs a soft fill or rim term in the toon
  material, and the palette's skin tones need checking under every time of day.

- **Wardrobe unlocks.** Hearts unlock new outfits, hats and hair colours in the
  character creator. That's a gentle goal with nothing to lose and no store
  involved.
- **The farm grows.** Heart milestones add visible things to the world: a swing
  on the apple tree, a bench, flower boxes, a lamb. Coming back shows progress.
- **Sticker album.** The nature book becomes a sticker album with empty frames
  to fill, so collecting has a shape.

## Phase 3: a voice for pre-readers

- A short, warm narration sting on every task tile and prompt bubble (built
  with the same in-code synthesis approach as the rest of the audio).
  Tapping and holding a tile says its name.
- Parents speak with a "voice" made of pitched syllables, like Animal Crossing,
  so speech reads as speech even without the subtitle.
- A music layer that follows the time of day, with a lullaby at bedtime.

## Phase 4: a day with a shape

- A proper end-of-day storybook page: three pictures of what you did today,
  taken automatically at each completed activity.
- A morning "what's new today" moment when the weather or season changes.
- Seasonal events: first snow, apple harvest, a lamb being born in spring.

## Phase 5: release quality

- Test on a real low-end Android tablet and phone. The quality tiers are
  reasoned but only measured on a desktop.
- Replace `DevStore` with Play Billing, and point the privacy, terms and
  support links at real pages.
- Store listing assets: screenshots, a feature graphic and a trailer, captured
  from the game itself.
- Accessibility pass: a reduced-motion setting, colour-blind-safe prompt rings,
  and a left-handed layout.
- Crash reporting that stays on the device, with a parent-gated "send report"
  button. There are still no analytics.

---

## Not doing

- **Timers, scores, streaks or loss states.** The design commitments in the
  README are the product.
- **Ads, accounts or chat.** Never.
- **Loot boxes or random rewards bought with hearts.** Every unlock is known in
  advance and earned the same way for every child.
