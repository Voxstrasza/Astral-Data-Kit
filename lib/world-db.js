'use strict';

/*
 * Optional AzerothCore world-database lookup, backing the NPC picker.
 *
 * Everything the target frame needs about a creature lives here rather than in the client: names
 * are server data, not DBC data. The connection is lazy and entirely optional — without it you can
 * still build a frame by hand.
 */

const { membersFor, renameFor, isSuppressed, normalizeName } = require('./encounter-members');

/** `?, ?, ?` for a list, which every query below builds by hand otherwise. */
function holes(list)
{
    return list.map(() => '?').join(',');
}

let mysql = null;

try
{
    mysql = require('mysql2/promise');
}
catch
{
    // mysql2 missing just means the NPC picker stays unavailable.
}

/* AzerothCore creature_template.rank -> our classification values. */
const RANK_TO_CLASSIFICATION = {
    0: 'normal',
    1: 'elite',
    2: 'rare-elite',
    3: 'boss',
    4: 'rare'
};

/* creature_template.unit_class -> the bar the unit actually uses. */
const CLASS_TO_POWER = {
    1: 'rage',    // Warrior
    2: 'mana',    // Paladin
    4: 'energy',  // Rogue
    8: 'mana'     // Mage
};

/*
 * Everything the target frame needs about a creature.
 *
 * Health and mana are not stored on the creature. AzerothCore keeps base pools in
 * creature_classlevelstats per level and unit class, and creature_template carries a multiplier —
 * so the real pool is base x modifier. Which base column applies depends on the creature's
 * expansion: exp 2 is Wrath, 1 Burning Crusade, 0 vanilla.
 *
 * Shared by the NPC search and the instance browser rather than written twice, so a boss picked
 * out of a raid and the same boss found by name cannot report different health.
 */
const CREATURE_SELECT = `
    SELECT ct.entry,
           ct.name,
           ct.subname,
           ct.minlevel,
           ct.maxlevel,
           ct.\`rank\` AS creatureRank,
           ct.faction,
           ct.unit_class,
           ct.exp,
           ct.HealthModifier,
           ct.ManaModifier,
           ct.difficulty_entry_1 AS difficulty1,
           ct.difficulty_entry_2 AS difficulty2,
           ct.difficulty_entry_3 AS difficulty3,
           CASE
               WHEN ct.exp >= 2 THEN s.basehp2
               WHEN ct.exp = 1  THEN s.basehp1
               ELSE s.basehp0
           END AS baseHp,
           s.basemana AS baseMana,
           ctm.CreatureDisplayID AS displayId
    FROM creature_template ct
    LEFT JOIN creature_template_model ctm
           ON ctm.CreatureID = ct.entry AND ctm.Idx = 0
    LEFT JOIN creature_classlevelstats s
           ON s.level = ct.maxlevel AND s.class = ct.unit_class
`;

/** One row of CREATURE_SELECT as the shape the page works in. */
function creatureFromRow(row)
{
    const health = Math.round((Number(row.baseHp) || 0) * (Number(row.HealthModifier) || 1));
    const mana = Math.round((Number(row.baseMana) || 0) * (Number(row.ManaModifier) || 1));
    const power = CLASS_TO_POWER[row.unit_class] || 'none';

    return {
        entry: row.entry,
        name: row.name,
        subname: row.subname || '',
        level: row.maxlevel || row.minlevel || 80,
        minLevel: row.minlevel,
        maxLevel: row.maxlevel,
        classification: RANK_TO_CLASSIFICATION[row.creatureRank] || 'normal',
        faction: row.faction,
        displayId: row.displayId || 0,
        health,
        // A mana-less class, or a zero pool, means no second bar at all.
        mana: power === 'mana' ? mana : 0,
        power: power === 'mana' && mana <= 0 ? 'none' : power
    };
}

/*
 * DungeonEncounter.dbc is not carefully proofread and its typos show up in the roster.
 *
 * Taking the resolved creature's name instead looks like a clean general fix and is not: an
 * encounter is often several creatures, and its DBC name is the proper title for the fight while
 * the credited creature is just one participant. Applied blanket-style it renamed "Chess Event"
 * to "Chess Piece: Status Bar", "Mimiron" to "Leviathan Mk II" and "Northrend Beasts" to
 * "Icehowl" — each technically the credited creature, each wrong on screen.
 *
 * So the creature's name is used only when it is the same name differently spelled — compared
 * with case and punctuation removed — and everything else is listed here explicitly. Eight
 * entries, each checked against the creature it names, is a smaller price than a rule that
 * silently mangles two dozen encounter titles.
 */
const ENCOUNTER_NAME_FIXES = {
    'escaped from arthas': 'Escape from Arthas',
    'ramnstein the gorger': 'Ramstein the Gorger',
    "ghaz'rilla": "Gahz'rilla",
    'salram the fleshcrafter': 'Salramm the Fleshcrafter',
    'ormrok the tree-shaper': 'Ormorok the Tree-Shaper',
    'maiden of the virtue': 'Maiden of Virtue',
    "queen lana'thel": "Blood-Queen Lana'thel",
    // creature_template calls him Scourgelord, which is the name the game shows.
    'overlrod tyrannus': 'Scourgelord Tyrannus'
};

/** Case and punctuation removed, so "Mal'ganis" and "Mal'Ganis" compare equal. */


