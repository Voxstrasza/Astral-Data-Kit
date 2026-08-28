# Armory

A character screen with no character in it. You pick a race, class and spec, drop items into the
nineteen slots from the same places the Item window already pulls them from, and read out the stat
block that character would really have. Racials that touch stats sit down the left, lit or grayed
by what is equipped. Talents come from a calculator per class.

The point is the honest test: a custom piece you invented reads out as a real character sheet, so
you can see whether it is an upgrade or a problem, and a deliberately broken item breaks it in a
way you can measure.

Nothing below needs re-deriving. Every number in this file was read out of the client, the world
database or AzerothCore's own source on 2026-08-25, not remembered.

---

## What it should feel like

Wowhead's dressing room, with the model taken out and a stat sheet standing where it was. That is
the reference for how it *behaves*, not just what it computes, and it decides several things at
once:

- **Slot first, not item first.** The Item window builds one item at a time. This is a rack of
  nineteen slots you fill. Clicking an empty slot is what starts a search, and that search is
  filtered to what fits the slot, so looking for a helm never shows you a ring.
- **Everything totals live.** Drop an item in and the sheet moves. That is the whole point, and it
  is what makes a custom piece answerable: put it beside the real one it would replace and the
  numbers say which is better.
- **Hovering a slot shows the item's tooltip**, which the app already renders. Nothing new to draw.
- **An outfit is a string.** Wowhead puts the whole set in the URL. Astral already has
  `encodeState` and `decodeState` in `public/editor/state.js` for permalinks, so a character is
  race, class, spec, level, nineteen item references and a talent string, encoded the same way. A
  saved custom item is referenced by its saved id, a real one by its entry.

The parts that are deliberately *not* wowhead: race, class and spec change the numbers here,
racials are listed and applied, and talents come from a calculator rather than being ignored.

## The scope rule

**If Wrath's character sheet shows it, the Armory computes it. If it does not, the Armory does
not.** That is the whole boundary, and it decides arguments before they start. Health regen is the
first thing it cut: the core computes it and the paper doll never displays it, so the two tables
behind it came back out.

What the sheet shows, which is the list every phase works toward:

| tab | what is on it |
|---|---|
| frame | health, mana |
| base | strength, agility, stamina, intellect, spirit |
| melee | damage, speed, attack power, hit, crit, expertise, haste, armor penetration |
| ranged | damage, speed, attack power, hit, crit, haste |
| spell | spell power by school, hit, crit, haste, mana regen (casting and not) |
| defense | armor, defense, dodge, parry, block, resilience |
| resistances | arcane, fire, frost, nature, shadow |

Resistances come along nearly free: `item_template` carries the five columns and the editor's item
state already has a `resistances` list.

---

## Where the data comes from

Three sources, and it matters which is which.

**The client, through `lib/client-assets.js`.** All present and parsing with the `Dbc` reader the
repo already has:

| table | rows x fields | what it gives |
|---|---|---|
| `gtCombatRatings` | 3200 x 1 | rating to percent, per level |
| `gtChanceToMeleeCrit` / `Base` | 1100 / 11 | agility to crit, per class |
| `gtChanceToSpellCrit` / `Base` | 1100 / 11 | intellect to spell crit, per class |
| `gtRegenHPPerSpt`, `gtRegenMPPerSpt` | 1100 each | regen from spirit |
| `gtOCTRegenHP`, `gtOCTRegenMP` | 1100 each | the out-of-combat pair |
| `gtOCTClassCombatRatingScalar` | 352 x 2 | per-class rating scalars |
| `ChrClasses` / `ChrRaces` | 10 / 21 | names, ids |
| `SkillLine` / `SkillLineAbility` | 150 / 10219 | the racial spell list per race |
| `Talent` / `TalentTab` | 892 / 33 | the trees, tiers, columns, ranks |
| `Spell` | 49839 x 234 | what every racial and talent actually does |
| `ItemSet` | 509 | set bonuses |
| `GemProperties` | 626 | gems, if sockets ever get filled |

