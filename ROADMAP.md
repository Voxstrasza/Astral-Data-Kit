# Astral — Roadmap

Ideas parked for later, not in progress. Notes are deliberately detailed enough to start from
without re-deriving anything: where a fact came from the database or the client, it is recorded
here with its real values.

---

## 1. Tier stat generator — **FUTURE**

*Parked. The maths is derived, verified and kept in `lib/item-budget.js`; what it should feel
like to use is the open question, so the panel is out of the Item window until there is an
answer to that. Nothing here needs re-deriving to pick it up again — see "Where it stands".*

*The curve is not fitted to averages: WotLK ships its own item budget and the client has it, so
the generator reads the real thing.*

Generate an item with T7/T8/T9/T10-level stats and item level, plus a **"Plus"** mode that
extrapolates hypothetical tiers — a T7.5 between T7 and T8, or a WotLK-style T11.

### The formula, from the client

**`RandPropPoints.dbc`** is the budget curve: 300 rows, one per item level, each with fifteen
columns — five slot factors for each of Epic, Superior and Good. Column 0 is a chest, column 4 a
thrown weapon. At item level 200 the epic block reads `170 126 95 73 53`, which is a chest and then
0.741, 0.559, 0.429 and 0.312 of one.

**`ItemRandomSuffix.dbc`** is the price list. A random-suffix item's stat value is
`AllocationPct * RandPropPoints / 10000`, so a suffix granting a single stat states that stat's
price outright. Read straight off the single-stat suffixes:

| stat | allocation | costs |
|---|---|---|
| Strength, Agility, Intellect, Spirit, defense, haste | 10000 | **1 point** |
| Stamina | 15000 | **2/3 of a point** |
| Attack power | 20000 | **1/2 a point** |
| Spell power | 11700 | **0.855** |
| Mana per 5 | 4000 | **2.5 points** |

"of the Monkey" says the same thing in one row — agility 6666 against stamina 10000, the same
1.5 to 1.

**The multiplier between the two was fitted**, by grid search over 1,779 clean epics — no set
bonus, no on-use effect, no resilience — minimising median absolute error:

```
budget = RandPropPoints(ilvl, quality, slot) x 1.890   (epic; 1.730 rare)
         less 15 points per socket
```

Half of all real items land within **1.7%** of that. It is a sharp optimum: 1.88 or 1.90 each cost
a third of a percent of accuracy. A socket costs a flat 15 points whatever the item level, and a
socket bonus costs nothing — matching colours is the reward, not something the item pays for.

### What that settles from the old working-out

- **Armour needs no curve of its own.** It never came out of the stat budget: armour is fixed by
  slot, item level and armour class, which is why a cloth and a plate chest of the same item level
  carry the same stats. The old sampled jumps were off-set pieces, as suspected.
- **Slot modifiers are the five columns**, not something to derive. Confirmed by measuring: with
  the costs above applied, head/chest/legs land on 1.86, shoulders/waist/feet/hands on 1.87 and
  neck/wrist/finger/back/shield on 1.85 — one number across every slot, which is what says the
  grouping is right.
- **Stat distribution** is measured rather than invented. Averaged over real epics, by role:

  | role | spread |
  |---|---|
  | Melee, strength | str .333, sta .261, crit .185, hit .071, haste .061, ArP .050, exp .039 |
  | Melee, agility | agi .256, sta .176, AP .176, crit .140, hit .061, haste .059, ArP .056 |
  | Tank, plate | sta .278, str .261, defense .148, dodge .137, parry .092, hit .033, exp .033 |
  | Caster, damage | SP .269, int .222, crit .152, sta .152, haste .133, hit .073 |
  | Healer | SP .265, int .216, sta .149, spi .116, crit .091, mp5 .082, haste .070 |

### Weapons: damage is a table, and the damage *not* taken is paid in stats

Measured across every epic weapon in the database, **dps is an exact function of item level and
weapon kind**: every ilvl 219 one-hander in the game carries the same dps to a tenth, that tenth
being integer rounding of the damage range. Not an average hiding a spread — a formula.

| ilvl | 1H melee | 2H melee | 1H caster | 2H caster | ranged | wand |
|---|---|---|---|---|---|---|
| 200 | 143.4 | 186.6 | 82.8 | — | 129.6 | 263.6 |
| 232 | 178.8 | 232.6 | 103.3 | 156.7 | 187.2 | 328.6 |
| 264 | 226.6 | 294.7 | 131.1 | — | 253.2 | 416.4 |
| 277 | 250.6 | 325.7 | 154.7 | 230.0 | 288.8 | 460.3 |

