'use strict';

/*
 * The instance tree: which dungeons and raids each expansion has, what difficulties each offers,
 * and the encounters inside them.
 *
 * All of this is client-side data. The world database knows which creature belongs to an
 * encounter but not which expansion an instance is from, whether it is a 5-man or a raid, or how
 * many difficulties it offers — those live in Map.dbc and MapDifficulty.dbc.
 *
 * Reading them rather than hard-coding an instance list also keeps the awkward cases honest:
 * Alterac Valley drops out on its own because Map.dbc calls it a battleground, and Onyxia's Lair
 * comes back as a 2-difficulty raid because that is what the client says after patch 3.2.2, not
 * because of a special case here.
 */

const { Dbc, LOCALE_FIELDS } = require('./wow/dbc');

/*
 * Field indices. Every localised column is 17 fields wide (16 locales plus a mask), so the
 * offsets are derived from that rather than written as magic numbers — and each table's total is
 * asserted against the field count in its own header, which catches a wrong layout immediately.
 */
const MAP = (() =>
{
    const f = { ID: 0, Directory: 1, InstanceType: 2, Flags: 3, PVP: 4, MapName: 5 };
    f.AreaTableID = f.MapName + LOCALE_FIELDS;
    f.MapDescription0 = f.AreaTableID + 1;
    f.MapDescription1 = f.MapDescription0 + LOCALE_FIELDS;
    f.LoadingScreenID = f.MapDescription1 + LOCALE_FIELDS;
    f.MinimapIconScale = f.LoadingScreenID + 1;
    f.CorpseMapID = f.MinimapIconScale + 1;
    f.CorpseX = f.CorpseMapID + 1;
    f.CorpseY = f.CorpseX + 1;
    f.TimeOfDayOverride = f.CorpseY + 1;
    f.ExpansionID = f.TimeOfDayOverride + 1;
    f.RaidOffset = f.ExpansionID + 1;
    f.MaxPlayers = f.RaidOffset + 1;
    f.COUNT = f.MaxPlayers + 1;
    return f;
})();

const MAP_DIFFICULTY = (() =>
{
    const f = { ID: 0, MapID: 1, Difficulty: 2, Message: 3 };
    f.RaidDuration = f.Message + LOCALE_FIELDS;
    f.MaxPlayers = f.RaidDuration + 1;
    f.Difficultystring = f.MaxPlayers + 1;
    f.COUNT = f.Difficultystring + 1;
    return f;
})();

const DUNGEON_ENCOUNTER = (() =>
{
    const f = { ID: 0, MapID: 1, Difficulty: 2, OrderIndex: 3, Bit: 4, Name: 5 };
    f.SpellIconID = f.Name + LOCALE_FIELDS;
    f.COUNT = f.SpellIconID + 1;
    return f;
})();

const INSTANCE_TYPE = { 1: 'dungeon', 2: 'raid' };

/*
 * Map.dbc still calls Onyxia's Lair a Classic instance, and by 3.3.5a that is no longer the
 * useful answer: patch 3.2.2 rebuilt it as a 10/25-man raid, its creature is flagged exp 2, and
 * MapDifficulty gives it the two Wrath-era difficulties. Filed under Classic it would be the only
 * entry there with difficulty buttons, which reads like a bug rather than history.
 */
const EXPANSION_OVERRIDES = { 249: 2 };

/*
 * Names shown in place of the client's own.
 *
 * Map.dbc calls map 531 "Ahn'Qiraj Temple", which is the sort order talking rather than the
 * name anyone uses — the raid is the Temple of Ahn'Qiraj, and its sibling map 509 is already the
 * Ruins of Ahn'Qiraj rather than "Ahn'Qiraj Ruins". This is display only; the map id is what
 * everything else keys on.
 */
const NAME_OVERRIDES = { 531: "Temple of Ahn'Qiraj" };

const EXPANSIONS = [
    { id: 0, key: 'classic', name: 'Classic' },
    { id: 1, key: 'tbc', name: 'The Burning Crusade' },
    { id: 2, key: 'wotlk', name: 'Wrath of the Lich King' }
];

/*
 * The order instances are listed in, by map id.
 *
 * Alphabetical is the wrong order for a browser you use to find a boss: nobody thinks of Icecrown
 * Citadel as coming after a raid beginning with A, they think of it as the last one. Progression
 * order is what a player already knows, so that is what these lists encode. There is nothing in
 * the client to read it from — `MapDifficulty` and `Map.dbc` carry no release or progression
 * order — so it is written down here.
 *
 * Two shapes, because the two halves of the problem are different:
 *
 *   `full` — the whole list, in order. Anything not named falls in alphabetically at the end,
 *            which is what happens to a map that is in the client but not in the progression.
 *   `tail` — the named maps go to the bottom in this order and everything else stays
 *            alphabetical above them. Wrath's five-mans want this: the order within Northrend's
 *            dungeons does not matter, but the Icecrown three and Trial of the Champion are the
 *            end of the expansion and belong at the end of the list.
 */