`CharBaseInfo.dbc` is the one table the existing reader rejects, and correctly: its records are two
bytes wide, one byte each for race and class, so it is not a table of 4-byte fields. It only
answers "which classes can this race be", so either give it a small special case or write the ten
race-to-class masks out by hand.

**The world database, to bake in rather than depend on.** AzerothCore does not use the table name
the old README bullet named. It splits the character base into:

- `player_class_stats` - 746 rows: Class, Level, BaseHP, BaseMana, Strength, Agility, Stamina,
  Intellect, Spirit. Warrior at 80 is BaseHP 8121, str 174, agi 113, sta 159, int 36, spi 59.
- `player_race_stats` - 10 rows: Race, and the five stat modifiers.

Both are static core data, so they are **baked into `lib/character-stats.js` and the database is
never consulted for them**. Everything else in Astral that reads the client works with no database
and the Armory does too. The item side still works either way: real items come from the database
when it is there, custom ones come from the editor always. TrinityCore's names for these two tables
are `player_classlevelstats` and `player_levelstats`, noted only for whenever a future patch lets a
server override the baked values.

**AzerothCore's source**, at `C:\Users\Sean\Desktop\AzerothCore`. The derived-stat formulas are not
data anywhere. They are in `src/server/game/Entities/Unit/StatSystem.cpp` and
`src/server/game/Entities/Player/Player.cpp`, and they get transcribed.

---

## Phase 1 - the numbers, baked - **DONE**

- [x] `lib/character-stats.js`: `player_class_stats` and `player_race_stats` written out as
      literals. Generated by `tools/make-character-stats.js` from AzerothCore's upstream base SQL
      rather than from the live database, so nobody's local edits become everyone's default.
      746 class rows, 10 races, 33 KB. Verified against the live `acore_world`: warrior at 80 reads
      8121 base health and 174/113/159/36/59, the same in both.
- [x] Race modifiers are added to the class row, and base health and mana carry no race component.
      That is what `ObjectMgr.cpp` does when it loads the two tables, checked rather than assumed.
- [x] Base health excludes what stamina contributes. A level 1 warrior reads 20 and has 60 health
      in game, the other 40 being stamina. So that question from the last phase is answered.
- [x] The database is **not** consulted for base stats, by decision. Baked always wins. Letting a
      server override with its own values is a future patch, and TrinityCore's table names are out
      until someone asks.
- [x] Rating conversion from `gtCombatRatings`, with the per-class scalar from
      `gtOCTClassCombatRatingScalar` applied. **The scalar is not decoration.** Skipping it gives
      15.39 for armor penetration when the real Wrath figure is 14.00, which is the 1400 rating
      cap everyone knows. Measured at level 80, and these are the values to check a reload against:

      defense 4.92   dodge 45.25   parry 45.25   block 16.39
      melee hit 32.79   spell hit 26.23   melee crit 45.91   spell crit 45.91
      spell haste 32.79   resilience 94.27   armor penetration 14.00
      expertise 8.20 per point of expertise
      melee haste 32.79, except paladin, death knight, shaman and druid at 25.22

- [x] Crit from stats, out of `gtChanceToMeleeCrit` and `gtChanceToSpellCrit` with the base rows.
      Agility per one percent melee crit at 80: warrior and DK 62.50, paladin and priest 52.08,
      hunter, rogue, shaman and druid 83.33, mage 51.02, warlock 50.51. Intellect per one percent
      spell crit is 166.67 for every casting class. Base crit is 3.189% for a warrior and
      **negative** for hunters and rogues (-1.532% and -0.295%), a real value and not a parse error.
- [x] `tools/character-probe.js`, which prints either the conversion tables for every class or one
      character's naked numbers, for putting beside the real character sheet.

Mana regen checks out: a naked draenei priest reads 40.4 per five seconds, the right size for 183
spirit. Health regen was written and then removed along with `gtRegenHPPerSpt` and `gtOCTRegenHP`,
which nothing else reads, because the sheet does not show it. See the scope rule above.

## Phase 2 - the pipeline - **DONE**