const fixEncounterName = (name) =>
    ENCOUNTER_NAME_FIXES[String(name).trim().toLowerCase()] || name;

/*
 * The item columns the editor can actually show. item_template has 130-odd columns and most are
 * server bookkeeping — the ones here are what a tooltip is made of, plus the loot and budget
 * fields the item wizard reads.
 */
const ITEM_SELECT = `
    SELECT it.entry,
           it.name,
           it.displayid,
           it.class,
           it.subclass,
           it.Quality,
           it.Flags,
           it.InventoryType,
           it.ItemLevel,
           it.RequiredLevel,
           it.bonding,
           it.description,
           it.AllowableClass,
           it.RequiredReputationFaction, it.RequiredReputationRank,
           it.armor,
           it.block,
           it.MaxDurability,
           it.dmg_min1, it.dmg_max1, it.dmg_type1,
           it.delay,
           it.SellPrice,
           it.itemset,
           it.socketColor_1, it.socketColor_2, it.socketColor_3, it.socketBonus,
           it.holy_res, it.fire_res, it.nature_res, it.frost_res, it.shadow_res, it.arcane_res,
           it.spellid_1, it.spelltrigger_1, it.spellid_2, it.spelltrigger_2,
           it.RandomProperty, it.RandomSuffix, it.ScalingStatDistribution,
           it.stat_type1, it.stat_value1, it.stat_type2, it.stat_value2,
           it.stat_type3, it.stat_value3, it.stat_type4, it.stat_value4,
           it.stat_type5, it.stat_value5, it.stat_type6, it.stat_value6,
           it.stat_type7, it.stat_value7, it.stat_type8, it.stat_value8,
           it.stat_type9, it.stat_value9, it.stat_type10, it.stat_value10
    FROM item_template it
`;

class WorldDb
{
    constructor()
    {
        this.pool = null;
        this.config = null;
        this.lastError = null;
    }

    async connect(config)
    {
        this.disconnect();

        if (!mysql)
        {
            this.lastError = 'mysql2 is not installed.';
            return { ok: false, reason: this.lastError };
        }

        this.config = config;

        try
        {
            this.pool = mysql.createPool({
                host: config.host,
                port: Number(config.port) || 3306,
                user: config.user,
                password: config.password,
                database: config.database,
                waitForConnections: true,
                connectionLimit: 4,
                // A wrong host should fail fast rather than hang the UI.
                connectTimeout: 8000
            });

            /*
             * Counting both tables is the connection test as well as the number reported. Two
             * counts in one round trip, because a database that answers for creatures and not for
             * items is a half-connection worth finding out about here rather than at the first
             * search.
             */
            const [rows] = await this.pool.query(
                'SELECT (SELECT COUNT(*) FROM creature_template) AS creatures,'
                + ' (SELECT COUNT(*) FROM item_template) AS items');

            this.lastError = null;

            return { ok: true, creatures: rows[0].creatures, items: rows[0].items };
        }
        catch (err)
        {
            this.lastError = err.code || err.message;
            this.disconnect();

            return { ok: false, reason: this.lastError };
        }
    }

    get connected()
    {
        return !!this.pool;
    }

    /**
     * Search by name, or by entry id when the query is numeric.
     *
     * `rank` is a reserved word in MySQL 8, hence the backticks — without them this fails with a
     * parse error rather than anything that hints at the cause.
     */
    async searchCreatures(query, limit = 40)
    {
        if (!this.pool)
        {
            return [];
        }

        const numeric = /^\d+$/.test(String(query).trim());

        const sql = `
            ${CREATURE_SELECT}
            WHERE ${numeric ? 'ct.entry = ?' : 'ct.name LIKE ?'}
            ORDER BY ${numeric ? 'ct.entry' : 'CHAR_LENGTH(ct.name), ct.name'}
            LIMIT ?
        `;

        const param = numeric ? Number(query) : `%${query}%`;
        const [rows] = await this.pool.query(sql, [param, Number(limit)]);

        return rows.map(creatureFromRow);
    }

    /** Full creature rows for a set of entry ids, keyed by entry. */
    async creaturesByEntry(entries)
    {
        const ids = [...new Set(entries.map(Number).filter((n) => n > 0))];

        if (!this.pool || !ids.length)
        {
            return new Map();
        }

        const [rows] = await this.pool.query(
            `${CREATURE_SELECT} WHERE ct.entry IN (${ids.map(() => '?').join(',')})`, ids);

        return new Map(rows.map((row) => [row.entry, {
            ...creatureFromRow(row),
            variantEntries: [row.difficulty1, row.difficulty2, row.difficulty3]
        }]));
    }