const INSTANCE_ORDER = {
    'classic:raid': {
        full: [
            409,   // Molten Core
            309,   // Zul'Gurub
            469,   // Blackwing Lair
            509,   // Ruins of Ahn'Qiraj
            531    // Temple of Ahn'Qiraj
        ]
    },
    'tbc:dungeon': { tail: [585] },                                        // Magister's Terrace last
    'tbc:raid': {
        full: [
            532,   // Karazhan
            565,   // Gruul's Lair
            544,   // Magtheridon's Lair
            548,   // Coilfang: Serpentshrine Cavern
            550,   // Tempest Keep
            534,   // The Battle for Mount Hyjal
            564,   // Black Temple
            568,   // Zul'Aman
            580    // The Sunwell
        ]
    },
    'wotlk:dungeon': {
        tail: [
            650,   // Trial of the Champion
            632,   // The Forge of Souls
            658,   // Pit of Saron
            668    // Halls of Reflection
        ]
    },
    'wotlk:raid': {
        full: [
            615,   // The Obsidian Sanctum
            533,   // Naxxramas
            616,   // The Eye of Eternity
            603,   // Ulduar
            249,   // Onyxia's Lair
            649,   // Trial of the Crusader
            631,   // Icecrown Citadel
            724    // The Ruby Sanctum
        ]
    }
};

/**
 * Sorts one expansion's instances of one type.
 *
 * Everything unnamed sorts by name, so adding a map to the client cannot drop it out of the list
 * — it simply lands alphabetically, above the named tail or below the named run.
 */
function orderInstances(list, key)
{
    const rule = INSTANCE_ORDER[key] || {};
    const named = rule.full || rule.tail || [];
    const isTail = !!rule.tail;

    const rank = (instance) =>
    {
        const at = named.indexOf(instance.mapId);

        if (at === -1)
        {
            return isTail ? [0, 0] : [1, 0];
        }

        return isTail ? [1, at] : [0, at];
    };

    return list.slice().sort((a, b) =>
    {
        const [bucketA, posA] = rank(a);
        const [bucketB, posB] = rank(b);

        return bucketA - bucketB || posA - posB || a.name.localeCompare(b.name);
    });
}

/**
 * Names a difficulty from the data rather than a lookup table.
 *
 * The client numbers raid difficulties 0-3 as 10N, 25N, 10H, 25H, and dungeon difficulties 0-1 as
 * Normal and Heroic. The player counts come from MapDifficulty, so a raid that offers only one
 * difficulty — every Classic and TBC raid — is named by its size alone instead of being called
 * "normal" against nothing.
 */
function difficultyLabel(type, difficulty, maxPlayers, total)
{
    if (type === 'dungeon')
    {
        return difficulty === 0 ? 'Normal' : 'Heroic';
    }

    if (total === 1)
    {
        return `${maxPlayers}-man`;
    }

    const size = `${maxPlayers}`;

    return total > 2 ? `${size} ${difficulty >= 2 ? 'Heroic' : 'Normal'}` : size;
}

class Instances
{
    constructor(assets)
    {
        this.assets = assets;
        this.cache = null;
    }

    /** Drops the parsed tree so the next read picks up a newly configured client. */
    reset()
    {
        this.cache = null;
    }

    read(name, fields)
    {
        const raw = this.assets.readEntry(`DBFilesClient\\${name}`);

        if (!raw)
        {
            throw new Error(`${name} is not in the client archives`);
        }

        const table = new Dbc(raw, name);

        if (fields && table.fieldCount !== fields.COUNT)
        {
            throw new Error(
                `${name}: expected ${fields.COUNT} fields, client has ${table.fieldCount} — layout changed`);
        }

        return table;
    }