**But a weapon is not budgeted apart from armour** — it spends part of the same allowance on its
damage, and this is what the first version of the generator got wrong. A melee weapon carrying the
full dps for its level lands on the same 1.89 as armour (one-hand 1.89, ranged 1.88, wand 1.89). A
caster weapon carries about 60% of that damage and is paid the difference in stats:

```
budget = RandPropPoints x 1.89 + (melee dps for the slot - actual dps) x 6.19
```

The exchange rate is what makes it a rule rather than a fit: taking each caster weapon's stats
above the armour budget and dividing by the dps it gives up gives **6.18** for one-handers and
**6.19** for two-handers — the same number out of two separate samples. It reproduces the whole
set, a caster one-hander coming out at 6.4 times its slot's points against 6.5 measured.

Against 433 real weapons the finished model is a **median 2.0% out**, and by kind: one-hand 0.0%,
one-hand caster 0.0%, wand 0.3%, ranged -0.8%, two-hand caster -3.5%.

**The one known residual is two-hand melee below ilvl 226**, which reads 6-12% rich (-12.3% at 200,
-8.6% at 213, -5.9% at 219, and inside noise from 226 up). The dps table matches those weapons'
real dps exactly at every level, so this is not the curve being wrong — early-Wrath two-handers
simply carry fewer stats than the rule allows. Worth a look before generating Naxxramas-era
two-handers; harmless above that.

### What each item level actually is

Confirmed by walking `creature_loot_template` through `reference_loot_template` for each instance's
own bosses rather than from memory: Ulduar really does drop 219/226/232, the Trial 232 up,
Icecrown 251 up.

| ilvl | tier | where it drops |
|---|---|---|
| 200 | T7 | Naxxramas 10, Obsidian Sanctum 10, Eye of Eternity 10, badge gear |
| 213 | T7.5 | Naxxramas 25, Obsidian Sanctum 25, Eye of Eternity 25 |
| 219 | T8 | Ulduar 10 |
| 226 | T8.5 | Ulduar 25, Ulduar 10 hard modes, Kel'Thuzad 25 |
| 232 | | Ulduar 25 hard modes, Trial of the Crusader 10 |
| 239 | | Trial 10 heroic, Onyxia 10 |
| 245 | T9 | Trial of the Crusader 25, Onyxia 25 |
| 251 | T9.5 | Trial 25 heroic, Icecrown 10 |
| 258 | T10 | Icecrown Citadel 10, Ruby Sanctum 10 |
| 264 | T10.5 | Icecrown Citadel 25, Icecrown 10 heroic |
| 271 | | Icecrown 10 heroic, Ruby Sanctum 25 |
| 277 | | Icecrown Citadel 25 heroic |
| 284 | | Ruby Sanctum 25 heroic, Shadowmourne and the legendary tier |

### Built

`lib/item-budget.js` — the DBC read, the cost table, the slot groups, the measured weapon and
profile tables, and five methods: `budget()`, `generate()`, `identify()`, `weaponDamage()` and
`describe()`. Served at `/api/budget/*`, all client-side, so it answers with no database
configured.

Checked back against the database it came from: across 3,227 real epics `identify()` puts half of
them on exactly the right item level, with a median budget error of **-0.1%** and quartiles at
±1.2%; `weaponDps()` is within 2% on 93% of real weapons.

### Left

- **The window itself.** All of the above is reachable only over the API — the Item editor has no
  Tier panel yet.
- **Tier-set pieces read low**, by one or two steps, and consistently: a set bonus is paid for out
  of the same budget. Worth measuring — it looks like a fixed share — so the wizard can say "T10
  with a set bonus" rather than "T9.5".
- **Uncommon quality is unfitted.** No clean sample in the 187-284 band, so its multiplier is an
  extrapolation of the epic-to-rare step.

## 2. Item wizard — **FUTURE**

**Parked with item 1.** The two calls behind it are built and measured, and the panel that drove
them was working — it is hidden rather than deleted, one attribute in `public/index.html`.
What sent it back is the shape of the flow rather than the numbers.

