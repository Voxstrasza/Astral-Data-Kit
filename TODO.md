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

## Phase 2 - `lib/character.js`, the pipeline

Shaped like `lib/item-budget.js`: the tables at the top with where each came from, then a handful
of methods. **Order of operations is the whole game.** Base stats, then flat gear, then percentage
auras, then everything derived. Get that order wrong and every number drifts a little and still
looks plausible.

- [ ] `base(race, class, level)` from Phase 1.
- [ ] Gear aggregation. `budgetStats()` in `lib/items.js` already turns an editor item, custom or
      loaded, into `{str, sta, crit, haste, ...}`. Reuse it rather than writing a second reader.
- [ ] Health: `stamina < 20 ? stamina : 20 + (stamina - 20) * 10`, added to BaseHP. Mana is the
      same shape with intellect and 15. (`GetHealthBonusFromStamina`, `GetManaBonusFromIntellect`.)
- [ ] Armor: item armor, then `+ agility * 2`. (`Player::UpdateArmor`.)
- [ ] Attack power (`Player::UpdateAttackPowerAndDamage`), melee:
      - warrior, paladin, DK: `level * 3 + strength * 2 - 20`
      - hunter, shaman, rogue: `level * 2 + strength + agility - 20`
      - druid, and the rest: see the function, druid depends on form
      ranged: hunter `level * 2 + agility - 10`, rogue and warrior `level + agility - 10`,
      everyone else `agility - 10`.
- [ ] Block: base 5%, plus defense skill over level cap times 0.04, plus block rating.
      Block value from strength.
- [ ] Dodge. `Player::GetDodgeFromAgility` gives it, using `dodge_base[]` (warrior 0.036640, druid
      0.056097, hunter is negative at -0.040873) and `crit_to_dodge[]`, a per-class ratio over 1.15
      since 3.2. Both halves it returns are summed, plus defense skill over the level cap times
      0.04, plus dodge rating, plus any dodge percent aura.
- [ ] Parry: base 5%, plus the same defense contribution, plus parry rating and any parry aura.
      Only warrior, paladin, DK, hunter, rogue and shaman parry at all; the rest read zero.
- [ ] Mana regen from spirit, built in phase 1. The sheet shows two numbers, while casting and
      while not, so the five-second rule needs the casting one as well.
- [ ] Expertise, hit, haste, armor penetration, resilience straight off the ratings.

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
- [ ] The stat panel is one wide box under the weapon row, not a tall column and not tabbed. About
      six stats to a row, grouped so a group does not straddle two rows where it can be helped.
- [ ] Each slot takes an item from the saved store, from the database search, or from whatever the
      Item window is currently showing. Enforce the slot: a helm goes in the head slot and nowhere
      else. Two-handers take both weapon slots.
- [ ] `searchItems` in `lib/world-db.js` has no slot filter today, only name and entry. It needs an
      InventoryType filter so a search opened from the boots slot cannot return a helm.
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

## Phase 4 - racials

They are derivable, not a hand-written list. `SkillLine.dbc` has one racial line per race - 101
Dwarven, 124 Tauren, 125 Orc, 126 Night Elf, 220 Undead, 733 Troll, 753 Gnome, 754 Human, 756 Blood
Elf, 760 Draenei - and `SkillLineAbility.dbc` gives every spell on each with a race mask. Reading
the orc line back gives Blood Fury, Hardiness, Axe Specialization and Command.

- [ ] Pull the list per race and dedupe: the same racial appears several times for its ranks and
      its variants (Command shows up five times on the orc line).