    /**
     * The creatures making up an encounter that has no single kill credit.
     *
     * The Four Horsemen are four creatures sharing one `boss_four_horsemen` script; Ulduar's Iron
     * Council is three separately scripted bosses. Both are found the same way — take the bosses
     * spawned on the map that no other encounter already claims.
     *
     * Two filters keep it honest. Only `boss_` scripts count, which drops adds and vehicles that
     * happen to be flagged elite (`npc_auriaya_sanctum_sentry`, `Ironwork Cannon`). And a script
     * that extends another encounter's script belongs to that encounter, not this one — which is
     * what keeps Freya's three elders (`boss_freya_elder_*`) and Yogg-Saron's Sara
     * (`boss_yoggsaron_sara`) out of the Iron Council's roster.
     */
    async encounterMembers(mapId, claimedEntries, ownerScripts, encounterNames)
    {
        const claimed = [...claimedEntries].filter((n) => n > 0);

        const [rows] = await this.pool.query(
            `SELECT DISTINCT ct.entry, ct.name, ct.ScriptName
             FROM creature c
             JOIN creature_template ct ON ct.entry = c.id
             WHERE c.map = ?
               AND ct.\`rank\` >= 1
               AND ct.ScriptName LIKE 'boss\\_%'
               ${claimed.length ? `AND ct.entry NOT IN (${claimed.map(() => '?').join(',')})` : ''}`,
            [Number(mapId), ...claimed]);

        const names = new Set(encounterNames);

        const candidates = rows.filter((row) =>
            // A creature named after another encounter in the instance belongs to that one. The
            // Mimiron encounter credits Leviathan Mk II, leaving the Mimiron creature unclaimed.
            !names.has(row.name)
            // A script that extends another encounter's script belongs to that encounter — this
            // is what keeps Freya's elders and Yogg-Saron's Sara out.
            && !ownerScripts.some((script) =>
                script && row.ScriptName !== script && row.ScriptName.startsWith(`${script}_`)));

        /*
         * Only a group the data actually identifies counts: two or more creatures sharing one
         * script, the way all four Horsemen share `boss_four_horsemen`.
         *
         * Anything looser is guesswork. Ulduar's Iron Council is three separately scripted bosses
         * and Icecrown's gunship is fought on its own map entirely, so "unclaimed bosses on this
         * map" would have listed Sister Svalna and two Blood Council princes as the gunship crew.
         * Saying nothing beats saying something wrong.
         */
        const byScript = new Map();

        for (const row of candidates)
        {
            if (!byScript.has(row.ScriptName)) { byScript.set(row.ScriptName, []); }
            byScript.get(row.ScriptName).push(row.entry);
        }

        return [...byScript.values()].filter((group) => group.length > 1).flat();
    }

