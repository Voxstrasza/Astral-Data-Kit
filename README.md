# Astral — a 3.3.5a Data Kit

Astral builds the pictures a Wrath of the Lich King server needs: **item tooltips**, **spell
tooltips**, **NPC target frames**, **achievement cards** and **chat scripts**, each drawn the way
the game draws it and exported as a PNG.

Every icon, font and border comes out of **your own game client**, so what you build looks like the
real thing rather than an approximation of it. Point it at a **world database** as well and it
reads your server's real items, creatures and loot tables, so a custom piece can start from the one
it will sit beside.

![The roadmap](art/roadmap.png)

## Getting it

**A built copy** — download the release, unzip it anywhere and run `Astral.exe`. No installer, no
runtime to fetch; the app is self-contained.

**From source** — Node 18 or newer:

```
npm install
npm run app        # desktop window (Electron)
npm run serve      # or in a browser at http://localhost:4173
```

## First run

Open **Settings** and point at your 3.3.5a folder — the one containing `Data\`. Indexing takes a
moment the first time and is cached afterwards. That single step turns on the real icons, the real
fonts, the client's spell and achievement tables, and the dungeon browser.

Connecting a **world database** (AzerothCore or TrinityCore schema) in the same dialog is optional.
It adds the finders — creature search, item search, a boss's real drop list, and the health and
mana pools behind the dungeon browser. Everything else works without it.

## What it makes

**Items.** Quality colours, the **Heroic** tag, binding, unique, slot and weapon type, damage with
calculated DPS, armour, stats, resistances, durability, requirements, set bonuses, flavour text.

- **Green text** — `Equip:` / `Use:` / `Chance on hit:` lines, as many as you like, with the exact
  WotLK phrasings as presets. No mastery: that rating is Cataclysm, not 3.3.5a.
- **Sockets** use the client's own gem-slot textures. Prismatic reuses the generic empty socket,
  because 3.3.5a ships no dedicated prismatic art and the game falls back the same way.
- **Sell price** renders the real gold/silver/copper coin icons.
- **Find an item** searches your database by name or entry id, or browses loot boss by boss —
  every difficulty separately, since a 10-normal and a 25-heroic drop list are different tables.

**Spells.** Name in white with the rank grey and right-aligned beside it, cost and range paired,
cast time and cooldown paired, then the gold description — the in-game layout. Search the client's
`Spell.dbc` by name or id to pull a real spell in and edit it. A spell can carry its
**accompanying buff**, drawn as a second tooltip and saved as its own file, the way the game shows
an aura apart from the spell that applies it.

**NPC target frames.** Portrait, health and power bars with their values, name and level, wrapped
in the client's border art for Normal / Elite / Rare / Rare Elite / Boss.

- **Browse dungeons and raids** by expansion. Every 5-man and raid comes up with its bosses, each
  behind a button per difficulty the instance really offers — nothing for a Classic dungeon,
  Normal and Heroic for a TBC 5-man, four from Trial of the Crusader onwards. That list is read
  from the client's `MapDifficulty.dbc` rather than assumed.
- **Custom scaling** invents a harder version of any creature: +5% to +30%, compounding, with the
  resulting pool shown so a target DPS can be worked out against an enrage timer.
- **Portraits from 3D models.** The client has no creature portrait images — in game they are live
  3D renders — so load the model by display id, pose it and capture the frame. This is the one
  feature that needs an internet connection.

**Achievements.** The achievement card in the client's own parchment, earned or unearned, with
points, reward line and criteria, and a search over the client's own achievement tree.

**Texts.** What a creature says, drawn as the chat frame prints it — speaker, kind and words per
line, so two NPCs can hold a conversation. The colours are the client's own defaults, which is
worth knowing: a creature's *say* is a pale yellow (255 255 159), not white.

**Every window** exports a PNG at 1x–4x with an optional transparent background, copies to the
clipboard, and has a permalink that reopens the exact state **still editable** rather than as a
flat image.

## Building a release

```
npm run package
```

Writes `dist\Astral-win32-x64\` with `Astral.exe` in it and refreshes the desktop shortcut. Close
any running copy first — the packager rewrites the folder wholesale.

`npm run dist` (electron-builder) is also wired up, but on Windows it needs Developer Mode enabled
to unpack `winCodeSign`; `npm run package` avoids that entirely.

## Client artwork is not in this repository

Astral reads the client you already own, and nothing of Blizzard's is committed here. The frame,
socket, coin and achievement textures live in `public/ui/`, which is ignored by git and rebuilt
from your own client:

```
npm run extract-art      # -> public/ui
npm run extract-fonts    # -> public/fonts
```

Both take the client path from the app's settings file, so once you have run Astral and pointed it
at your client they need no arguments. Pass a folder to override:
`node tools/extract-ui-art.js "C:\World of Warcraft"`.

Interface art lives in the **locale** archives (`enUS/locale-enUS.MPQ`), not the common ones —
worth remembering if you add more textures.

## Roadmap

[ROADMAP.md](ROADMAP.md) is the working notebook: what is built, what is parked and why, and the
figures behind each idea — the WotLK item budget derived from `RandPropPoints.dbc`, the instance
and difficulty rules read from the client, the loot-table traps. It is detailed enough to start any
of it from without re-deriving anything.

The picture at the top of this file is generated from it by `node tools/stamp-roadmap.js`.

## Notes

- **Permalinks** encode the editor state as base64 in the URL fragment and never touch a server.
- The world-database password is stored in the local settings file and never sent back to the page.
- The interface font is [Figtree](https://github.com/erikdkennedy/figtree), under the SIL Open Font
  License.
- Fan-made tool, not affiliated with Blizzard Entertainment. World of Warcraft and its assets are
  the property of Blizzard Entertainment.