- [ ] Read what each one does from `Spell.dbc`. Verified field offsets: Effect at 71-73, base points
      at 80-82, **aura type at 95-97**, misc value at 110-112, equipped item class at 68 and its
      subclass mask at 69. Worked examples, all read out rather than assumed:

      20574 Axe Specialization    aura 240 (expertise)  base 4   itemClass 2 subclassMask 8195
      20864 Mace Specialization   aura 240              base 2   itemClass 2 subclassMask 48
      20595 Gun Specialization    aura 52  (crit pct)   base 0   itemClass 2 subclassMask 8
      20591 Expansive Mind        aura 137 (stat pct)   base 4
      20598 The Human Spirit      aura 137              base 2
      20550 Endurance             aura 282 (base hp pct) base 4
       6562 Heroic Presence       aura 54, 55           base 0
      20582 Quickness             aura 184, 185         base -3, -3

- [ ] **Base points are one less than the number the game shows.** Axe Specialization stores 4 and
      grants 5 expertise; Gun Specialization stores 0 and grants 1% crit. A first pass that trusts
      the raw field is wrong by exactly one everywhere and still looks right.
- [ ] The weapon condition is data, so use it. `itemClass 2` is weapon and `8195` decodes to fist,
      axe and two-handed axe, so the orc's expertise lights up when an axe is equipped and grays
      out when it is not. Human is mace and two-hand mace, dwarf is guns. No hardcoded weapon
      lists.
- [ ] The aura-id to stat map is the part that gets written by hand. About twenty-five ids matter.
      Everything else on those lines is an active - Blood Fury, Shadowmeld, War Stomp, Arcane
      Torrent - and belongs in the list marked as changing nothing, not in the maths.
- [ ] **Descriptions can lie.** Heroic Presence still reads "for you and all party members" in the
      3.3.5 client, and its row is the party area aura (effect 35), though the draenei version by
      Wrath is the self one. Drive the numbers off the effect values, let the description be flavor.
- [ ] Check the night elf case in game rather than reasoning about it. Quickness stores two -3
      effects as auras 184 and 185, which are attacker hit chance, not dodge. Whether Wrath's sheet
      folds that into displayed dodge or leaves it invisible is not something the data answers.

## Phase 5 - talent calculator

One tree set per class, and it feeds the sheet.

- [ ] `Talent.dbc` has everything the drawing needs, verified: id, tab, tier, column, up to five
      spell ranks at fields 4-8, prerequisite talent at 13 and its rank at 16. 139 talents have a
      prerequisite. Trees run 25 to 31 talents each; protection warrior is tab 163 with 27, reading
      out in the right order (tier 0 is Improved Bloodrage, Shield Specialization, Improved Thunder
      Clap; Anticipation sits at tier 1 column 2).
- [ ] Icons come from the spell of each rank through `SpellIcon.dbc`, which the spell search
      already resolves.
- [ ] The rules: 71 points at 80, five points per tier below the one you are spending in,
      prerequisites satisfied before their dependents, and taking a point back cannot orphan
      anything below it.
- [ ] Wire the stat-affecting ones into the pipeline through the same aura map Phase 4 builds. It
      is the same mechanism: Anticipation is aura 49, dodge percent; Toughness is aura 142 on base
      resistance.
- [ ] Know the exception before it bites. Some talents are `SPELL_AURA_DUMMY` and are implemented
      in core script code rather than in the spell data, matched on `SpellIconID` - Predatory
      Strikes in `UpdateAttackPowerAndDamage` is one. Those need transcribing individually, or
      leaving out and saying so.
- [ ] Glyphs are out of scope for the first version.

## Phase 6 - the sheet as a picture

- [ ] `renderCharacterSheet` beside `renderUnitFrame` in `public/render.js`, so a built character
      exports as a PNG like everything else Astral makes.
- [ ] Saved characters as a kind in the saved store, and a place on a raid sheet.

---

## Verifying it

You run AzerothCore and you have the client, so the reference is directly observable and numeric.
Do not iterate on whether a number looks right.

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

## Deliberately not doing

- Rendering a character model. The panel is the sheet and nothing else.
- Combat simulation. This reads out a stat block, it does not swing at anything.
- Gems and enchants in the first version. `GemProperties` and `SpellItemEnchantment` are both
  present and parsing, so it is a later addition rather than a rewrite.