    /**
     * Resolves DungeonEncounter.dbc encounters to the creature behind each, and that creature's
     * difficulty variants.
     *
     * `instance_encounters.entry` is the DungeonEncounter id, which is what makes this work at
     * all: 57 of the game's encounter bosses are summoned by script and have no row in `creature`,
     * so there is no spawn to look a map up from. Trial of the Crusader is entirely in that group.
     *
     * Encounters credited by spell rather than by a kill (creditType 1) have no creature to point
     * at. Where the encounter is really one creature its name matches a creature_template row, so
     * that is tried second — Ulduar's Hodir, Thorim, Freya and Algalon all come back that way.
     * What is left is a fight made of several creatures, and `encounterMembers` lists those.
     */
    async bossesForEncounters(encounters, mapId)
    {
        if (!this.pool || !encounters.length)
        {
            return [];
        }

        // An encounter has one id per difficulty it exists at; any of them can carry the credit.
        const ids = encounters.flatMap((e) => e.ids || [e.encounterId]);
        const encounterOf = new Map();

        for (const encounter of encounters)
        {
            for (const id of encounter.ids || [encounter.encounterId])
            {
                encounterOf.set(id, encounter);
            }
        }

        const [credits] = await this.pool.query(
            `SELECT entry, creditEntry FROM instance_encounters
             WHERE creditType = 0 AND entry IN (${ids.map(() => '?').join(',')})`, ids);

        /* Any of an encounter's difficulty ids can carry the credit; the first one wins. */
        const primary = new Map();

        for (const row of credits)
        {
            const encounter = encounterOf.get(row.entry);

            if (encounter && !primary.has(encounter)) { primary.set(encounter, row.creditEntry); }
        }

        const unresolved = encounters.filter((e) => !primary.has(e));

        if (unresolved.length)
        {
            const names = unresolved.map((e) => e.name);

            /*
             * Prefer a row that has a difficulty chain, then the lowest entry. Names are not
             * unique — Keristrasza has four rows and only one carries the heroic link — so
             * without the ordering this picks the wrong copy more often than the right one.
             */
            const [matches] = await this.pool.query(
                `SELECT entry, name FROM creature_template
                 WHERE name IN (${names.map(() => '?').join(',')})
                 ORDER BY (difficulty_entry_1 > 0) DESC, entry ASC`, names);

            /*
             * Keyed in lower case on both sides. MySQL's default collation matched
             * "Mal'ganis" to the stored "Mal'Ganis" and returned the row, but a JavaScript Map
             * is case-sensitive, so the lookup missed it again and the encounter came back
             * looking like a multi-creature fight.
             */
            const firstByName = new Map();

            for (const row of matches)
            {
                const key = row.name.trim().toLowerCase();
                if (!firstByName.has(key)) { firstByName.set(key, row.entry); }
            }

            for (const encounter of unresolved)
            {
                const entry = firstByName.get(encounter.name.trim().toLowerCase());

                if (entry) { primary.set(encounter, entry); }
            }
        }

        /*
         * Whatever is still unresolved is an encounter made of several creatures. Attributing the
         * map's leftover bosses is only unambiguous when one such encounter remains — Trial of the
         * Champion has two (Grand Champions and Argent Champion) drawn from a shared pool, and
         * guessing which creature belongs to which would be worse than saying nothing.
         */
        /*
         * Curated groups first. These apply whether or not the encounter resolved to a creature:
         * the Northrend Beasts credit Icehowl and are still four bosses, so the roster has to be
         * able to say both things at once.
         */
        const members = new Map();

        for (const encounter of encounters)
        {
            const curated = membersFor(mapId, encounter.name);

            if (curated) { members.set(encounter, curated); }
        }

        const multi = encounters.filter((e) => !primary.has(e) && !members.has(e));

        if (multi.length === 1 && mapId)
        {
            const claimed = [...primary.values()];
            const [scripts] = claimed.length
                ? await this.pool.query(
                    `SELECT ScriptName FROM creature_template WHERE entry IN (${claimed.map(() => '?').join(',')})`,
                    claimed)
                : [[]];

            const found = await this.encounterMembers(
                mapId, claimed, scripts.map((s) => s.ScriptName).filter(Boolean),
                encounters.map((e) => e.name));

            if (found.length) { members.set(multi[0], found); }
        }

        const bases = await this.creaturesByEntry([
            ...primary.values(),
            ...[...members.values()].flat()
        ]);

        const variantIds = [];

        for (const base of bases.values()) { variantIds.push(...base.variantEntries); }

        const variants = await this.creaturesByEntry(variantIds);

        /* One creature and its difficulty chain, trimmed to the difficulties it really has. */
        const tiersFor = (base, encounter) =>
        {
            /*
             * Index by difficulty, not by column order. The columns are not ascending: for a
             * four-difficulty raid the base is 10N, difficulty_entry_1 is 25N, _2 is 10H and _3
             * is 25H, which Lord Marrowgar's health modifiers (500 / 1700 / 750 / 2250) confirm.
             */
            const chain = [base, ...base.variantEntries.map((id) => variants.get(id) || null)];
            const available = encounter.availableDifficulties || [0, 1, 2, 3];

            const tiers = chain
                .map((creature, difficulty) =>
                {
                    if (!creature) { return null; }

                    const { variantEntries, ...rest } = creature;

                    /*
                     * Variant rows are named for their slot — "The Lich King (3)", "Lord
                     * Marrowgar (1)" — which is bookkeeping, not a name that belongs on a
                     * target frame. They are the same creature at a different difficulty, so
                     * every tier takes the base entry's name.
                     */
                    return { difficulty, ...rest, name: base.name, subname: base.subname };
                })
                .filter(Boolean)
                .filter((tier) => available.includes(tier.difficulty));

            /*
             * A Heroic-only encounter whose creature has no separate variant row — Anzu, Yor, Eck
             * — still belongs on its Heroic button rather than disappearing, so the base creature
             * takes that slot.
             */
            if (!tiers.length && chain[0])
            {
                const { variantEntries, ...rest } = chain[0];
                return [{ difficulty: available[0], ...rest }];
            }

            return tiers;
        };

        /*
         * A curated list keeps its own order — Gormok, Acidmaw, Dreadscale, Icehowl is the order
         * you fight them, which is more useful than the alphabet. Detected groups have no
         * meaningful order, so those are sorted.
         */
        const groupFor = (encounter) =>
        {
            const ids = members.get(encounter) || [];
            const curated = !!membersFor(mapId, encounter.name);

            const group = ids
                .map((id) => bases.get(id))
                .filter(Boolean)
                .map((creature) => ({
                    entry: creature.entry,
                    name: creature.name,
                    difficulties: tiersFor(creature, encounter)
                }));

            return curated ? group : group.sort((a, b) => a.name.localeCompare(b.name));
        };

        const built = encounters.map((encounter) =>
        {
            const entry = primary.get(encounter);
            const base = entry ? bases.get(entry) : null;

            if (base)
            {
                /*
                 * Only take the creature's spelling when it is the same name — otherwise the
                 * encounter keeps its own title and the fixes table handles the rest.
                 */
                const sameName = normalizeName(base.name) === normalizeName(encounter.name);
                const renamed = renameFor(mapId, encounter.name);

                return {
                    ...encounter,
                    name: renamed || (sameName ? base.name : fixEncounterName(encounter.name)),
                    encounterName: encounter.name,
                    entry: base.entry,
                    difficulties: tiersFor(base, encounter),
                    members: groupFor(encounter)
                };
            }

            return {
                ...encounter,
                name: renameFor(mapId, encounter.name) || fixEncounterName(encounter.name),
                encounterName: encounter.name,
                entry: 0,
                difficulties: [],
                members: groupFor(encounter)
            };
        });

        /*
         * Two encounter rows can be the same fight.
         *
         * The Nexus lists "Ormorok the Tree-Shaper" at normal and "Ormrok the Tree-Shaper" at
         * heroic — one boss, spelled two ways, so grouping by name kept them apart and the
         * misspelt one showed up as a heroic-only extra. They both credit creature 26794, which
         * is the thing that actually identifies them.
         */
        const merged = [];
        const byEntry = new Map();

        for (const boss of built.filter((b) => !isSuppressed(mapId, b.encounterName || b.name)))
        {
            if (!boss.entry)
            {
                merged.push(boss);
                continue;
            }

            const seen = byEntry.get(boss.entry);

            if (!seen)
            {
                byEntry.set(boss.entry, boss);
                merged.push(boss);
                continue;
            }

            seen.ids = [...new Set([...(seen.ids || []), ...(boss.ids || [])])];
            seen.difficulties = seen.difficulties.length >= boss.difficulties.length
                ? seen.difficulties
                : boss.difficulties;
            seen.restricted = seen.restricted && boss.restricted;
            seen.order = Math.min(seen.order, boss.order);
        }

        return merged.sort((a, b) => a.order - b.order);
    }

