# Astral - a 3.3.5a Data Kit

Astral is a conceptualization tool for Wrath of the Lich King content.

It is where you design a thing before it exists in the game: an item, a spell, a boss, an
achievement, a line of dialogue - or a whole raid built out of all of them. Everything you make
draws the way the client draws it, using the icons, fonts and border art from your own 3.3.5a
install, and exports as a PNG. Point it at a world database as well and it reads your server's real
items, creatures and loot tables, so a custom piece can start from the one it will sit beside.

Visualize your creativity and see how it would appear in-game.

## Getting it

Download the [latest release](https://github.com/Voxstrasza/Astral-Data-Kit/releases), unzip it
anywhere and run `Astral.exe`. No installer, no runtime to fetch.

From source, with Node 18 or newer:

```
npm install
npm run app        # the app, from source
npm run package    # build dist\Astral-win32-x64\Astral.exe
```

## Initialization

Open **Settings** and point at your 3.3.5a folder - the one containing `Data\`. That turns on the
real icons and fonts, the client's spell and achievement tables, and the dungeon browser.

Connecting a **world database** (AzerothCore or TrinityCore schema) in the same dialog is optional.
It adds creature search, item search, real loot tables and real health pools.

## Tools

- **Item** - create an item tooltip, or pull existing data from the database and load it, matching
  the in-game engine.
- **Spell** - create a spell tooltip, or pull existing data from `Spell.dbc` and load it, matching
  the in-game engine.
- **NPC** - in-game target frame with health pools. Create a creature or pull a dungeon/raid
  creature from the database. Customize the scaling and pull portraits from the 3D model, matching
  the in-game engine.
- **Achievement** - create an achievement or load an existing one as it would appear in-game.
- **Texts** - want to formulate some roleplay? Draft some text as it would appear in-game, complete
  with boss whispers and boss announcements.
- **Raid Wizard** - where everything you build with the previous tools can go. Exports an image
  where on one sheet you can view target frames, spells, texts and more.

Every tool exports a PNG at 1x-4x and copies to the clipboard.

## Examples

Example of target frames:

![Target frame](art/malformed-ghoul.png)

Example of spell tooltips:

![Spell tooltip](art/army-of-the-damned.png)

![Spell tooltip](art/necrotic-convergence.png)

Example of text editor:

![Encounter texts](art/overlordbloodbanetexts.png)

Example of achievement editor:

![Achievement card](art/there-must-always-be-a-nevermind.png)

Example of raid wizard output:

![Raid wizard sheet](art/overlord-bloodbane-25h.png)

## Future features

- **Item wizard** - build upon the gear formula and create gear beyond Icecrown Citadel, or create
  new gearsets that fit nicely in existing tiers.
- **SQL exporter** - export the items you create straight into AzerothCore or TrinityCore:
  ready-to-run `INSERT` statements for whatever the editor is showing, with only an entry id to
  supply.
- **Armory** - build a character and see what your own gear would do to it.
- **Live portraits** - portraits rendered from the client's own `.m2` models with the camera stored
  inside the model file, so the framing is the game's rather than an approximation. The data half
  is built and verified; a local renderer is the work left.

## Notes

- The world-database password stays in the local settings file.
- Interface font is [Figtree](https://github.com/erikdkennedy/figtree) (SIL Open Font License).
- Fan-made tool, not affiliated with Blizzard Entertainment. World of Warcraft and its assets are
  the property of Blizzard Entertainment.