It landed in `lib/character.js` beside Phase 1's conversions rather than in a new file, as
`sheet(race, class, level, gear)`. **Order of operations is the whole game**, and the function is
written in that order with the gap for the step that does not exist yet: base stats, then flat
gear, then percentage auras (racials and talents, phases 4 and 5), then everything derived. Get
that order wrong and every number drifts a little and still looks plausible.

`gear` is `{ stats, armor, resistances }`, already aggregated rather than slot by slot, with
`stats` in the budget names `lib/items.js` speaks. Leaving it out answers for the naked character,
which is the case to check against the game first because a wrong number there can only be one of
these formulas.

- [x] `base(race, class, level)` from Phase 1.
- [x] Gear aggregation takes what `budgetStats()` in `lib/items.js` already produces, rather than a
      second reader. Nothing calls it with gear yet; the slots in phase 3 are what will.
- [x] Health: `stamina < 20 ? stamina : 20 + (stamina - 20) * 10`, added to BaseHP. Mana is the
      same shape with intellect and 15. (`GetHealthBonusFromStamina`, `GetManaBonusFromIntellect`.)
- [x] Armor: item armor, then `+ agility * 2`. (`Player::UpdateArmor`.)
- [x] Attack power, melee and ranged, per class. A druid reads caster form: cat, bear and moonkin
      each have their own formula and all three lean on Predatory Strikes, which is a talent the
      core implements in script code. Forms are a phase 5 problem.
- [x] Block: base 5%, plus defense over the level cap times 0.04, plus block rating. Block value
      from strength, `strength * 0.5 - 10`.
- [x] Dodge, from `dodge_base[]` and `crit_to_dodge[]`, both transcribed. There is no dodge table
      in the client: dodge per agility is proportional to crit per agility, so
      `gtChanceToMeleeCrit` answers both.
- [x] Parry: base 5% plus the same defense contribution and parry rating, for the six classes that
      parry at all. The other four read zero.
- [x] Mana regen, both numbers. Outside the five-second rule spirit counts in full; inside it only
      the fraction a talent lets through, which with no talents is none of it. What mp5 gear adds
      is in both, since it ticks either way.
- [x] Expertise, hit, haste, armor penetration, resilience off the ratings. Hit, crit and haste are
      each one rating that buys different amounts of melee and of spell, so every one of them reads
      its own row rather than sharing an answer.
- [x] Defense skill is five per level plus what defense rating buys, truncated once so the number
      the sheet prints and the avoidance it grants cannot disagree.

**Two things to put in front of a real character**, both faithful to the core and neither checked
against the game yet:

- **Block and parry do not ask what is equipped.** The core turns both on from a learned passive
  and never looks for a shield or a weapon, so a warrior holding nothing reads 5% block. Whether
  the client's own paper doll shows that, or zeroes it without a shield, is what a naked warrior
  answers.
- **A naked hunter reads 0% dodge**, because `dodge_base` is negative for hunters and base agility
  does not cover it, and the core clamps the sum at zero.

**Settled: undiminished, and diminishing returns are not modeled at all.** The sheet reports what
the character has, not what happens to it when something swings. That is also what AzerothCore
itself puts in the field the character sheet reads: the undiminished sum, with the diminished value
kept privately in `m_realDodge` and `m_realParry` for combat only.

So none of the diminishing machinery gets transcribed. `dodge_cap[]`, `parry_cap[]`,
`m_diminishing_k[]` and the `miss_cap[]` in `GetMissPercentageFromDefence` are all out, and with
them the fiddliest part of the whole phase. What stays is the plain sum of the parts. If a combat
view ever wants the real numbers, the constants are still in `StatSystem.cpp` where they were.

## Phase 3 - the panel

**The shell is built**, at the tail of the menu bar. `public/editor/armory.js`, its markup in
`public/index.html`, its styles at the foot of `public/app.css`, and `/api/character/setup` and
`/api/character/sheet` behind it. What works: the race and class pickers, filtered against
`CharBaseInfo.dbc` so a human is never offered druid; the level field; the customization box; and
the eight stat cells phase 1 can answer. The other twenty-two are drawn dashed rather than hidden,
so the finished page is visible before it is finished. The nineteen slots are drawn and inert.

