# Privacy, child safety and store compliance

## What the game collects

**Nothing.**

There is no analytics SDK, no crash reporter, no advertising SDK, no account
system, no server, and no telemetry of any kind. The game makes exactly zero
network requests during normal play.

Everything the game stores is local, on the device, in Android's
SharedPreferences (via Capacitor Preferences):

| Key | Contents |
|---|---|
| `lad.save.v1` | Day number, hearts, stickers, discoveries, animal states, inventory, appearance |
| `lad.save.v1.bak` | The previous good copy of the above |
| `lad.settings.v1` | Volumes, language, quality, UI scale, accessibility flags, premium entitlement |
| `lad.crashlog.v1` | Up to 20 recent error messages and stack lines, for a parent to copy from the Parent Area |

The crash log is not a crash reporter: it is never sent anywhere. The Parent
Area shows it only when it has entries, with **Copy report** (to the clipboard,
for a parent to paste into an email themselves) and **Clear**. Error messages
come from the game's own code and contain no personal data.

None of it is personal data. The character's `name` field exists in the schema
but is never prompted for and is always empty — there is **no free-text input
anywhere in the game**, by design.

## Network use

One network operation exists: **Google Play Billing**, reachable only from
inside the Parent Area, behind the parent gate. That request goes from the Play
Store to Google; the app never sees a payment detail.

The `INTERNET` permission is declared for that reason alone. The manifest
comments say so, so nobody later assumes it is free to use.

**Read aloud.** With "Read aloud" on (the default, switchable in the Parent
Area), task names, parents' lines and reward cards are spoken by the device's
own text-to-speech engine: `speechSynthesis` on the web, and the system engine
through `@capacitor-community/text-to-speech` on Android. The only text ever
spoken is the game's own fixed strings; there is no free-text input to leak. On
the web build only on-device voices are chosen. The Android system engine uses
its installed voice data and works in airplane mode; if a parent has set the
system engine to prefer network voices, that is a device-wide setting outside
the app.

**Airplane mode test:** launch, play, complete a day, close, relaunch. Everything
works. The only affected surface is the purchase button, which returns a polite
"a connection is needed just for this purchase" (`store.offline`).

## The parent gate

`src/ui/Screens.ts` → `buildParentGateScreen`.

A **3-second press-and-hold**. Deliberately not a maths question:

- arithmetic gates are trivially solved by a 7-year-old, so they do not work
- they are hostile to a parent with poor numeracy, dyscalculia, or a screen
  reader
- a sustained hold is language-free, needs no reading at all, and is not
  something a toddler does by accident

Everything commercial or destructive sits behind it: purchases, restore,
external links, and "start a new farm". A child tapping ⚙️ reaches the gate and
stops there.

## Child-safety checklist

| Requirement | Status |
|---|---|
| No ads of any kind | ✅ none integrated, no ad SDK present |
| No third-party analytics | ✅ none |
| No personal data collected | ✅ none |
| No free-text input | ✅ no text field anywhere |
| No chat, no multiplayer, no UGC | ✅ single-player only |
| No external links outside the gate | ✅ `openExternal` is only called from the Parent Area |
| No social media integration | ✅ none |
| Purchases behind a parent gate | ✅ 3-second hold |
| Restore purchases available | ✅ Parent Area, no purchase required to reach it |
| One-time purchase, no subscription | ✅ single `full_game` product |
| No loot boxes or randomised rewards for money | ✅ none |
| No energy system, timers or pressure | ✅ none; the day advances only when the child acts |
| No fail state, no death, no violence | ✅ by design |
| Account required | ✅ no |

## Play Data Safety form

- Does your app collect or share any of the required user data types? **No**
- Is all user data encrypted in transit? **N/A — no data is transmitted**
- Do you provide a way for users to request data deletion? **N/A — no data is
  collected. The Parent Area can erase local progress.**

## Play Console declarations

- **Target audience:** Ages 5 and under, plus 6–8. This puts the app in the
  Designed for Families / Teacher Approved track.
- **Ads:** No.
- **Content rating (IARC):** Expect Everyone / PEGI 3 / USK 0. No violence, no
  fear, no substances, no gambling, no user interaction.
- **Government/COPPA:** COPPA applies. Compliance is straightforward because
  nothing is collected.
- **Families policy:** the app must not use Advertising ID. It does not.

## App Store declarations

- **Age rating:** 4+.
- **Kids Category:** eligible. Note that Apple's Kids Category **prohibits**
  third-party analytics and advertising outright — the app already complies.
- **Privacy nutrition label:** "Data Not Collected" for every category.
- **Account deletion requirement:** N/A, no accounts exist.

## Outstanding before submission

1. `src/core/Config.ts` `LINKS` currently points at `littlealpinedays.example`.
   Replace with real, reachable pages. **Both stores reject children's apps with
   dead privacy links.**
2. Publish the privacy policy publicly; the substance is this document's first
   two sections.
3. Replace `DevStore` with real billing (see `BUILDING.md`).
4. Add the third-party licence texts (three.js, Capacitor — both MIT) to the
   Credits screen.