Wraps the tier maths into a guided flow: describe a custom item and have it placed into the tier
its budget actually belongs to, by comparing against real items of that tier rather than trusting a
hand-typed item level. Then the reverse — generate an item *beyond* T10 by extrapolating the curve.

Both directions exist as calls already; what is missing is the flow around them.

- **Forwards** — `generate()`: pick a tier, a slot and a role, and get a stat block that costs its
  budget exactly, laid out in the proportions real gear of that role uses.
- **Backwards** — `identify()`: price whatever the editor is showing and say what item level it
  really is, and how far off the one typed into the field is. This is the honest check the wizard
  exists for — a hand-typed item level is a claim, the budget the stats cost is the fact.
- **Beyond T10** — the same curve at a higher item level. `RandPropPoints.dbc` has rows out to 300,
  so a T11 at ilvl 290 needs no extrapolation at all; past 300 the interpolator carries the last
  slope rather than flat-lining.

The **item finder** is what feeds it: search by name or browse a boss's drop list, load a real item
into the editor, and the wizard prices it against the tier it came from.


### Where it stands, for whoever picks it up

**Built and verified**

- `lib/item-budget.js` — the client tables, the cost list, the slot groups, the weapon curves and
  the damage-for-stats rule. `budget()`, `generate()`, `identify()`, `weaponDamage()`, `describe()`.
- `/api/budget/*` — all client-side, so they answer with no database configured.
- `public/editor/item-wizard.js` and its panel — tier picker, role, secondary pickers, Generate and
  Price. Hidden, not removed.
- Accuracy, measured rather than claimed: **-0.1% median** budget error against 3,227 real epics,
  half of them landing on exactly the right item level; **2.0% median** against 433 real weapons.

**The three things that made it feel wrong**

1. **Tier-set pieces read one or two steps low**, consistently, because a set bonus is paid for out
   of the same budget. The wizard says "T9.5" for a T10 tier chest and is not wrong about the
   points — it is missing the fact that the piece bought something with them.
2. **Two-hand melee below ilvl 226 reads 6-12% rich.** Early-Wrath two-handers carry fewer stats
   than the rule allows; the dps table matches them exactly, so this is itemisation history rather
   than a bad curve.
3. **Generating replaces the stat block wholesale**, which is what spending a whole budget means,
   but it makes the wizard a thing that overwrites your work rather than one that helps you tune
   it. A "top up to budget" or "show me what this is missing" reading of the same maths would sit
   better beside a loaded item.

**Ideas worth trying when it comes back**

- Price continuously rather than on a button, as a line under the item: "412 of 592 points spent".
- Measure what a set bonus costs and let a piece be marked as tier, so the reading is honest for
  the gear people most want to copy.
- Let the generator fill only the empty room — keep what is typed, spend the remainder.

## 3. SQL exporter

Emit ready-to-run `INSERT` statements for whatever the editor is showing, so a designed item can go
straight into the world database. The only thing to supply should be the entry id.

Best done after the item wizard: both need the same complete picture of an item, and the exporter
is the natural way to get a generated one out of the tool.

## 4. Raid wizard — assemble a raid out of what the other windows make

Every other window in the program builds one finished thing and then has nowhere to put it. The
raid wizard is where they go: **create a raid, then fill it by copying finished work in from the
editors** — a target frame becomes a boss, a spell becomes an ability in a phase, an item becomes
a drop, an achievement and a spoken line attach to the fight they belong to.

So a raid is not a form to fill in. It is a document you paste into.

**The shape of it**

1. **Create a raid.** A name and a **logo picked from the icon picker** — the same picker the item
   and spell windows use, so both the client's 6,300 icons and the **Custom** tab are available and
   a raid of your own can carry your own artwork. The wizard's front page is a list of raid cards, logo
   and name and boss count.

2. **Copy a boss in from the NPC window.** Build the target frame as normal — name, level,
   classification, the health and mana pools, the custom difficulty scaling — then **Copy**. In the
   planner, **Paste** adds it as a boss. What lands is the frame itself, health bar and all, so a
   raid roster reads as a column of real target frames rather than a list of names. A boss pasted
   out of the dungeon browser arrives with its real pool already in it; one built by hand arrives
   with whatever you invented.