    /* ------------------------------------------------------------------ items and loot */

    /**
     * Search items by name, or by entry id when the query is a number.
     *
     * Ordered the way the NPC search is — shortest name first — so typing "Shadowmourne" puts the
     * legendary above "Shadowmourne Fragment". Quality descending on top of that, because an epic
     * is nearly always the one being looked for.
     */
    async searchItems(query, limit = 40, types = null, kind = null)
    {
        if (!this.pool)
        {
            return [];
        }

        const numeric = /^\d+$/.test(String(query).trim());

        /*
         * The slot filter, for a search opened from one of the Armory's slots. Without it a search
         * from the boots slot answers with helms, which is the wrong list to be reading. An empty
         * list of types means no filter rather than no results, so the Item window's own search is
         * unaffected.
         */
        const slots = (types || []).map(Number).filter((n) => n > 0);
        const bySlot = slots.length ? ` AND it.InventoryType IN (${slots.map(() => '?').join(',')})` : '';

        /*
         * A relic slot narrows further than its InventoryType can.
         *
         * Librams, idols, totems and sigils are all InventoryType 28, so the slot filter alone
         * offers a death knight's Sigil slot the paladin's librams. The armor subclass is what
         * tells the four apart.
         */
        const byKind = kind
            ? ` AND it.class = ? AND it.subclass IN (${kind.subclasses.map(() => '?').join(',')})`
            : '';

        const sql = `
            ${ITEM_SELECT}
            WHERE ${numeric ? 'it.entry = ?' : 'it.name LIKE ?'}${bySlot}${byKind}
            ORDER BY ${numeric ? 'it.entry' : 'it.Quality DESC, CHAR_LENGTH(it.name), it.name'}
            LIMIT ?
        `;

        const [rows] = await this.pool.query(
            sql, [numeric ? Number(query) : `%${query}%`, ...slots,
                ...(kind ? [kind.itemClass, ...kind.subclasses] : []), Number(limit)]);

        return rows;
    }

    /** Full item rows for a set of entry ids, in the order asked for. */
    async itemsByEntry(entries)
    {
        const ids = [...new Set(entries.map(Number).filter((n) => n > 0))];

        if (!this.pool || !ids.length)
        {
            return [];
        }

        const [rows] = await this.pool.query(
            `${ITEM_SELECT} WHERE it.entry IN (${ids.map(() => '?').join(',')})`, ids);

        const byEntry = new Map(rows.map((row) => [row.entry, row]));

        return ids.map((id) => byEntry.get(id)).filter(Boolean);
    }

    /**
     * What a creature drops, with reference lists followed.
     *
     * The references are the whole point. The Lich King's own loot row is three lines — two items
     * and a pointer to reference 34238 — and everything anyone associates with him is behind that
     * pointer. A drop list that stops at creature_loot_template looks empty for exactly the bosses
     * worth looking up.
     *
     * References can nest, so this follows them to a small depth rather than one level, and keeps
     * a seen set in case a list ever points at itself.
     */
    async lootForCreature(entry, options = {})
    {
        if (!this.pool || !entry)
        {
            return [];
        }

        const entries = [Number(entry), ...(options.also || []).map(Number)].filter((n) => n > 0);
        const unique = [...new Set(entries)];

        /*
         * A creature's drops are filed under its lootid, which is not always its entry.
         *
         * 847 rows of a stock world database name a lootid different from their own entry, and
         * nearly all of them are difficulty variants: Blood Guard Porung is entry 20923 on Normal
         * and 20993 on Heroic, and the Heroic row carries no loot of its own - it points back at
         * 20923. Asking creature_loot_template for the entry therefore came back empty for exactly
         * the creature being looked at, and Porung is Heroic-only, so he had no drops at all.
         */
        const [owners] = await this.pool.query(
            `SELECT entry, lootid FROM creature_template WHERE entry IN (${unique.map(() => '?').join(',')})`,
            unique);

        const lootIds = [...new Set(owners.map((row) => Number(row.lootid)).filter((id) => id > 0))];

        if (!lootIds.length)
        {
            return [];
        }

        const [rows] = await this.pool.query(
            `SELECT Entry, Item, Reference, Chance, QuestRequired, LootMode, GroupId, MinCount, MaxCount
             FROM creature_loot_template
             WHERE Entry IN (${lootIds.map(() => '?').join(',')})`, lootIds);

        const drops = new Map();
        const pending = [];

        for (const row of rows)
        {
            if (row.Reference)
            {
                pending.push({ reference: row.Reference, chance: row.Chance, depth: 0 });
            }
            else if (row.Item)
            {
                drops.set(row.Item, {
                    item: row.Item,
                    chance: row.Chance,
                    min: row.MinCount,
                    max: row.MaxCount,
                    viaReference: 0
                });
            }
        }

        await this.followReferences(pending, drops);

        if (!drops.size)
        {
            return [];
        }

        const items = await this.itemsByEntry([...drops.keys()]);

        return items
            .map((row) => ({ ...row, drop: drops.get(row.entry) }))
            .sort((a, b) => b.Quality - a.Quality || b.ItemLevel - a.ItemLevel || a.name.localeCompare(b.name));
    }

