# Bugs

Reported and not yet fixed. Each one says what was seen, and what has already been ruled out, so
nobody starts the diagnosis from nothing.

---

## Generating a portrait more than once turns the model

**Seen on 2026-08-25.** Clicking **Generate portrait** repeatedly comes back with the character
turned - facing away, or side on, rather than the three-quarter view. Keep clicking and it comes
back round to the right angle eventually, which is the most useful thing about the report: the
error is an angle that moves in steps, not a broken render.

**Not concurrent re-entrancy.** `autoPortrait` in `public/editor/model-viewer.js` already guards
against a second run starting while the first is going: `autoRunning` is set synchronously before
the first `await`, and a second click is refused with "Still fetching the last portrait." So this
is about *sequential* runs rather than two at once.

**Where suspicion falls: the azimuth, not the renderer.** `public/editor/game-camera.js` sets
`renderer.azimuth = (camera.yaw + Math.PI + MODEL_TURN + 2 * Math.PI) % (2 * Math.PI)`. That is an
absolute angle, so setting it twice should be harmless - unless something downstream applies it as
a *delta*, or the viewer keeps a rotation from the previous run that this then adds to. A fault
that steps round and returns to correct after enough clicks is exactly what accumulating a fixed
turn each run looks like. Check what the renderer does with `azimuth` on a reused instance before
looking anywhere else.

Ruled out by the symptom: WebGL context loss, which was a real problem here once and which
`tearDown` now handles by losing the context explicitly. That failure looks like a white ghost or
nothing at all, not a correctly drawn character facing the wrong way.

**Weigh the fix against the live-portrait plan.** Rendering the client's own M2 rather than a
remote mesh replaces this whole path, camera included, and would retire the bug rather than patch
it. If that work is close, this is not worth chasing; if it is not, the azimuth check above is
cheap. Either way, capture the broken picture first and work back from it.

---

## Only an enUS client is found - locale support, as a future feature

**Reported on 2026-08-28**, by someone on an **enGB** client: pointing Astral at the WoW folder did
not work and they had to go deeper into the install to get anything to load. The report is
"application will search enUS for the data folder and will ignore other locales", which is exactly
what the code does.

**The cause is not in doubt.** `ARCHIVES` in `lib/client-assets.js` bakes enUS into both halves of
seven of its thirteen entries - the folder and the file name, `enUS/locale-enUS.MPQ` and the rest.
An enGB install has `Data/enGB/locale-enGB.MPQ`; a German one `Data/deDE/locale-deDE.MPQ`. None of
the seven exist, so none of them load.

**And it fails quietly, which is the worst part.** `validate()` only checks for `common.MPQ`, which
is locale-neutral and present on every client, so the folder is accepted and the program then
indexes nothing: the icons, the fonts and every `.dbc` table live in the locale archives. A user
gets a client that validated and an app that behaves as though they never picked one.

**There is a second half, and a fix that does only the first will look broken.** `lib/wow/dbc.js`
reads locale slot 0 of a localised column and no other - a localised string is sixteen slots plus a
populated-mask. On a client that fills a different slot, every class, race, spell, faction, item set
and instance name comes back as an empty string. So the archives would load and the program would
come up full of blanks.

**Whether enGB is affected by that second half is the one thing not established.** enGB may well
keep its text in slot 0, being English, in which case for this reporter only the archive paths
matter. deDE, frFR and ruRU certainly do not. **Settle that against a real client before writing
anything**, rather than reasoning about it: this note exists because the question was reached and
not answered.

**What was measured, on the enUS client here.** A `text()` that tries slot 0, then the mask, then
the sixteen slots in order was written and run against ChrClasses, ChrRaces, ItemSet, TalentTab,
Faction and Map: 1,109 localised reads, **zero** of them different from what `string()` already
returned. So that shape of fallback is safe for English clients and changes nothing for them. It was
reverted along with the rest on the same day, deliberately, to be done as a feature rather than
wedged in as a patch.

**What a real fix has to cover**, none of it hard, all of it worth doing at once:

- Discover the locale folder from the disk instead of naming it. A folder counts as one if it holds
  the archive named after itself, so a stray four-letter directory is not mistaken for a locale.
- Decide what to do when a client carries two. Preferring enUS keeps every existing install reading
  what it reads today, which is the only reason to prefer anything.
- Take the WoW folder, the `Data` folder, or a locale folder inside `Data`. All three name the same
  install and the reporter had to find one of them by hand.
- Say so when there is no locale folder, rather than validating and reading nothing.
- The index fingerprint has to key on the resolved `Data` folder and the locale. That costs every
  existing user one rebuild of the index on first launch, which is worth knowing before shipping it.
- `tools/extract-fonts.js` and `tools/extract-ui-art.js` each keep their own hardcoded enUS list with
  the same flaw. They are maintainer tools, so nothing user-facing depends on them, but they are the
  same bug in two more places.

**Not in scope, and worth saying so out loud:** translating Astral's own interface. The client's own
names would arrive in the client's language because that is the only text those files hold, but that
is a consequence of reading the right slot, not a localisation feature.