3. **Open a boss and design it phase by phase.** A phase is a trigger and what happens under it —
   a health percentage, a timer, or "on pull". Under each phase go three lists, and all three are
   filled the same way, by pasting:
   - **Spells.** Build one in the Spell window, or pull a real one out of `Spell.dbc` and edit it,
     then copy it into the phase. The phase's ability list is those spell tooltips in order, each
     with its own cast timing beside it.
   - **Adds.** Any boss or NPC copied in the same way, attached to the phase that summons it —
     Anub'Rekhan's crypt guards whether or not they are bosses in their own right.
   - **Quotes.** Lines copied out of the Texts window (item 8), filed under the phase they fire
     in, so the script and the mechanics sit on the same page instead of in two documents.

4. **Loot, designed the same way.** Build an item in the Item window, copy it, paste it into the
   boss's drop list, and set its chance and stack size on the row. A boss's rewards are then
   designed alongside its fight rather than afterwards — and the item wizard (item 2) is what says
   whether what you pasted is really tier-appropriate for the raid it is in.

5. **Achievements.** Copy a card out of the achievement window onto the raid, or onto one boss.
   A raid meta-achievement and its per-boss criteria are the obvious use, and `achCategory` is
   already carried on every card, so the filing survives the copy.

Then simulate it: the raid DPS needed to beat an enrage timer, played back with the target frame
draining as the simulated raid damages it. The NPC frame, its health bar and the custom scaling row
are already the right building blocks.

### Copy and paste is one mechanism, not seven

Nothing about this needs a clipboard per window. The pieces are already in `public/editor/state.js`:

- `FIELDS_BY_KIND` already says which fields belong to which window — that is exactly the set a
  **Copy** should lift out, and nothing else, which is why copying a boss cannot drag the item in
  the next tab along with it.
- `encodeState` / `decodeState` already turn a state into a URL-safe base64 string for permalinks.
  A clipboard entry is the same string with a `kind` on it. Which means a copied boss is also
  shareable text: paste it into another raid, or into someone else's copy of the program.

Two things to decide when it is built:

- **A paste is a snapshot, not a link.** Editing the item afterwards must not silently change the
  drop already sitting in a raid, and a raid must not break when the thing it pointed at is gone.
  The cost is that fixing a typo means re-pasting, which is the right trade for a design document.
- **Portraits are the one field that is not in the state.** `runtime.portraitImage` is a captured
  canvas, so a boss copied with a 3D portrait either carries the image as a data URL — fat, but
  self-contained — or carries only `unitDisplayId` and re-captures on open, which is cheap but
  needs the model viewer and its internet connection. Storing a portrait-sized PNG is the reliable
  answer; the display id is already in the state either way.

### Saving, and carrying raids over between sessions

Raids are files in the app's own data folder, beside the custom icons: `~/.astral-data-kit/raids/`,
one JSON per raid. That is the `DATA` root `server.js` builds from `os.homedir()` and the Electron
shell uses the same one, so a raid saved in the browser opens in the desktop app.