    /**
     * The odds and ends worth listing once rather than per boss: currency and mounts.
     *
     * Which expansion something belongs to comes from the creatures that drop it —
     * `creature_template.exp` — rather than from a list written here, so Badge of Justice files
     * itself under TBC and the Emblems under Wrath without being told. An item dropped by
     * creatures from two expansions is filed under the newest of them, which is what stops
     * Emblem of Frost appearing under TBC because one Burning Crusade-flagged creature drops it.
     */
    async miscLoot(kind, expansion)
    {
        if (!this.pool)
        {
            return [];
        }

        const where = kind === 'mounts' ? 'it.class = 15 AND it.subclass = 5'
            : kind === 'materials' ? 'it.class = 7'
                : 'it.class = 10';

        /* Direct drops and drops behind a reference list, since both are how loot is stored. */
        const [rows] = await this.pool.query(`
            SELECT it.entry, MAX(ct.exp) AS exp
            FROM item_template it
            JOIN creature_loot_template clt ON clt.Item = it.entry
            JOIN creature_template ct ON ct.entry = clt.Entry
            WHERE ${where}
            GROUP BY it.entry

            UNION

            SELECT it.entry, MAX(ct.exp) AS exp
            FROM item_template it
            JOIN reference_loot_template rlt ON rlt.Item = it.entry
            JOIN creature_loot_template clt ON clt.Reference = rlt.Entry
            JOIN creature_template ct ON ct.entry = clt.Entry
            WHERE ${where}
            GROUP BY it.entry
        `);

        /* One row per item, kept at the highest expansion any of its droppers belongs to. */
        const newest = new Map();

        for (const row of rows)
        {
            newest.set(row.entry, Math.max(newest.get(row.entry) ?? -1, Number(row.exp)));
        }

        const wanted = [...newest].filter(([, exp]) => exp === Number(expansion)).map(([entry]) => entry);

        return wanted.length ? this.itemsByEntry(wanted) : [];
    }

    /**
     * What a chest holds, references followed — the gameobject half of lootForCreature.
     *
     * Takes several gameobjects at once because a single fight can leave more than one: every
     * Ulduar keeper drops a cache for the normal kill and a rare cache for the hard mode, and both
     * belong to the same boss on the same difficulty.
     */
    async lootForGameObjects(entries)
    {
        const ids = [...new Set((entries || []).map(Number).filter((n) => n > 0))];

        if (!this.pool || !ids.length)
        {
            return [];
        }

        const [templates] = await this.pool.query(
            `SELECT entry, name, Data1 AS lootId FROM gameobject_template
             WHERE entry IN (${ids.map(() => '?').join(',')})`, ids);

        const lootIds = [...new Set(templates.map((t) => t.lootId).filter(Boolean))];

        if (!lootIds.length)
        {
            return [];
        }

        const [rows] = await this.pool.query(
            `SELECT Entry, Item, Reference, Chance, MinCount, MaxCount
             FROM gameobject_loot_template WHERE Entry IN (${lootIds.map(() => '?').join(',')})`, lootIds);

        const drops = new Map();
        const pending = [];

        for (const row of rows)
        {
            if (row.Reference)
            {
                pending.push({ reference: row.Reference, depth: 0 });
            }
            else if (row.Item)
            {
                drops.set(row.Item, { item: row.Item, chance: row.Chance, min: row.MinCount, max: row.MaxCount, viaReference: 0 });
            }
        }

        await this.followReferences(pending, drops);

        if (!drops.size)
        {
            return [];
        }

        const items = await this.itemsByEntry([...drops.keys()]);

        return items
            .map((row) => ({ ...row, drop: drops.get(row.entry) }))
            .sort((a, b) => b.Quality - a.Quality || b.ItemLevel - a.ItemLevel || a.name.localeCompare(b.name));
    }