Checked by driving the real app over CDP, not by reading the code: human warrior at 80 reads
174 / 113 / 159 / 36 / 59 with 5.00% melee crit, and the class list for a human correctly excludes
hunter, shaman and druid.

- [ ] A new kind alongside item, spell, unit, achievement and text, following whatever
      `FIELDS_BY_KIND` and the saved-work store already do for the others.
- [ ] Race, class, spec and level pickers. Class list from `ChrClasses`, races filtered to the ones
      that class allows, specs from `TalentTab` filtered by class mask. The three pet tabs carry
      classMask 0 and filter themselves out.
- [ ] The layout, from the mockup drawn on 2026-08-25 (`C:\Users\Sean\Pictures\Untitled.png`).
      Taking the model out does not leave a hole in the middle to fill; it lets the two slot
      columns sit **side by side** and everything else stack under them.

                                          [race v] [class v] [level]
                                              [talent calculator]

      +----------------+        no talents spent        +---------------+
      |                |   +-----+ +-----+              | customization |
      |    racials     |   | x8  | | x8  |              |  name, guild  |
      |  icon + tooltip|   |left | |right|              +---------------+
      |                |   +-----+ +-----+
      |                |
      |                |   +-------------------+
      +----------------+   | main, off, ranged |
                           +-------------------+

                     +----------------------------------+
                     |              stats               |
                     +----------------------------------+
      ------------------------------------------------------------------ full width
                          equipped list

      left column    head, neck, shoulder, back, chest, shirt, tabard, wrist
      right column   hands, waist, legs, feet, finger 1, finger 2, trinket 1, trinket 2
      the row below  main hand, off hand, ranged

      Shirt and tabard carry no stats in Wrath and never move the sheet. They stay for the shape
      of the thing, drawn as slots that take an item and change nothing.
- [ ] Racials get a tall panel of their own down the left, each drawn with its **real icon and its
      real tooltip**, which is work the app already does: `iconUrl()` for the art and
      `renderTooltip` for the hover. Phase 4 fills it; phase 3 leaves the panel there.
- [x] Race and class pickers sit top right, above the slots, with a **talent calculator** button
      that will open its own window.
- [x] **The spec is a readout, not a picker.** It sits centered above the slot columns and the
      talent calculator fills it in: in Wrath the spec is whichever tree holds the most points, so
      there is nothing to choose and nothing that can disagree with the build. Until the calculator
      exists it says "no talents spent".
- [x] **Customization**, in a box on the right where the model used to be: a character name and an
      optional guild name, off by default with its field appearing only when it is ticked. These do
      not touch a single number - they are for the exported picture, drawn in the game's own font,
      the way the sheet builders already use AstralGame for text quoting the game.
- [x] Level starts at 80 and drops as far as 1, and a death knight's field floors at 55 rather than
      answering with an error.
- [x] The stat panel is one wide box under the weapon row, not a tall column and not tabbed, with
      the five resistances on their own line at its foot rather than flowing into its columns.
      Same box, one break: they are one thought and short enough that the sheet's wide columns put
      Fire beside Resilience and carried Frost onto the next row.
- [x] **Lines, not boxes**, in the program's own Figtree. Each stat reads "Strength: 174" on a line
      because boxes framed thirty numbers that needed no framing. It was set in `AstralGame`, the
      client's `FRIZQT__.TTF`, and put back to Figtree on 2026-08-27: what makes the game's sheet
      read the way it does is its layout, so the typeface on its own bought no resemblance while
      making this panel disagree with every other panel in the program. **Reading like the game is
      still wanted and still open**, and it is a layout question rather than a font one.
- [x] **Only the stats the class is read for.** The game's own sheet shows every category to
      everyone, spell power on a warrior included; this does not, because a sheet you are reading
      to judge a piece of gear is worse for twelve lines that will always be zero. Warriors, rogues
      and death knights lose the mana and spell groups; casters lose the melee and defense ones;
      hybrids keep both halves rather than guessing which one they are, since a paladin is any of
      three things until the talent calculator says otherwise. A **Show all stats** box under the
      panel undoes the filter, which matters here more than in a normal armory: the whole point is
      inventing items, and an invented item can put spell power on a warrior.