    /**
     * The whole tree, parsed once. Around 900 rows across three tables, so this is fast enough
     * not to need the on-disk cache the icon index uses.
     */
    load()
    {
        if (this.cache)
        {
            return this.cache;
        }

        const mapTable = this.read('Map.dbc', MAP);
        const difficultyTable = this.read('MapDifficulty.dbc', MAP_DIFFICULTY);
        const encounterTable = this.read('DungeonEncounter.dbc', DUNGEON_ENCOUNTER);

        const byMap = new Map();

        mapTable.map((r) =>
        {
            const type = INSTANCE_TYPE[r.int(MAP.InstanceType)];

            // Only dungeons and raids: this drops the world maps, battlegrounds and arenas.
            if (!type)
            {
                return;
            }

            const id = r.int(MAP.ID);

            byMap.set(id, {
                mapId: id,
                name: NAME_OVERRIDES[id] || r.string(MAP.MapName),
                directory: r.string(MAP.Directory),
                type,
                expansion: EXPANSION_OVERRIDES[id] ?? r.int(MAP.ExpansionID),
                difficulties: [],
                encounters: []
            });
        });

        difficultyTable.map((r) =>
        {
            const instance = byMap.get(r.int(MAP_DIFFICULTY.MapID));

            if (instance)
            {
                instance.difficulties.push({
                    difficulty: r.int(MAP_DIFFICULTY.Difficulty),
                    maxPlayers: r.int(MAP_DIFFICULTY.MaxPlayers)
                });
            }
        });

        /*
         * An encounter is listed once per difficulty it exists at, so the same fight appears
         * several times and has to be folded back into one row by name.
         *
         * Dropping everything but difficulty 0 would be simpler and is wrong: seven encounters in
         * the game have no difficulty-0 row at all because they only exist on Heroic — Amanitar in
         * Ahn'kahet, Anzu in Sethekk Halls, Blood Guard Porung in Shattered Halls, Eck in Gundrak,
         * Yor in Mana-Tombs, and two in The Nexus. Those would vanish from their instance's roster.
         */
        const seen = new Map();

        encounterTable.map((r) =>
        {
            const mapId = r.int(DUNGEON_ENCOUNTER.MapID);
            const instance = byMap.get(mapId);

            if (!instance)
            {
                return;
            }

            // Some names carry a trailing space in the DBC ("Patchwerk ", "Heigan the Unclean ").
            const name = r.string(DUNGEON_ENCOUNTER.Name).trim();
            const key = `${mapId}|${name}`;
            const difficulty = r.int(DUNGEON_ENCOUNTER.Difficulty);
            const existing = seen.get(key);

            if (existing)
            {
                existing.ids.push(r.int(DUNGEON_ENCOUNTER.ID));
                existing.difficulties.push(difficulty);
                existing.order = Math.min(existing.order, r.int(DUNGEON_ENCOUNTER.OrderIndex));
                return;
            }

            const encounter = {
                encounterId: r.int(DUNGEON_ENCOUNTER.ID),
                ids: [r.int(DUNGEON_ENCOUNTER.ID)],
                difficulties: [difficulty],
                order: r.int(DUNGEON_ENCOUNTER.OrderIndex),
                name
            };

            seen.set(key, encounter);
            instance.encounters.push(encounter);
        });

        for (const instance of byMap.values())
        {
            instance.difficulties.sort((a, b) => a.difficulty - b.difficulty);
            instance.encounters.sort((a, b) => a.order - b.order);

            const total = instance.difficulties.length;
            const offered = instance.difficulties.map((d) => d.difficulty);

            for (const d of instance.difficulties)
            {
                d.label = difficultyLabel(instance.type, d.difficulty, d.maxPlayers, total);
            }

            for (const encounter of instance.encounters)
            {
                encounter.difficulties.sort((a, b) => a - b);

                /*
                 * An encounter listed at difficulty 0 is part of the normal roster and exists at
                 * every difficulty the instance runs at — Icecrown's bosses are listed once, not
                 * four times, so intersecting with the listed difficulties would leave them with
                 * a single button. Only an encounter with no difficulty-0 row is genuinely
                 * restricted, and then the rows it does have are the whole story.
                 */
                encounter.restricted = !encounter.difficulties.includes(0);
                encounter.availableDifficulties = encounter.restricted
                    ? encounter.difficulties.filter((d) => offered.includes(d))
                    : offered.slice();
            }
        }

        // An instance with no encounters is one the client lists but never used.
        const instances = [...byMap.values()].filter((i) => i.encounters.length > 0);

        this.cache = {
            expansions: EXPANSIONS.map((exp) => ({
                ...exp,
                dungeons: orderInstances(
                    instances.filter((i) => i.expansion === exp.id && i.type === 'dungeon'),
                    `${exp.key}:dungeon`
                ),
                raids: orderInstances(
                    instances.filter((i) => i.expansion === exp.id && i.type === 'raid'),
                    `${exp.key}:raid`
                )
            })),
            byMap
        };

        return this.cache;
    }

    /** The expansion list, without the lookup map, for sending to the page. */
    tree()
    {
        return this.load().expansions;
    }

    instance(mapId)
    {
        return this.load().byMap.get(Number(mapId)) || null;
    }
}

module.exports = { Instances, EXPANSIONS, difficultyLabel };
