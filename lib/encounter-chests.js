'use strict';

/*
 * Encounters whose reward is a chest rather than a corpse.
 *
 * Some fights hand out their loot through a gameobject: Algalon leaves a Gift of the Observer,
 * the Faction Champions a Champions' Cache, Halls of Stone's Tribunal of Ages a chest at the end
 * of the event. Nothing in the database ties that chest to the encounter — the link is made by the
 * fight's script — so a drop list built from `creature_loot_template` alone comes back empty for
 * exactly the fights whose rewards people go looking for.
 *
 * Worse, four of these encounters have no creature at all: Tribunal of Ages, Escape from Arthas,
 * the Grand Champions and the Faction Champions are events, so there is nothing to read loot from
 * even in principle.
 *
 * Hence this table. The one thing written down is which chest belongs to which encounter; the
 * chest ids and what is inside them are read from the database as normal.
 *
 * **How the difficulties were assigned.** Not guessed — each chest's contents were read and the
 * item level identifies it, against the tier table in lib/item-budget.js. Halls of Stone's chest
 * holds ilvl 183 on one entry and 200 on the other, which is Normal and Heroic; Algalon's holds
 * 226 and 239, which is 10 and 25. Where two entries hold the same item level — the Trial's two
 * 245 caches — the size tells them apart: a 10-man cache carries 20 items and a 25-man 30.
 */

/*
 * Keyed by map, then by the encounter name the client's DungeonEncounter.dbc uses, since that is
 * what the browser has in hand. `difficulty` is the client's own numbering: dungeons run 0 Normal
 * and 1 Heroic, raids 0 = 10N, 1 = 25N, 2 = 10H, 3 = 25H.
 */
const CHESTS = {
    /* Halls of Stone — the Tribunal of Ages event. */
    599: {
        'Tribunal of Ages': [
            { difficulty: 0, gameobject: 190586, note: 'Tribunal Chest, ilvl 183' },
            { difficulty: 1, gameobject: 193996, note: 'Tribunal Chest, ilvl 200' }
        ]
    },

    /* Ulduar — Algalon, and the four keepers, whose hard-mode loot is all in caches. */
    603: {
        'Algalon the Observer': [
            { difficulty: 0, gameobject: 194821, note: 'Gift of the Observer, ilvl 226' },
            { difficulty: 1, gameobject: 194822, note: 'Gift of the Observer, ilvl 239' }
        ],
        'Hodir': [
            { difficulty: 0, gameobject: 194307, note: 'Cache of Winter' },
            { difficulty: 1, gameobject: 194308, note: 'Cache of Winter' },
            { difficulty: 0, gameobject: 194200, note: 'Rare Cache of Winter — hard mode, ilvl 226/232' },
            { difficulty: 1, gameobject: 194201, note: 'Rare Cache of Winter — hard mode, ilvl 239' }
        ],
        'Thorim': [
            { difficulty: 0, gameobject: 194312, note: 'Cache of Storms, ilvl 219' },
            { difficulty: 0, gameobject: 194313, note: 'Cache of Storms — hard mode' },
            { difficulty: 1, gameobject: 194314, note: 'Cache of Storms, ilvl 226/232' },
            { difficulty: 1, gameobject: 194315, note: 'Cache of Storms — hard mode, ilvl 239' }
        ],
        'Freya': [
            { difficulty: 0, gameobject: 195046, note: 'Cache of Living Stone, ilvl 219' },
            { difficulty: 1, gameobject: 195047, note: 'Cache of Living Stone, ilvl 226/232' }
        ],
        'Mimiron': [
            { difficulty: 0, gameobject: 194789, note: 'Cache of Innovation, ilvl 219' },
            { difficulty: 0, gameobject: 194957, note: 'Cache of Innovation — hard mode' },
            { difficulty: 1, gameobject: 194956, note: 'Cache of Innovation, ilvl 226/232' },
            { difficulty: 1, gameobject: 194958, note: 'Cache of Innovation — hard mode, ilvl 239' }
        ]
    },

    /* Trial of the Crusader — the Faction Champions leave a cache, one per difficulty. */
    649: {
        'Faction Champions': [
            { difficulty: 0, gameobject: 195631, note: "Champions' Cache, ilvl 232" },
            { difficulty: 1, gameobject: 195632, note: "Champions' Cache, ilvl 245, 30 items" },
            { difficulty: 2, gameobject: 195633, note: "Champions' Cache, ilvl 245, 20 items" },
            { difficulty: 3, gameobject: 195635, note: "Champions' Cache, ilvl 258" }
        ]
    },

    /* Trial of the Champion — the Grand Champions are an event with a chest at the end. */
    650: {
        'Grand Champions': [
            { difficulty: 0, gameobject: 195709, note: "Champion's Cache, ilvl 200" },
            { difficulty: 1, gameobject: 195710, note: "Champion's Cache, ilvl 219" }
        ]
    },

    /* Halls of Reflection — the escape, whose reward is the Captain's Chest. */
    668: {
        /* The client's DungeonEncounter name is the past tense; the roster shows "Escape from…". */
        'Escaped from Arthas': [
            { difficulty: 0, gameobject: 201710, note: "The Captain's Chest, ilvl 219" },
            { difficulty: 1, gameobject: 202336, note: "The Captain's Chest, ilvl 232" }
        ]
    },

    /* Icecrown Citadel — Valithria's reward is a cache rather than her own corpse. */
    631: {
        'Valithria Dreamwalker': [
            { difficulty: 0, gameobject: 201959, note: 'Cache of the Dreamwalker, ilvl 251' },
            { difficulty: 1, gameobject: 202338, note: 'Cache of the Dreamwalker, ilvl 264' },
            { difficulty: 2, gameobject: 202339, note: 'Cache of the Dreamwalker, ilvl 264' },
            { difficulty: 3, gameobject: 202340, note: 'Cache of the Dreamwalker, ilvl 277' }
        ]
    }
};

/**
 * The chests an encounter leaves behind, grouped by difficulty.
 *
 * Returns one entry per difficulty with the gameobjects that belong to it, so a fight with both a
 * normal cache and a hard-mode one — every Ulduar keeper — reads its two chests into a single
 * button rather than needing two.
 */
function chestsFor(mapId, ...names)
{
    const forMap = CHESTS[Number(mapId)];

    /*
     * Several names because the client keeps two.
     *
     * `DungeonEncounter.dbc` calls the Halls of Reflection finale "Escaped from Arthas" while the
     * roster shows it as "Escape from Arthas", so a table keyed on one of them misses when looked
     * up by the other. Every candidate is tried rather than picking a winner.
     */
    const list = forMap && names.filter(Boolean).map((name) => forMap[name]).find(Boolean);

    if (!list)
    {
        return [];
    }

    const byDifficulty = new Map();

    for (const chest of list)
    {
        const found = byDifficulty.get(chest.difficulty) || { difficulty: chest.difficulty, gameobjects: [], notes: [] };

        found.gameobjects.push(chest.gameobject);
        found.notes.push(chest.note);
        byDifficulty.set(chest.difficulty, found);
    }

    return [...byDifficulty.values()].sort((a, b) => a.difficulty - b.difficulty);
}

/** Whether an encounter's loot is entirely in a chest, which is true of every event fight here. */
function hasChests(mapId, encounterName)
{
    return chestsFor(mapId, encounterName).length > 0;
}

module.exports = { CHESTS, chestsFor, hasChests };