- [ ] Each slot takes an item from the saved store, from the database search, or from whatever the
      Item window is currently showing. Enforce the slot: a helm goes in the head slot and nowhere
      else. Two-handers take both weapon slots.
- [ ] `searchItems` in `lib/world-db.js` has no slot filter today, only name and entry. It needs an
      InventoryType filter so a search opened from the boots slot cannot return a helm.

### Filling a slot, and where the items come from

**Nothing new is stored.** A saved item already carries its slot: `slot` is in `FIELDS_BY_KIND.item`
in `public/editor/state.js`, filled from the Slot select in the Item window, and `saved.list('item')`
answers with each entry's whole payload rather than a summary. So the picker filters what is already
there, and no second store, no per-slot folders and no second save action are needed.

That was worth settling rather than building the obvious thing, because a parallel store costs more
than it looks: an item saved the ordinary way would not appear in the Armory, a piece saved twice
needs a rule for which copy wins when one is edited, and `slot` is editable - a folder chosen at
save time is wrong the moment a helm is changed to a shoulder, while a filter read at open time
cannot go stale.

- [ ] Clicking an empty slot opens a picker over three sources: saved items whose `slot` fits, the
      database search filtered by InventoryType, and whatever the Item window is showing right now.
- [ ] The slot names do not match one to one, so a small mapping table decides what fits. Finger 1
      and Finger 2 both take `Finger` and Trinket 1 and 2 take `Trinket`; Main hand takes
      `Main Hand`, `One-Hand` and `Two-Hand`; Off hand takes `Off Hand`, `Held In Off-hand` and
      shields.
- [ ] **Save for Armory**, a button in the Item window, for the loop this feature exists for:
      build a piece, put it on, read the sheet. It equips what is on screen into the slot the item
      itself names, and switches to the Armory. It does not save a second copy anywhere - the name
      is the one the button was asked for, and what it does is send rather than store.
- [ ] **It carries a disclaimer, because a hand-written stat is not read.** The sheet only moves for
      the editor's preset lines; a stat typed as its own sentence is prose to the program and is
      worth nothing on the character. Say so on the button rather than letting a custom piece read
      as a pile of zeroes with no explanation.

### Every stat the sheet is read for

**The rule: if the editor can put a stat on an item, the sheet either moves for it or it is on the
list below of stats that deliberately do nothing.** Audited on 2026-08-27 against `lib/items.js` and
the pipeline, and `tools/stat-coverage.js` is the check that keeps it true.

What lands, and the aggregator that gets it there: `equipped(items)` in `lib/items.js` sums a rack
of editor items into the `{ stats, armor, resistances }` shape `sheet()` takes. Three sources, not
one, because the editor does not keep an item's numbers in a single place - the stat rows and green
lines through `budgetStats()`, armor as its own field, resistances as their own list - and a
shield's block value is a fourth. It sums rather than replaces and does not care which slot anything
came from; enforcing that is the panel's job and is settled before a set of items reaches here.

- [x] **Two stat types were reaching the editor as free text and being dropped.** `RATING_CUSTOM`
      emitted ranged attack power (39) and spell penetration (47) as `preset: 'custom'` with the
      number baked into the sentence, and `LINE_TO_BUDGET` is built only from `RATING_LINES`, so
      `budgetStats()` never saw them. Both were promoted on 2026-08-27, into `RATING_LINES` and into
      the editor's own `EQUIP_PRESETS` in `public/tooltip.js`, which is the list a user actually
      picks from. Same sentences, so no tooltip changed; they are now pickable instead of typed,
      and priced instead of ignored.