Outside the program folder on purpose, and for the same reason `lib/custom-icons.js` gives for the
icons: repackaging the app rewrites `dist\`, and rebuilding the client index throws away `cache\`.
Neither can touch work that lives in the data folder. A raid survives a reinstall.

What that buys, beyond the list simply being there next time:

- **Export and import a raid as one `.json`**, which is how a raid gets shared or backed up.
- **Autosave rather than a Save button.** Every other window keeps its state in the address bar
  without being asked; a raid should not be the one place work can be lost by closing a window.
- **A `raids.json` index** beside them, so the front page does not have to open every file to
  draw the list.

### What the database already answers — counted, not remembered

| what | where | size |
|---|---|---|
| Loot to propose from | `creature_loot_template` | 93,662 rows across 7,802 creatures |
| Real encounter lists | `instance_encounters` | 612 encounters |
| Ability lists and phases | `smart_scripts` | 53,241 rows across 14,430 scripted creatures |
| Adds a boss really summons | `smart_scripts` where `action_type = 12` | 1,762 summon actions |
| What the loot references point at | `reference_loot_template` | 24,096 rows across 1,508 references |

These are what a **"propose from a real boss"** button reads, for a raid built by starting from
something that exists rather than from nothing.

`creature_loot_template` is keyed by `Entry` and carries `Item`, `Chance`, `GroupId`, `MinCount`,
`MaxCount` and `Reference`. The reference rows are the catch: the Lich King's own list is three
rows — two items and a pointer to reference 34238 — and following that pointer is where his real
drops are (51795 upwards). A drop list that does not chase references will look nearly empty for
exactly the bosses anyone cares about.

Note that `creature_template` in this schema has no `spell1..8` columns; a creature's abilities
live in `smart_scripts`, which is also where phases and summons are, so one reader covers the
abilities, the phases and the adds.

## 5. Raid-size variants of WotLK NPCs — **built**

*Shipped as the "Browse dungeons & raids" button in NPC mode. `lib/instances.js` reads the tree
from the client, `worldDb.bossesForEncounters` resolves the creatures, and
`public/editor/instances.js` is the browser. What follows is the working-out, kept because items
6 and 7 lean on the same data.*


Collapse a boss's difficulty entries into one search result with a size selector, instead of
surfacing `Patchwerk (1)` as a separate creature.

**The schema already links them:** `creature_template.difficulty_entry_1/2/3` point from the base
(10-man normal) entry at its harder variants. Confirmed:

| boss | entry | d1 | d2 | d3 |
|---|---|---|---|---|
| Patchwerk | 16028 (HP mod 310) | 29324 (mod 935) | — | — |
| Deathbringer Saurfang | 37813 | 38402 | 38582 | 38583 |

A two-entry raid like Naxxramas is 10N → 25N; a four-entry one like ICC is 10N → 25N → 10H → 25H.
Search should hide entries that are another creature's difficulty child, and offer the sizes as
buttons.

Health for each variant comes out of the existing formula: base pool from
`creature_classlevelstats` times that entry's own `HealthModifier`.

### The browse-by-expansion front end

Rather than reaching this only through search, the three expansion logos in `art/` are the way in:
click Classic, TBC or WotLK and get that expansion's 5-man and raid bosses, each with its
difficulty variants behind buttons and the base entry selected by default.

How many buttons each expansion earns:

| expansion | 5-man | raid |
|---|---|---|
| Classic | none — no heroic mode | none |
| TBC | Normal / Heroic | none — single difficulty throughout |
| WotLK | Normal / Heroic | 10N / 25N pre-ToC, four from ToC onwards |

**The difficulty columns are not in ascending order.** Verified against Lord Marrowgar (36612) and
his `HealthModifier`:

| column | entry | HP mod | means |
|---|---|---|---|
| base | 36612 | 500 | 10N |
| `difficulty_entry_1` | 37957 | 1700 | **25N** |
| `difficulty_entry_2` | 37958 | 750 | **10H** |
| `difficulty_entry_3` | 37959 | 2250 | 25H |

So `_1` is the 25-man *normal*, not the 10-man heroic. Labelling them in column order gets the two
middle buttons backwards, and the health values are what give it away.

The health formula checks out end to end: `creature_classlevelstats` at level 83, class 1 gives
`basehp2` 13945, and 13945 × 500 = **6,972,500** — live ICC 10N Marrowgar.

### Traps found while checking this against the database

- **Four difficulty entries does not mean a four-difficulty raid.** The Alterac Valley bosses —
  Drek'Thar (11946), Vanndar Stormpike (11948), Captain Galvangar (11947), Balinda Stonehearth
  (11949) — all have `difficulty_entry_1/2/3` filled with battleground bracket variants. Filtering
  on "has `difficulty_entry_3`" alone pulls a battleground into the raid list.
- **Ulduar is two buttons, not four.** Its hard modes are in-encounter, not separate entries:
  Flame Leviathan 33113 → 34003, XT-002 33293 → 33885, Freya 32906 → 33360, Algalon 32871 → 33070,
  each with `_2` and `_3` empty. "ToC onwards" is the right cut-off.
- **Onyxia is the exception to "Classic has no buttons", and resolves in our favour.** The 3.3.5a
  Onyxia (10184) was retuned in 3.2.2, carries `difficulty_entry_1` → 36538 (HP mod 350 → 1600) and
  is flagged `exp = 2`, so grouping by expansion files her under WotLK where her 10/25 buttons
  belong — not under Classic where they would look wrong.
- **Bosses cannot be grouped into instances from the spawn table.** 57 of the 418 creatures behind
  `instance_encounters` have zero rows in `creature` because they are script-summoned. That is the
  whole of Trial of the Crusader — joining through spawns makes ToC disappear entirely, which is
  exactly the raid the four-button rule exists for.
- **The DBC mirror tables are empty.** `map_dbc`, `mapdifficulty_dbc` and `dungeonencounter_dbc`
  exist in the world database with full schemas but hold no rows; only `spelldifficulty_dbc` (604)
  is populated. `Map.dbc` (`ExpansionID`, `InstanceType`, `MaxPlayers`), `MapDifficulty.dbc` and
  `DungeonEncounter.dbc` would have to be read from the client MPQs.
- **`rank` cannot identify a boss.** Every 5-man boss checked is `rank = 1` (elite), not `rank = 3`
  — Murmur (18708), Grand Warlock Nethekurse (16807), Cyanigosa (31134), Ingvar (23954). Filtering
  on `rank = 3` drops every dungeon boss in the game, which is half of what this feature lists.
- **Names are not unique, and the duplicates are not all real.** Keristrasza has four entries and
  only 26723 carries the heroic link; Illidan has four, Malygos four, Patchwerk two. Looking a boss
  up by name picks the wrong row about as often as the right one — `instance_encounters.creditEntry`
  is what disambiguates.
- **Junk to filter.** Six creatures have `difficulty_entry_2` set with `_3` empty, and every one is
  a test creature: Sam's Test Dummy 1/2, Craig Steele, Craig's Test Human A, Morgan Test,
  En'kilah Hatchling.

Counts in the database as it stands: 1,439 base entries with one variant, 359 with three, and the
6 test rows above.

### How it was resolved

`instance_encounters` (612 rows) is a better boss list than `rank = 3` (962 rows, most of them not
bosses), but it carries no map, so the expansion and 5-man/raid split had to come from the client.
`lib/client-assets.js` now indexes `DBFilesClient\` and `lib/wow/dbc.js` reads three tables:

| table | gives |
|---|---|
| `Map.dbc` | `ExpansionID`, and `InstanceType` to tell dungeon from raid — and to drop battlegrounds, which is what kept Alterac Valley out on its own |
| `MapDifficulty.dbc` | one row per difficulty a map offers, which *is* the button list |
| `DungeonEncounter.dbc` | the boss roster per map, in `OrderIndex` order |

**`DungeonEncounter.dbc` ID equals `instance_encounters.entry`**, which is the join that makes the
whole thing work — it reaches the script-summoned bosses that have no spawn row. 412 of 428
encounters resolve straight through it.

The remaining 16 are `creditType = 1`, credited by spell rather than by a kill. Where the encounter
is really a single creature its name matches a `creature_template` row, so a name lookup ordered by
*has a difficulty chain first, then lowest entry* recovers Hodir, Thorim, Freya, Algalon, Valithria
and Tharon'ja. That ordering matters: without it the four Keristrasza rows resolve to the wrong one.
What is left over is genuinely not one creature — Icecrown's gunship, Naxxramas' Four Horsemen,
Ulduar's Iron Council, the Trial's Faction Champions — and those are listed but not selectable.

Counts the client reports, which match the rules above exactly:

| expansion | dungeons | raids |
|---|---|---|
| Classic | 19, all single-difficulty | 6, all single — except Onyxia's Lair at 2 |
| TBC | 16, **all** Normal/Heroic | 9, all single |
| WotLK | 16, all Normal/Heroic | 8 — five at 2 buttons, three at 4 |

Health was checked against live values end to end: Marrowgar 10N 6,972,500, Lich King 25H
103,151,165, Illidan 4,249,280.

## 6. Difficulty scaling percentage — **built**

*Shipped as the Custom scaling row under Health in NPC mode: +5% through +30%, compounding on
each press, with the resulting pool shown and a Reset that restores the exact starting numbers.
Loading a creature clears it, so the scaling always reads against the pool on screen.*

An option on the NPC frame to raise health and mana by a percentage, for custom raid difficulties
and DPS checks.

Distinct from item 5: that picks a real variant out of the database, this invents a harder one.
Should show the resulting pool so a target DPS can be worked out against an enrage timer.

## 7. Achievement creator — COMPLETE

Build a custom achievement — name, description, icon, points, reward text and its criteria — and
preview it in the client's own achievement frame rather than a generic form.

A **"multiple achievements"** option is the point of the feature rather than an extra: create
several at once and assign each to a different category, laid out the way the in-game Achievements
UI does it — the category tree down the left (General, Quests, Exploration, Player vs. Player,
Dungeons & Raids, Professions, Reputation, World Events, Feats of Strength) with its sub-categories,
and the achievement list for whichever category is selected on the right. Designing a set that
spans categories should look like the finished in-game panel, not like a list of unrelated rows.

### Groundwork — all verified, nothing left to re-derive

Everything this needs is already present. Checked against the client and the world database, not
remembered.

**The three DBCs are in the archives and parse with the existing reader.** `lib/wow/dbc.js` was
built for item 5 and `lib/client-assets.js` already indexes `DBFilesClient\`, so each is one call:
`new Dbc(assets.readEntry('DBFilesClient\\Achievement.dbc'), 'Achievement.dbc')`.

| file | rows | fields |
|---|---|---|
| `Achievement.dbc` | 1,817 | 62 |
| `Achievement_Category.dbc` | 86 | 20 |
| `Achievement_Criteria.dbc` | 7,655 | 31 |

**Field indices**, recovered from the `*_dbc` column order in an AzerothCore world database — the
same trick that gave Map.dbc its layout. Every localised column is 17 fields wide (`LOCALE_FIELDS`
in the reader), so the enUS slot is the first of the block. The field totals match the headers
exactly, which is the assertion `lib/instances.js` already makes and this should copy.

```
Achievement.dbc (62)
  0 ID   1 Faction   2 Instance_Id   3 Supercedes
  4 Title_Lang_enUS        (+17 -> 21)
  21 Description_Lang_enUS (+17 -> 38)
  38 Category   39 Points   40 Ui_Order   41 Flags   42 IconID
  43 Reward_Lang_enUS      (+17 -> 60)
  60 Minimum_Criteria   61 Shares_Criteria

