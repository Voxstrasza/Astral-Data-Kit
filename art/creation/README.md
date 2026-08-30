# Race backdrops

The Armory's exported picture is drawn on a backdrop chosen by race, with death knights getting
their own whatever race they are. This folder holds those plates.

**They are in-game screenshots, taken with the UI hidden.** Decided 2026-08-30, after the two
other routes were priced:

- **The character creation screens cannot be photographed.** The glue screen draws the character
  model and the race and class panels over the backdrop, and the export puts its own doll in
  exactly that spot. There is no angle that avoids them.
- **They cannot be extracted either.** `Interface\Glues\Models\UI_<Scene>\UI_<Scene>.m2` assembles
  each screen out of tiles and props at run time. `UI_HUMAN`'s largest texture is a 512x512
  cobblestone and `BLOODELF_MATTE` is a sky gradient, not Silvermoon. Rendering them ourselves
  means an M2 and SKIN parser plus a WebGL pass - costed, deferred, and written up in TODO.md
  under phase 6 if it is ever wanted.
- **The 93 loading screens are per continent, not per race.** Ten races collapse onto about four
  paintings, and each carries the WoW logo and a gold border to crop off. Real fallback, coarse
  answer.

A screenshot beats all three: it is per race, it is higher resolution than the client ever renders
the creation screen, and the framing is chosen rather than inherited.

## The files

**Taken 2026-08-30, all nine at 1920x1080.** Gnome shares the dwarf plate and troll shares the orc
one, the way the creation screen does.

| file | what is in it | races |
|---|---|---|
| `Human.jpg` | a Stormwind street, low camera | human |
| `DwarfGnome.jpg` | Ironforge, forges along the far wall | dwarf, gnome |
| `NightElf.jpg` | a Darnassus terrace under purple canopy | night elf |
| `Draenei.jpg` | the Exodar, crystals and orange arches | draenei |
| `OrcTroll.jpg` | Durotar at sunset, Orgrimmar's gate | orc, troll |
| `Undead.jpg` | Deathknell's keep under a green sky | undead |
| `Tauren.jpg` | Thunder Bluff's mesas and rope bridges | tauren |
| `Bloodelf.jpg` | Eversong, gold canopy over a pool | blood elf |
| `DK.jpg` | Ebon Hold's spiked causeway | death knights, every race |

**They are JPGs rather than PNGs**, which is fine here: the plate is darkened under text, and at
quality 10 there is nothing visible to lose. About 17 MB the set, worth recompressing before it
ships inside the app.

## Taking them

- **UI hidden** - Alt+Z - and no character in frame. `.gm fly` to get the camera where you want it.
- **As large as the client will go**, and PNG rather than JPG: the plate is darkened and drawn
  under text, and JPG blocking shows in a flat sky.
- **Leave the middle quiet.** The doll stands dead center and the tooltips run down both sides, so
  the parts of the shot that will still be visible are the top, the bottom and the far edges. A
  horizon a third of the way down works better than a landmark in the middle.
- **Wider than tall.** The sheet is a landscape picture; a 16:9 shot crops to it comfortably.

Drop them here, or anywhere under `art/` and they will be found and moved.