- [x] **The two pre-3.0 spell stats are not both spell power**, which is what this file said before
      the core was read. `Player::_ApplyItemMods` sends 42 to `ApplySpellDamageBonus`, which moves
      the damage field of every school - the number the spell tab shows - so 42 is spell power in
      everything but name. 41 goes to `ApplySpellHealingBonus`, which touches the healing field
      alone, and 3.3.5a has no healing line: 3.0 merged the two and the sheet kept the damage half.
      So **41 moves nothing on a character sheet**, however generously its sentence is written.
      Both are matched on the fixed half of their sentence and named anyway, because names are read
      twice: the sheet ignores what it has no line for, and `lib/item-budget.js` prices everything
      it is given. `spellDamage` and `spellPower` cost the same there, so 42 changes no price, and
      41 is now priced at half - which is what it was worth and what it was never priced at, since
      a custom line used to reach neither reader.
- [x] `sheet()` reads `worn.rangedAp`, which had been written against a budget name nothing could
      produce. The promotion above makes that branch reachable, and the test confirms it moves
      `rangedPower`.
- [x] **Armor and resistances are not stat rows** - they are their own item fields, and `equipped()`
      picks them up. Holy is dropped on the way: `item_template` has a holy column, the game never
      gave players holy resistance, and the paper doll has no line for it, so a holy value stays on
      the tooltip and off the character.
- [x] **Block value has two sources**: the shield's own `block` field and stat type 48. They add,
      the way `_ApplyItemMods` and `GetShieldBlockValue` both feed the one flat modifier beside
      `strength * 0.5 - 10`. Written down because it is the sort of thing that is otherwise
      discovered twice.
- [ ] **Weapon damage and speed are missing entirely.** `hasWeapon`, `dmgMin`, `dmgMax` and `speed`
      are item fields, the scope table lists damage and speed on both the melee and the ranged tab,
      and neither the panel nor the pipeline has them. Equipping a weapon has to move them, and the
      two together are what a DPS number would be built from. The one thing `equipped()` still does
      not read.
- [ ] **Spell penetration is probably in scope and is missing from the scope table above.** Wrath's
      spell tab shows it. It is priced and aggregated already; it is on the test's silent list only
      until the paper doll is checked, and adding it is then one line on the panel and one in
      `sheet()`.
- [x] Deliberately reads nothing, and the test knows it: **health per 5 sec** (46) and the healing
      half of 41, because the paper doll shows neither - the same call the scope rule made in phase
      1. Gems and enchants are out of the first version and are not on this list; they are absent
      rather than ignored.
- [ ] An equipped list under the sheet: every filled slot as a row, with the item's name in its
      quality color, its item level, the slot it is in, and where it comes from.
- [ ] **No average item level.** Each equipped row carries its own item level and that is all. An
      average would need rules the client never had - which slots count, what an empty off hand is
      worth - and inventing them puts a number on the panel that nothing can check. Per item there
      is nothing to invent: it is the item's own field.
- [ ] The stat sheet, laid out by spec rather than one list for everyone. A ret paladin wants
      attack power, crit, hit, expertise; holy wants spell power, crit, haste, mp5; protection
      wants dodge, parry, block, defense. Same maths underneath, three readouts.
- [ ] Set bonuses from `ItemSet.dbc`, counting equipped pieces.

### Where it drops

The equipped list wants a source per item, and the database can answer it, but only by walking
backwards through the loot tables. Measured on the live database:

- `creature_loot_template` is 93,662 rows, `reference_loot_template` 24,096,
  `gameobject_loot_template` 17,967.
- **The direct case works.** Shadowfrost Shard reverses cleanly to Festergut, Lord Marrowgar, Lady
  Deathwhisper and Sindragosa, each appearing once per difficulty entry, so the difficulty rows
  need collapsing into one boss.
- **References nest.** 4,710 reference rows point at another reference rather than at an item, so
  a single hop is not enough: Muradin's Spyglass sits in reference 12036, which no creature names
  directly. The walk has to go up until it reaches a creature, and the forward walker already in
  `lib/world-db.js` is the mirror of what this needs.
- **Not everything drops.** Shadowmourne has no loot row at all, being a quest reward, and plenty
  of high level gear is crafted or bought. The honest answer for those is to say where it is not
  from rather than to leave the column blank.
- Chests are their own path, through `gameobject_loot_template` and `lib/encounter-chests.js`.

- [ ] Reverse lookup in `lib/world-db.js`: item entry to the creatures and objects that drop it,
      walking nested references, collapsing difficulty entries, and naming the instance through the
      instance browser's existing mapping.