    /**
     * What drops an item: `lootForCreature` walked the other way.
     *
     * The equipped list wants a source per piece and the database can answer it, but only by
     * going up the loot tables rather than down them. Three things make that more than one query:
     *
     * - **A creature's loot is filed under its lootid**, which is not always its entry. What is
     *   found here is a loot list, and `creature_template` is what turns it back into creatures -
     *   several of which share one list, since that is how a boss's difficulty variants are stored.
     * - **References nest.** 4,710 reference rows point at another reference rather than at an item,
     *   so a single hop is not enough: Muradin's Spyglass sits in reference 12036, which no creature
     *   names directly. The walk goes up a level at a time until it reaches a loot list.
     * - **Not everything drops.** Shadowmourne has no loot row at all, being a quest reward, and
     *   plenty of high level gear is crafted or bought. Those come back absent rather than empty, so
     *   the caller can tell "nothing drops this" from "nothing was asked".
     *
     * Answers with map ids rather than instance names. Which instance a map is belongs to the
     * client's own tables, which this module has no business reading.
     */
    async dropsForItems(entries)
    {
        const ids = [...new Set((entries || []).map(Number).filter((n) => n > 0))];

        if (!this.pool || !ids.length)
        {
            return new Map();
        }

        /* Loot list id -> the asked-for items on it. Creature lists and object lists are numbered
           separately, so an id means nothing without knowing which of the two it came from. */
        const fromCreature = new Map();
        const fromObject = new Map();
        const owners = new Map();

        const add = (into, key, item) =>
        {
            if (!into.has(key)) { into.set(key, new Set()); }
            into.get(key).add(item);
        };

        const [direct] = await this.pool.query(
            `SELECT Entry, Item FROM creature_loot_template WHERE Item IN (${holes(ids)})`, ids);

        for (const row of direct) { add(fromCreature, Number(row.Entry), Number(row.Item)); }

        const [onObjects] = await this.pool.query(
            `SELECT Entry, Item FROM gameobject_loot_template WHERE Item IN (${holes(ids)})`, ids);

        for (const row of onObjects) { add(fromObject, Number(row.Entry), Number(row.Item)); }

        const [inReferences] = await this.pool.query(
            `SELECT Entry, Item FROM reference_loot_template WHERE Item IN (${holes(ids)})`, ids);

        for (const row of inReferences) { add(owners, Number(row.Entry), Number(row.Item)); }

        /*
         * Up a level at a time, carrying the items with each reference.
         *
         * The same depth cap the forward walk uses, and for the same reason: a loop between two
         * reference lists would otherwise go round for ever. A level only goes on the next round if
         * something was actually added to it, which is what makes the cap a backstop rather than the
         * thing doing the work.
         */
        let level = [...owners.keys()];

        for (let depth = 0; depth < 4 && level.length; depth++)
        {
            const [creatures] = await this.pool.query(
                `SELECT Entry, Reference FROM creature_loot_template
                 WHERE Reference IN (${holes(level)})`, level);

            for (const row of creatures)
            {
                for (const item of owners.get(Number(row.Reference)) || [])
                {
                    add(fromCreature, Number(row.Entry), item);
                }
            }

            const [objects] = await this.pool.query(
                `SELECT Entry, Reference FROM gameobject_loot_template
                 WHERE Reference IN (${holes(level)})`, level);

            for (const row of objects)
            {
                for (const item of owners.get(Number(row.Reference)) || [])
                {
                    add(fromObject, Number(row.Entry), item);
                }
            }

            const [nested] = await this.pool.query(
                `SELECT Entry, Reference FROM reference_loot_template
                 WHERE Reference IN (${holes(level)})`, level);

            const next = [];

            for (const row of nested)
            {
                const parent = Number(row.Entry);
                const grew = owners.has(parent) ? owners.get(parent).size : -1;

                for (const item of owners.get(Number(row.Reference)) || []) { add(owners, parent, item); }

                if (owners.get(parent).size !== grew) { next.push(parent); }
            }

            level = [...new Set(next)];
        }

        return this.nameDroppers(fromCreature, fromObject);
    }

    /**
     * Loot lists back to the things that carry them, named and collapsed.
     *
     * **One boss, not four.** Every difficulty of an encounter is its own `creature_template` row,
     * with its own loot list and a name the database suffixes - Gluth is 15932 and `Gluth (1)` is
     * 29417. Collapsing on the name would work by accident and break on the first boss whose
     * variants are named differently, so the collapse follows `difficulty_entry_1..3`, which is the
     * link the core itself uses and the same one the forward walk builds its chains from.
     *
     * That is also what makes the map come out right: only the base row is spawned. Asking a
     * heroic-only variant where it lives answers nothing, because nothing ever places it - the
     * difficulty system swaps the template in underneath the spawn of the normal one.
     */
    async nameDroppers(fromCreature, fromObject)
    {
        const out = new Map();

        const put = (item, source) =>
        {
            if (!out.has(item)) { out.set(item, []); }
            out.get(item).push(source);
        };

        const creatureLoot = [...fromCreature.keys()];

        if (creatureLoot.length)
        {
            const [rows] = await this.pool.query(
                `SELECT entry, name, lootid AS lootId FROM creature_template
                 WHERE lootid IN (${holes(creatureLoot)})`, creatureLoot);

            const bases = await this.baseCreatures(rows.map((row) => Number(row.entry)));
            const grouped = new Map();

            for (const row of rows)
            {
                const base = bases.get(Number(row.entry));
                const id = base ? base.entry : Number(row.entry);
                const name = String((base ? base.name : row.name) || '').trim();

                if (!name) { continue; }

                if (!grouped.has(id))
                {
                    grouped.set(id, { name, kind: 'creature', entries: [], items: new Set() });
                }

                grouped.get(id).entries.push(Number(row.entry));

                for (const item of fromCreature.get(Number(row.lootId)) || [])
                {
                    grouped.get(id).items.add(item);
                }
            }

            const spawns = await this.spawnMaps('creature', [...grouped.keys()]);

            for (const [id, one] of grouped)
            {
                if (!one.entries.includes(id)) { one.entries.push(id); }

                for (const item of one.items)
                {
                    put(item, {
                        name: one.name,
                        kind: 'creature',
                        entries: one.entries.sort((a, b) => a - b),
                        maps: [...(spawns.get(id) || [])].sort((a, b) => a - b)
                    });
                }
            }
        }

        const objectLoot = [...fromObject.keys()];

        if (objectLoot.length)
        {
            /* An object names its loot list in Data1, which is what `lootForGameObjects` reads the
               other way round. Objects have no difficulty chain, so there is nothing to collapse. */
            const [rows] = await this.pool.query(
                `SELECT entry, name, Data1 AS lootId FROM gameobject_template
                 WHERE Data1 IN (${holes(objectLoot)})`, objectLoot);

            const spawns = await this.spawnMaps('object', rows.map((row) => Number(row.entry)));

            /*
             * Two chests of the same name are one chest.
             *
             * An instance keeps a separate object per difficulty - the Gunship Armory is 201873 on
             * one map and 202178 on the other - and listing both reads as two places to go rather
             * than one. Objects have no difficulty chain to follow the way creatures do, so here the
             * name is what joins them.
             */
            const grouped = new Map();

            for (const row of rows)
            {
                const name = String(row.name || '').trim();

                if (!name) { continue; }

                if (!grouped.has(name))
                {
                    grouped.set(name, { entries: [], maps: new Set(), items: new Set() });
                }

                const one = grouped.get(name);

                one.entries.push(Number(row.entry));

                for (const map of spawns.get(Number(row.entry)) || []) { one.maps.add(map); }
                for (const item of fromObject.get(Number(row.lootId)) || []) { one.items.add(item); }
            }

            for (const [name, one] of grouped)
            {
                for (const item of one.items)
                {
                    put(item, {
                        name,
                        kind: 'object',
                        entries: one.entries.sort((a, b) => a - b),
                        maps: [...one.maps].sort((a, b) => a - b)
                    });
                }
            }
        }

        /*
         * A boss before a chest, then by name, so the line a source field is filled from is the one
         * a person would have written.
         *
         * And a count, because some answers are not sources. Flurry Axe comes back with 391
         * creatures behind it: it is on a world-drop reference list that half of Azeroth points at,
         * and "where does it drop" has no answer worth writing down.
         *
         * The cap is forty rather than a handful so that a whole raid still fits under it. Fragment of
         * Valanyr drops from twenty-one Ulduar bosses, and "Ulduar" is exactly the answer wanted -
         * which the caller can only reach if it is holding all twenty-one and can see they agree.
         */
        const WIDE = 40;
        const answered = new Map();

        for (const [item, list] of out)
        {
            list.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'creature' ? -1 : 1)
                || a.name.localeCompare(b.name));