Achievement_Category.dbc (20)
  0 ID   1 Parent   2 Name_Lang_enUS (+17 -> 19)   19 Ui_Order

Achievement_Criteria.dbc (31)
  0 ID   1 Achievement_Id   2 Type   3 Asset_Id   4 Quantity
  5 Start_Event   6 Start_Asset   7 Fail_Event   8 Fail_Asset
  9 Description_Lang_enUS (+17 -> 26)
  26 Flags   27 Timer_Start_Event   28 Timer_Asset_Id   29 Timer_Time   30 Ui_Order
```

`Parent` on a category is the tree — the nine top-level headings are the rows whose parent is the
root, and everything else hangs off them. `Ui_Order` is the in-game sort within a level.

**`IconID` is not an icon name.** It is almost certainly an index into `SpellIcon.dbc`, which
`lib/spells.js` already reads and maps to a texture file name (the last path segment, lower-cased,
which is exactly what the icon picker and `iconUrl` want). Confirm that against a known achievement
before relying on it; if it holds, achievement icons cost nothing.

**The frame art is in the archives** — 44 textures under `Interface\AchievementFrame\`. The ones a
preview needs:

```
UI-ACHIEVEMENT-SHIELD              the points shield behind the number
UI-ACHIEVEMENT-SHIELD-DESATURATED  the unearned version
UI-ACHIEVEMENT-SHIELDS             sheet of shields
UI-ACHIEVEMENT-SHIELDS-NOPOINTS    for a zero-point achievement
UI-ACHIEVEMENT-PARCHMENT           the card background
UI-ACHIEVEMENT-PARCHMENT-HORIZONTAL
UI-ACHIEVEMENT-ICONFRAME           ring around the icon
UI-ACHIEVEMENT-ICONFRAME-BACKFILL
UI-ACHIEVEMENT-WOODBORDER          card border, plus -CORNER
UI-ACHIEVEMENT-CATEGORY-BACKGROUND the tree down the left, plus -HIGHLIGHT
UI-ACHIEVEMENT-CRITERIA-CHECK      the tick beside a met criterion
UI-ACHIEVEMENT-PROGRESSBAR-BORDER  for counted criteria
UI-ACHIEVEMENT-REWARD-BACKGROUND   the reward strip
UI-ACHIEVEMENT-HEADER  -ACHIEVEMENTBACKGROUND  -ACHIEVEMENTWATERMARK
```

Add them to the map in `tools/extract-ui-art.js` and run `npm run extract-art`; they land in
`public/ui` as PNGs like the target-frame textures. Note the target-frame art came out of the
**locale** MPQ (`enUS/locale-enUS.MPQ`), not the common ones.

### Built — the single card

The card and everything that fills it are done, and the whole path is exercised: search or browse
in the client, load a real achievement, edit it, export the PNG.

- `lib/achievements.js` — the three DBCs plus `SpellIcon.dbc` for the icon names, parsed once and
  cached, each table's field count asserted against its own header the way `lib/instances.js` does.
  `tree()`, `get()`, `inCategory()`, `categoryPath()`, `search()`, and `reset()` on a client change.
- `lib/routes.js` — `/api/achievements/categories`, `/search`, `/category` and `/get`. No database.
- `public/ui` — 18 `ach-*.png` textures out of `npm run extract-art`, including the desaturated
  parchment and shield, so an unearned card is the client's own art rather than a filter.
- `public/render.js` — `renderAchievement`, the fixed 434x142 card: parchment, title, icon ring,
  points shield (with the no-points variant for a Feat of Strength), criteria in columns with their
  ticks, and the reward strip hidden when there is no reward.
- `public/editor/achievement.js` — the finder: debounced search, the category tree in a select, and
  loading a result into the form. `achievement` is in `CANVAS_KINDS` and `FIELDS_BY_KIND`.

`IconID` did turn out to be a `SpellIcon.dbc` index, as suspected: 1,730 of the 1,817 rows resolve
to a real icon name, and the 87 that point at a row the client does not ship fall back to the
question mark, which is what the game shows for them too.

### Left

- **Criteria pickers.** `CRITERIA_TYPES` in `lib/achievements.js` is the answer to what is worth
  supporting — 26 types out of the client's 102, each tagged with what `Asset_Id` points at
  (`creature`, `spell`, `item`, `area`, `faction`…) and whether `Quantity` means anything. The
  endpoint serves it and nothing consumes it yet: a criterion is still typed as free text, which is
  right for the line the card prints but leaves a custom criterion with no id behind it. The NPC
  search and the icon picker are the sources for the creature and item ones.
- **The multi-achievement panel.** The point of the feature: several at once, each assigned to a
  category, laid out as the in-game Achievements UI does it — tree on the left, list on the right.
  That is a second layout on top of the single-card preview, not a variation of it. `achCategory`
  is already on every card and editable, so the filing it needs is in place.

## 8. Texts — **the chat window is built**

Plan what a creature says and does across an encounter: the text lines it speaks and the emotes it
performs, in the order they happen, so a fight's script can be written as a whole rather than a line
at a time.

**Built as the Texts window.** A list of lines, each with its speaker, its kind and its words, drawn
as the chat frame would print them — so two NPCs trading lines read as the exchange they are.

The colours are the client's own, not a guess at them. `Interface\FrameXML\GlobalStrings.lua` has
the sentences (`CHAT_MONSTER_SAY_GET = "%s says:\32"`, and the `\32` is the space after the colon),
and the client's `chat-cache.txt` has the RGB it prints them in:

| kind | colour | |
|---|---|---|
| say | 255 255 159 | a pale yellow — **not** white, which is the commonest way a mocked-up log looks wrong |
| yell | 255 64 64 | |
| whisper | 255 181 235 | |
| emote | 255 128 64 | third person, and no colon: the name starts the sentence |
| boss emote | 255 221 0 | the yellow line in the middle of the screen, printed with no name |

### Decided against: a text finder

**No finder here.** `creature_text` does hold the real scripts — 18,711 lines across 4,206
creatures, keyed by `CreatureID` and `GroupID` — and reading a boss's lines in would be the same
move the NPC and item finders make. It is deliberately not being built: this window is for writing
what a creature *will* say, and a search box full of what Blizzard's already said is a different
tool that happens to share a canvas.

Worth writing down because the data is right there and the parallel is tempting; the reason not to
is that it would answer a question nobody using this window is asking.

### Left

- **Order and trigger.** A line belongs to a moment — pull, a phase change, a death. The list is
  already in order, so this is a label per line rather than a new structure, and it is what turns a
  list of lines into a script.
- **Emotes as a picker.** All three tables are in the client and parse with the existing reader —
  `Emotes.dbc` (175 rows, 7 fields), `EmotesText.dbc` (252 rows, 19 fields) and
  `EmotesTextData.dbc` (1,327 rows, 18 fields) — so the emote list and the sentence each one prints
  could come from the client rather than being typed. Typing the words works today; this only saves
  remembering how the game phrases them.

Fits beside item 4: an encounter's script and its mechanics are the same design, written down twice.