- [ ] **The source is a text field, not a readout.** A real item pulled from the database arrives
      with it filled in by the walk above. A custom item arrives with it empty and you write where
      it would come from, because a piece you invented has an intended source and nothing else in
      the program knows it. Editing an autofilled one overrides it rather than being refused.
- [ ] The text lives on the character's equipped row, not on the item, so the same custom piece can
      be "Yogg-Saron 25 heroic" in one set and something else in another. A real item with no loot
      row starts empty rather than saying "not a drop" - there is nothing to correct if the field
      is yours to write.

This turns the equipped list into something exportable in its own right: a custom tier with a
source per piece is a loot table, which is the shape the raid sheet already draws.

## Phase 4 - racials - **DONE**

Derived, not written out. `SkillLine.dbc` has one racial line per race and `SkillLineAbility.dbc`
names every spell on it, so `racials()` in lib/character.js reads the list out of the client and a
client with a race this program never heard of still answers.

- [x] Pull the list per race and dedupe by name: a racial appears once per rank and per variant, and
      Command is on the orc line five times over.
- [x] Read what each does from `Spell.dbc` through `lib/auras.js`, the aura-id to stat map. Aura ids
      are AzerothCore's own `AuraType` out of SpellAuraDefines.h; about twenty-five reach the sheet.
      The four worked examples in the old plan all reproduce exactly: Axe Specialization 5 expertise
      with weapon mask 8195, Mace Specialization 3, The Human Spirit 3% spirit, Expansive Mind 5%
      intellect.
- [x] **Base points are one below the number the game shows**, everywhere, confirmed by those four.
- [x] The weapon condition is data and is used as data. `EquippedItemClass` 2 with subclass mask
      8195 is fist, axe and two-handed axe, so the orc's expertise lights up with an axe in hand and
      greys out without one - measured end to end, 0 expertise bare, 5 holding Shadowmourne, 0
      holding a sword.
- [x] **Only passive spells count.** Blood Fury carries two attack power auras and is a two-minute
      cooldown; reading them put six attack power on an orc who was not using it. The core tells
      them apart with `SPELL_ATTR0_PASSIVE` and so does this.
- [x] **Descriptions can lie, and the effect index does too.** Heroic Presence is still the party
      area aura in 3.3.5a - effect 35, not 6 - even though the draenei version by Wrath is the self
      one. Reading only effect 6 loses the draenei their one percent hit, so both are read.
- [x] The panel lists only what moves a number. Blood Fury, Shadowmeld and Arcane Torrent are
      abilities you press, and Hardiness and Command are passives about stun duration and pet
      damage, which this sheet does not show. A weapon racial stays even while it is doing nothing,
      greyed with its effect struck through, because "you would have five expertise with an axe" is
      worth knowing. Each row carries its real icon and its real tooltip.
- [ ] The night elf case is still unchecked in game. Quickness is auras 184 and 185, attacker hit
      chance, not dodge - so nothing on this sheet moves for it. Whether Wrath's own sheet folds it
      into displayed dodge is not something the data answers.

## Phase 5 - talent calculator - **DONE**

- [x] `Talent.dbc` read into three trees per class: id, tab, tier, column, up to five spell ranks,
      prerequisite and its rank. **The prerequisite rank is zero-based and always the parent's
      maximum** - measured, `PrereqRank + 1` equals the parent's rank count in all 137 rows that
      have one, which is to say the rule is "the talent above must be maxed" and the field is a
      restatement of it.
- [x] Icons and text come from the spell of each rank. The tooltip is the game's own, drawn by the
      renderer the rest of the program uses, and shows the rank you are on and what the next one
      would buy.
- [x] The rules: level minus nine points, five per tier below the one being spent in, prerequisites
      maxed first. Taking a point back re-validates the tree rather than reasoning about what sits
      below what, so the orphan rule falls out of the other three.
- [x] The tree art is the client's own, named by `TalentTab.dbc` and tiled from four BLPs. They are
      not four equal quarters and they are not fully painted: 256x256, 64x256, 256x128 and 64x128 of
      file holding a 300 by 331 sheet, so the sizes are scaled to put the opaque part where it
      belongs and push the padding out to be clipped.