            answered.set(item, {
                total: list.length,
                wide: list.length > WIDE,
                sources: list.slice(0, WIDE)
            });
        }

        return answered;
    }

    /**
     * The base row behind each of a set of creatures, for the ones that are a difficulty variant.
     *
     * A variant does not name its parent; the parent names its variants, in `difficulty_entry_1..3`.
     * So the question is asked the only way it can be: which rows point at any of these.
     */
    async baseCreatures(entries)
    {
        const ids = [...new Set(entries.map(Number).filter((n) => n > 0))];
        const out = new Map();

        if (!ids.length)
        {
            return out;
        }

        const [rows] = await this.pool.query(
            `SELECT entry, name, difficulty_entry_1, difficulty_entry_2, difficulty_entry_3
             FROM creature_template
             WHERE difficulty_entry_1 IN (${holes(ids)})
                OR difficulty_entry_2 IN (${holes(ids)})
                OR difficulty_entry_3 IN (${holes(ids)})`, [...ids, ...ids, ...ids]);

        const wanted = new Set(ids);

        for (const row of rows)
        {
            for (const key of [row.difficulty_entry_1, row.difficulty_entry_2, row.difficulty_entry_3])
            {
                if (wanted.has(Number(key)))
                {
                    out.set(Number(key), { entry: Number(row.entry), name: row.name });
                }
            }
        }

        return out;
    }

    /**
     * Which maps a set of creatures or objects is actually spawned on.
     *
     * The template says nothing about where a thing lives; the spawn table does. A creature with no
     * spawn at all - a summon, or something a script places - answers with nothing rather than with
     * a wrong map.
     */
    async spawnMaps(kind, entries)
    {
        const ids = [...new Set((entries || []).map(Number).filter((n) => n > 0))];
        const out = new Map();

        if (!ids.length)
        {
            return out;
        }

        const table = kind === 'creature' ? 'creature' : 'gameobject';

        const [rows] = await this.pool.query(
            `SELECT DISTINCT id, map FROM ${table} WHERE id IN (${holes(ids)})`, ids);

        for (const row of rows)
        {
            const id = Number(row.id);

            if (!out.has(id)) { out.set(id, new Set()); }

            out.get(id).add(Number(row.map));
        }

        return out;
    }

    /**
     * Walks a queue of reference lists into a drop map.
     *
     * References nest, so this follows them to a small depth rather than one level, and keeps a
     * seen set in case a list ever points at itself.
     */
    async followReferences(pending, drops)
    {
        const seen = new Set();

        while (pending.length)
        {
            const next = pending.shift();

            if (seen.has(next.reference) || next.depth > 3)
            {
                continue;
            }

            seen.add(next.reference);

            const [refRows] = await this.pool.query(
                `SELECT Entry, Item, Reference, Chance, MinCount, MaxCount
                 FROM reference_loot_template WHERE Entry = ?`, [next.reference]);

            for (const row of refRows)
            {
                if (row.Reference)
                {
                    pending.push({ reference: row.Reference, depth: next.depth + 1 });
                }
                else if (row.Item && !drops.has(row.Item))
                {
                    drops.set(row.Item, {
                        item: row.Item, chance: row.Chance, min: row.MinCount,
                        max: row.MaxCount, viaReference: next.reference
                    });
                }
            }
        }
    }

    disconnect()
    {
        if (this.pool)
        {
            this.pool.end().catch(() => {});
            this.pool = null;
        }
    }
}

module.exports = { WorldDb, RANK_TO_CLASSIFICATION, available: !!mysql };
