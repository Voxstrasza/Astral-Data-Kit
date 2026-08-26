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
    /* Molten Core - Majordomo Executus submits rather than dying; his reward is the cache. */
    409: {
        'Majordomo Executus': [
            { difficulty: 0, gameobject: 179703, note: 'Cache of the Firelord, ilvl 70-71' }
        ]
    },

    /* Blackrock Depths - the Seven leave a chest rather than seven corpses worth looting. */
    230: {
        'The Seven': [
            { difficulty: 0, gameobject: 169243, note: 'Chest of The Seven, ilvl 56-62' }
        ]
    },

    /*
     * Karazhan - the chess event. The two kings are despawned rather than looted; the reward
     * is the Dust Covered Chest, ilvl 115.
     */
    532: {
        'Chess Event': [
            { difficulty: 0, gameobject: 185119, note: 'Dust Covered Chest, ilvl 115' }
        ]
    },

    /*
     * Naxxramas - the Four Horsemen. The four carry no loot table of their own: every drop is in
     * the chest that appears when the last of them dies. 181366 holds ilvl 200 and 193426 ilvl
     * 213, which is 10 and 25.
     */
    533: {
        'The Four Horsemen': [
            { difficulty: 0, gameobject: 181366, note: 'Four Horsemen Chest, ilvl 200' },
            { difficulty: 1, gameobject: 193426, note: 'Four Horsemen Chest, ilvl 213' }
        ]
    },

    /*
     * The Culling of Stratholme - Mal'ganis leaves through a portal rather than dying, so his
     * reward is the Dark Runed Chest. The DBC spells him with a lower-case g.
     */
    595: {
        "Mal'ganis": [
            { difficulty: 0, gameobject: 190663, note: 'Dark Runed Chest, ilvl 187' },
            { difficulty: 1, gameobject: 193597, note: 'Dark Runed Chest, ilvl 200' }
        ]
    },

    /* The Eye of Eternity - Malygos's loot is in Alexstrasza's Gift, ilvl 213 at 10 and 226 at 25. */
    616: {
        'Malygos': [
            { difficulty: 0, gameobject: 193905, note: "Alexstrasza's Gift, ilvl 213" },
            { difficulty: 1, gameobject: 193967, note: "Alexstrasza's Gift, ilvl 226" }
        ]
    },

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
            { difficulty: 0, gameobject: 194200, note: 'Rare Cache of Winter - hard mode, ilvl 226/232' },
            { difficulty: 1, gameobject: 194201, note: 'Rare Cache of Winter - hard mode, ilvl 239' }
        ],
        'Thorim': [
            { difficulty: 0, gameobject: 194312, note: 'Cache of Storms, ilvl 219' },
            { difficulty: 0, gameobject: 194313, note: 'Cache of Storms - hard mode' },
            { difficulty: 1, gameobject: 194314, note: 'Cache of Storms, ilvl 226/232' },
            { difficulty: 1, gameobject: 194315, note: 'Cache of Storms - hard mode, ilvl 239' }
        ],
        /*
         * Kologarn is rubble by the time the fight ends and has no loot table of his own, on any
         * of his three rows. The Cache of Living Stone is his: Stoneguard, Wrathstone and the
         * Sabatons of the Iron Watcher are in it, and none of Freya's nature gear is.
         */
        'Kologarn': [
            { difficulty: 0, gameobject: 195046, note: 'Cache of Living Stone, ilvl 219' },
            { difficulty: 1, gameobject: 195047, note: 'Cache of Living Stone, ilvl 226/232' }
        ],

        /*
         * Freya's own chest is the Gift, and there are eight of them - one per number of elders
         * left alive, at each size. The gear list behind them is shared, but the hard-mode rows
         * carry items of their own, so all eight are read and merged: the even ids are 10-man,
         * the odd ones 25.
         */
        'Freya': [
            { difficulty: 0, gameobject: 194324, note: "Freya's Gift, ilvl 219 - no elders" },
            { difficulty: 0, gameobject: 194326, note: "Freya's Gift, ilvl 219 - one elder" },
            { difficulty: 0, gameobject: 194328, note: "Freya's Gift, ilvl 219 - two elders" },
            { difficulty: 0, gameobject: 194330, note: "Freya's Gift, ilvl 219 - three elders" },
            { difficulty: 1, gameobject: 194325, note: "Freya's Gift, ilvl 226/239 - no elders" },
            { difficulty: 1, gameobject: 194327, note: "Freya's Gift, ilvl 226/239 - one elder" },
            { difficulty: 1, gameobject: 194329, note: "Freya's Gift, ilvl 226/239 - two elders" },
            { difficulty: 1, gameobject: 194331, note: "Freya's Gift, ilvl 226/239 - three elders" }
        ],
        'Mimiron': [
            { difficulty: 0, gameobject: 194789, note: 'Cache of Innovation, ilvl 219' },
            { difficulty: 0, gameobject: 194957, note: 'Cache of Innovation - hard mode' },
            { difficulty: 1, gameobject: 194956, note: 'Cache of Innovation, ilvl 226/232' },
            { difficulty: 1, gameobject: 194958, note: 'Cache of Innovation - hard mode, ilvl 239' }
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
        ],

        /*
         * The Argent Champion is Eadric or Paletress, one or the other per run, and each leaves
         * their own cache. Both are listed because either is what a run can produce.
         */
        'Argent Champion': [
            { difficulty: 0, gameobject: 195374, note: "Eadric's Cache, ilvl 200" },
            { difficulty: 0, gameobject: 195323, note: "Confessor's Cache, ilvl 200" },
            { difficulty: 1, gameobject: 195375, note: "Eadric's Cache, ilvl 219" },
            { difficulty: 1, gameobject: 195324, note: "Confessor's Cache, ilvl 219" }
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
        /*
         * Saurfang is carried off rather than looted, and the gunship battle has no corpse at
         * all. Difficulties by contents: the ilvl 251 list is 10-normal and the ilvl 277 list
         * 25-heroic; of the two ilvl 264 lists, the one holding the same items as the 251 list
         * is 10-heroic and the one matching the 277 list is 25-normal.
         */
        'Deathbringer Saurfang': [
            { difficulty: 0, gameobject: 202239, note: "Deathbringer's Cache, ilvl 251" },
            { difficulty: 1, gameobject: 202240, note: "Deathbringer's Cache, ilvl 264" },
            { difficulty: 2, gameobject: 202238, note: "Deathbringer's Cache, ilvl 264" },
            { difficulty: 3, gameobject: 202241, note: "Deathbringer's Cache, ilvl 277" }
        ],

        /* Both ships stock the same four tables, so one set of ids reads the lot. */
        'Icecrown Gunship Battle': [
            { difficulty: 0, gameobject: 201873, note: 'Gunship Armory, ilvl 251' },
            { difficulty: 1, gameobject: 201874, note: 'Gunship Armory, ilvl 264' },
            { difficulty: 2, gameobject: 201872, note: 'Gunship Armory, ilvl 264' },
            { difficulty: 3, gameobject: 201875, note: 'Gunship Armory, ilvl 277' }
        ],

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

module.exports = { CHESTS, chestsFor };