- [x] Wired into the pipeline through the same aura map Phase 4 built. Anticipation at 5/5 moves a
      warrior's dodge from 5.00% to 10.00%, through the panel rather than in a test.
- [ ] The `SPELL_AURA_DUMMY` talents are still out. Predatory Strikes and its kind are implemented
      in core script and matched on `SpellIconID`, so they need transcribing one at a time or
      leaving out and saying so. Saying so, for now.
- [ ] Glyphs are out of scope for the first version.

## Phase 6 - the sheet as a picture

- [ ] `renderCharacterSheet` beside `renderUnitFrame` in `public/render.js`, so a built character
      exports as a PNG like everything else Astral makes.
- [ ] Saved characters as a kind in the saved store, and a place on a raid sheet.

---

## Verifying it

You run AzerothCore and you have the client, so the reference is directly observable and numeric.
Do not iterate on whether a number looks right.

- [x] **`tools/stat-coverage.js`.** It puts one stat on one item at a time and asks the sheet what
      moved, comparing a geared sheet against a naked one, so a stat cannot pass by being spelled
      like something else. Anything that moves nothing fails unless it
      is on the tool's own silent list. It also checks the editor's `EQUIP_PRESETS` against the
      `RATING_LINES` `budgetStats` can price, since those are two lists with nothing joining them
      and a sentence in one and not the other is a stat you can pick that does nothing. Today it
      reports 17 of 17 presets priced and no failures, having been red on four until the promotions
      above landed. Needs the client, like the probe beside it.
- [ ] A probe that dumps race, class, spec, level, gear and every derived stat, so it can be put
      side by side with the in-game character sheet, column by column.
- [ ] Naked first: a level 80 of each class with nothing equipped should match the sheet exactly
      before any item is involved. That isolates base stats and the derived formulas from the gear
      pipeline.
- [ ] Then one item at a time, then a full set, then a set with a racial that has a weapon
      condition, then talents.
- [ ] The ordering check, which is worth its own test: a 5000 intellect helm on a gnome must read
      5250 with Expansive Mind. If it reads 5000, percentages are being applied before gear.
- [ ] `.additem` a deliberately broken custom item on the test realm and compare that too. The item
      wizard's `identify()` can price the same item and say how many times a T10 chest's budget it
      costs, which pairs well on the same panel.

## Parked - the player frame, with a class icon where the portrait goes

Draw **health** in the game's own player frame rather than as a cell in the stat panel, with the
class icon in the portrait ring instead of a rendered model. That keeps the Armory's promise - no
model anywhere - while the pool reads the way it does in game.

Health only. Not the rune border, not the death knight's own frame art, not rage or energy or
runic power. Those are all in the client and none of them is the point.

**Almost none of this is new code**, which is why it is worth parking rather than dismissing.
Checked in the client's own FrameXML on 2026-08-25:

- `PlayerFrame.xml` names `Interface\TargetingFrame\UI-TargetingFrame` and
  `Interface\TargetingFrame\UI-StatusBar`. The player frame is the *target* frame's texture,
  mirrored. Both are already extracted into `public/ui` as `unit-frame.png` and
  `unit-statusbar.png`, and `renderUnitFrame` in `public/render.js` already draws them with a
  health bar. So this is a horizontal flip and a second entry point, not new art and not a new
  renderer.
- The class icons are one sprite sheet, `Interface\Glues\CharacterCreate\UI-CharacterCreate-Classes.blp`.
  **Its grid and class order are the one thing not yet checked** - confirm those before writing the
  crop, rather than assuming the obvious layout.

Whether health then leaves the stat grid or stays in both places is worth deciding when it is
built, not now.

## Deliberately not doing

- Rendering a character model. The panel is the sheet and nothing else.
- Combat simulation. This reads out a stat block, it does not swing at anything.
- Gems and enchants in the first version. `GemProperties` and `SpellItemEnchantment` are both
  present and parsing, so it is a later addition rather than a rewrite.
