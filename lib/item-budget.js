'use strict';

/*
 * The item budget: what a WotLK item of a given item level is allowed to be worth, and how that
 * allowance is spent.
 *
 * None of this is invented. 3.3.5a ships the budget curve in `RandPropPoints.dbc` and the price
 * list in `ItemRandomSuffix.dbc`, and every constant below was measured against the 4,000-odd
 * epic items in a world database rather than fitted to a guess. The three parts:
 *
 *   1. `RandPropPoints.dbc` — one row per item level, fifteen columns: five slot factors for each
 *      of Epic, Superior and Good. Column 0 of a block is a chest, column 4 a thrown weapon.
 *
 *   2. `ItemRandomSuffix.dbc` — what each stat costs. A random-suffix item's stat value is
 *      `AllocationPct * RandPropPoints / 10000`, so a suffix granting a single stat states that
 *      stat's price directly: stamina is allocated 15000 where strength, agility, intellect,
 *      spirit, defense and haste are allocated 10000. Stamina is therefore bought 1.5 to the
 *      point and costs 2/3 of one. Attack power is allocated 20000 (half a point each), spell
 *      power 11700, mana per five 4000.
 *
 *   3. The multiplier between the two. A real fixed-stat epic carries about 1.87 times the points
 *      the random-suffix table allocates — median 1.887 across 665 unsocketed epics, holding to
 *      within a few percent from item level 200 to 277 and across every armor slot.
 *
 * Weapon damage is the one thing not derived from a budget: measured across every epic weapon in
 * the database, dps is a fixed function of item level and weapon kind, identical to the tenth for
 * every weapon that shares both. It is a lookup table, not an allowance, and it is not in any
 * 3.3.5a DBC — `ItemDamage*.dbc` arrived in Cataclysm — so the measured table is carried here.
 */

const { Dbc } = require('./wow/dbc');

/* RandPropPoints.dbc: ID, then Epic[5], Superior[5], Good[5]. */
const RAND_PROP = { ID: 0, EPIC: 1, SUPERIOR: 6, GOOD: 11, COUNT: 16 };

/** Quality -> where its block of five slot factors starts. Epic, superior, good only. */
const QUALITY_BLOCK = { 4: RAND_PROP.EPIC, 3: RAND_PROP.SUPERIOR, 2: RAND_PROP.GOOD };

/*
 * Budget points per point of stat, from the single-stat random suffixes.
 *
 * Everything allocated 10000 costs a whole point; the four exceptions are the interesting ones.
 * Spell healing is the old split-stat form kept for pre-3.0 items, worth half of spell power
 * because it only ever applied to heals.
 */
const STAT_COST = {
    str: 1, agi: 1, int: 1, spi: 1,
    sta: 10000 / 15000,
    defense: 1, dodge: 1, parry: 1, blockRating: 1, blockValue: 1,
    hit: 1, crit: 1, haste: 1, expertise: 1, resilience: 1, arp: 1,
    spellPen: 1, healthRegen: 1,
    ap: 10000 / 20000,
    rangedAp: 10000 / 20000,
    spellPower: 10000 / 11700,
    spellDamage: 10000 / 11700,
    spellHealing: 10000 / 11700 / 2,
    mp5: 10000 / 4000
};

/** item_template's stat_type numbers, for reading a real item in. */
const STAT_TYPES = {
    3: 'agi', 4: 'str', 5: 'int', 6: 'spi', 7: 'sta',
    12: 'defense', 13: 'dodge', 14: 'parry', 15: 'blockRating',
    31: 'hit', 32: 'crit', 35: 'resilience', 36: 'haste', 37: 'expertise',
    38: 'ap', 39: 'rangedAp', 41: 'spellHealing', 42: 'spellDamage', 43: 'mp5',
    44: 'arp', 45: 'spellPower', 46: 'healthRegen', 47: 'spellPen', 48: 'blockValue'
};

/*
 * InventoryType -> which of the five slot factors applies.
 *
 * Confirmed against the database rather than taken on trust: with the stat costs above applied,
 * every slot in a group lands on the same budget ratio — head, chest, legs and robes together at
 * 1.86, shoulders, waist, feet and hands at 1.87, and the small slots at 1.85.
 */
const SLOT_GROUP = {
    1: 0, 5: 0, 7: 0, 17: 0, 20: 0,                  // head, chest, legs, two-hand, robe
    3: 1, 6: 1, 8: 1, 10: 1, 12: 1,                  // shoulder, waist, feet, hands, trinket
    2: 2, 9: 2, 11: 2, 14: 2, 16: 2, 22: 2, 23: 2,   // neck, wrist, finger, shield, back, off hand, held
    13: 3, 21: 3,                                     // one hand, main hand
    15: 4, 25: 4, 26: 4, 28: 4                        // ranged, thrown, ranged right, relic
};

const SLOT_NAMES = {
    1: 'Head', 2: 'Neck', 3: 'Shoulder', 5: 'Chest', 6: 'Waist', 7: 'Legs', 8: 'Feet', 9: 'Wrist',
    10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One hand', 14: 'Shield', 15: 'Ranged',
    16: 'Back', 17: 'Two hand', 20: 'Robe', 21: 'Main hand', 22: 'Off hand', 23: 'Held in off-hand',
    25: 'Thrown', 26: 'Ranged', 28: 'Relic'
};

/**
 * How many random-suffix points a real fixed-stat item is worth.
 *
 * Fitted rather than chosen, by grid search over 1,779 clean epics — no set bonus, no on-use
 * effect, no resilience — minimizing the median absolute error against their real stat blocks.
 * The answer is 1.890 for epics and 1.730 for rares, and it is a sharp optimum: a step of 0.01
 * either way costs a third of a percent of accuracy.
 *
 * At the winning values half of all real items sit within 1.7% of what this predicts.
 *
 * Uncommon has no clean sample in the 187-284 band this was fitted over, so its multiplier is an
 * extrapolation of the epic-to-rare step and should be refitted if it ever matters.
 */
const QUALITY_MULTIPLIER = { 4: 1.890, 3: 1.730, 2: 1.60 };

/*
 * What a socket costs, from the same fit: 15 points, flat, whatever the item level.
 *
 * Flat is the interesting part. A socket does not cost a share of the budget, it costs a fixed
 * number of points, which is why sockets bite hardest on a small slot at a low item level — a
 * ring at ilvl 200 gives up a tenth of itself per socket and a chest at 277 barely a fortieth.
 */
const SOCKET_COST = 15;

/**
 * A socket bonus costs nothing.
 *
 * Sweeping it alongside the other two pinned it at zero, which fits what a socket bonus is: the
 * reward for matching colors, not a stat the item is charged for.
 */
const SOCKET_BONUS_COST = 0;

/*
 * What a point of weapon damage is worth in stats.
 *
 * A weapon is not budgeted differently from armor — it just spends part of its allowance on
 * damage. Measured against every clean epic weapon: a melee weapon carrying the full dps for its
 * item level lands on the same 1.89 as armor (one-hand 1.89, ranged 1.88, wand 1.89), and a
 * caster weapon, which carries about 60% of that damage, is paid for the difference in stats.
 *
 * The exchange rate is the striking part. Taking each caster weapon's stats above the armor
 * budget and dividing by the dps it gives up gives **6.18** for one-handers and **6.19** for
 * two-handers — the same number from two separate samples, which is what says this is the rule
 * rather than a curve fitted to one of them.
 *
 *     budget = RandPropPoints x multiplier + (melee dps for the slot - actual dps) x 6.19
 *
 * That reproduces the lot: a caster one-hander at ilvl 264 works out at 6.4 times its slot's
 * points against 6.5 measured, and a caster two-hander at 3.7 against 3.77.
 */
const DPS_TO_POINTS = 6.19;

/** Which dps curve a weapon follows, from its slot and whether it is a caster weapon. */
function weaponKind(inventoryType, { caster = false, wand = false, thrown = false } = {})
{
    if (wand)
    {
        return 'wand';
    }

    if (thrown)
    {
        return 'thrown';
    }

    if (Number(inventoryType) === 15 || Number(inventoryType) === 26)
    {
        return 'ranged';
    }

    if (Number(inventoryType) === 17)
    {
        return caster ? 'twoHandCaster' : 'twoHand';
    }

    return caster ? 'oneHandCaster' : 'oneHand';
}

/*
 * Weapon dps by item level, measured from every epic weapon in item_template.
 *
 * Within a kind and item level every weapon agrees to within a tenth, which is integer rounding
 * of the damage range and nothing more — so these are the real numbers, not averages hiding a
 * spread. Levels the database has no clean sample for are filled by interpolation.
 */
const WEAPON_DPS = {
    oneHand: { 200: 143.4, 213: 156.5, 219: 163.2, 226: 171.2, 232: 178.8, 239: 188.1, 245: 196.6, 251: 205.6, 258: 216.6, 264: 226.6, 271: 239.2, 277: 250.6, 284: 264.7 },
    twoHand: { 200: 186.6, 213: 203.7, 219: 212.3, 226: 222.9, 232: 232.6, 239: 244.6, 245: 255.6, 251: 267.3, 258: 281.6, 264: 294.7, 271: 311.0, 277: 325.7, 284: 344.2 },
    oneHandCaster: { 200: 82.8, 213: 90.6, 219: 94.2, 226: 98.9, 232: 103.3, 239: 108.9, 245: 113.1, 251: 118.9, 258: 125.0, 264: 131.1, 271: 143.6, 277: 154.7, 284: 168.9 },
    twoHandCaster: { 213: 137.4, 219: 143.2, 232: 156.7, 239: 165.2, 245: 172.4, 251: 180.4, 258: 190.2, 271: 219.2, 277: 230.0, 284: 248.3 },
    ranged: { 200: 129.6, 213: 141.6, 219: 147.4, 226: 176.2, 232: 187.2, 239: 200.5, 245: 212.3, 251: 222.8, 258: 240.7, 264: 253.2, 271: 272.7, 277: 288.8, 284: 309.0 },
    thrown: { 200: 186.6, 213: 203.4, 232: 232.8, 245: 255.6, 251: 266.9, 264: 294.7 },
    wand: { 200: 263.6, 213: 287.8, 219: 300.0, 232: 328.6, 245: 361.4, 251: 377.6, 264: 416.4, 277: 460.3 }
};

/*
 * Where each item level comes from in the game, which is what makes "ilvl 245" mean something.
 *
 * The raid entries were confirmed by walking `creature_loot_template` through
 * `reference_loot_template` for each instance's own bosses — Ulduar's drops really are 219, 226
 * and 232, the Trial's 232, Icecrown's 251 upwards — rather than by memory.
 */
const TIERS = [
    { ilvl: 187, tier: '', source: 'Heroic dungeon blues, Naxxramas trash' },
    { ilvl: 200, tier: 'T7', source: 'Naxxramas 10, Obsidian Sanctum 10, Eye of Eternity 10, badge gear' },
    { ilvl: 213, tier: 'T7.5', source: 'Naxxramas 25, Obsidian Sanctum 25, Eye of Eternity 25' },
    { ilvl: 219, tier: 'T8', source: 'Ulduar 10' },
    { ilvl: 226, tier: 'T8.5', source: 'Ulduar 25, Ulduar 10 hard modes, Kel\'Thuzad 25' },
    { ilvl: 232, tier: 'T8.5+', source: 'Ulduar 25 hard modes, Trial of the Crusader 10' },
    { ilvl: 239, tier: '', source: 'Trial of the Crusader 10 heroic, Onyxia 10' },
    { ilvl: 245, tier: 'T9', source: 'Trial of the Crusader 25, Onyxia 25' },
    { ilvl: 251, tier: 'T9.5', source: 'Trial of the Crusader 25 heroic, Icecrown Citadel 10' },
    { ilvl: 258, tier: 'T10', source: 'Icecrown Citadel 10, Ruby Sanctum 10' },
    { ilvl: 264, tier: 'T10.5', source: 'Icecrown Citadel 25, Icecrown 10 heroic' },
    { ilvl: 271, tier: '', source: 'Icecrown 10 heroic, Ruby Sanctum 25' },
    { ilvl: 277, tier: 'T10.5+', source: 'Icecrown Citadel 25 heroic' },
    { ilvl: 284, tier: '', source: 'Ruby Sanctum 25 heroic, Shadowmourne and the legendary tier' }
];

/*
 * How real gear of each role splits its budget, averaged over the epics in the database.
 *
 * These are shares of the whole budget, so they sum to roughly one, and they are what makes a
 * generated item look like a real one: a strength plate piece really does put a third of itself
 * into strength and a quarter into stamina, and a healer piece really does spend a quarter on
 * spell power before anything else.
 */
const PROFILES = {
    'melee-str': { name: 'Melee - strength', shares: { str: 0.333, sta: 0.261, crit: 0.185, hit: 0.071, haste: 0.061, arp: 0.050, expertise: 0.039 } },
    'melee-agi': { name: 'Melee - agility', shares: { agi: 0.256, sta: 0.176, ap: 0.176, crit: 0.140, hit: 0.061, haste: 0.059, arp: 0.056, int: 0.057 } },
    'tank-plate': { name: 'Tank - plate', shares: { sta: 0.278, str: 0.261, defense: 0.148, dodge: 0.137, parry: 0.092, hit: 0.033, expertise: 0.033 } },
    'caster-dps': { name: 'Caster - damage', shares: { spellPower: 0.269, int: 0.222, crit: 0.152, sta: 0.152, haste: 0.133, hit: 0.073 } },
    'healer': { name: 'Healer', shares: { spellPower: 0.265, int: 0.216, sta: 0.149, spi: 0.116, crit: 0.091, mp5: 0.082, haste: 0.070 } }
};

/** The label each stat prints with on a tooltip, so a generated item can be shown as one. */
const STAT_LABELS = {
    str: 'Strength', agi: 'Agility', int: 'Intellect', spi: 'Spirit', sta: 'Stamina',
    defense: 'Defense Rating', dodge: 'Dodge Rating', parry: 'Parry Rating',
    blockRating: 'Block Rating', blockValue: 'Block Value',
    hit: 'Hit Rating', crit: 'Critical Strike Rating', haste: 'Haste Rating',
    expertise: 'Expertise Rating', resilience: 'Resilience Rating', arp: 'Armor Penetration Rating',
    ap: 'Attack Power', rangedAp: 'Ranged Attack Power', spellPower: 'Spell Power',
    spellDamage: 'Spell Damage', spellHealing: 'Healing', mp5: 'Mana per 5 sec',
    spellPen: 'Spell Penetration', healthRegen: 'Health per 5 sec'
};

/** Cost of a stat block in budget points. Unknown stats are charged a whole point each. */
function costOf(stats)
{
    let total = 0;

    for (const [name, value] of Object.entries(stats || {}))
    {
        total += (STAT_COST[name] === undefined ? 1 : STAT_COST[name]) * (Number(value) || 0);
    }

    return total;
}

/** Linear interpolation through a sparse table keyed by item level. */
function interpolate(table, ilvl)
{
    const levels = Object.keys(table).map(Number).sort((a, b) => a - b);

    if (!levels.length)
    {
        return null;
    }

    if (table[ilvl] !== undefined)
    {
        return table[ilvl];
    }

    if (ilvl <= levels[0])
    {
        return table[levels[0]];
    }

    if (ilvl >= levels[levels.length - 1])
    {
        // Past the end, carry the last slope rather than flat-lining a made-up tier.
        const last = levels[levels.length - 1];
        const prev = levels[levels.length - 2];
        const slope = (table[last] - table[prev]) / (last - prev);

        return table[last] + slope * (ilvl - last);
    }

    let lower = levels[0];

    for (const level of levels)
    {
        if (level <= ilvl)
        {
            lower = level;
        }
    }

    const upper = levels.find((l) => l > ilvl);
    const span = upper - lower;

    return table[lower] + (table[upper] - table[lower]) * ((ilvl - lower) / span);
}

/*
 * Puts the chosen secondaries in place of the profile's own.
 *
 * The primaries and stamina are what make a piece a warrior's or a priest's, so they are left
 * alone; the secondaries are the part worth choosing. Whatever share the profile spent on its
 * secondaries is kept and divided between the ones asked for, so the piece stays the right size
 * and only its flavor changes.
 */
function chooseSecondaries(shares, chosen)
{
    const list = (chosen || []).filter((name) => STAT_COST[name] !== undefined);

    if (!list.length)
    {
        return shares;
    }

    const PRIMARY = ['str', 'agi', 'int', 'spi', 'sta', 'ap', 'rangedAp', 'spellPower'];
    const kept = {};
    let secondary = 0;

    for (const [name, share] of Object.entries(shares))
    {
        if (PRIMARY.includes(name))
        {
            kept[name] = share;
        }
        else
        {
            secondary += share;
        }
    }

    const each = secondary / list.length;

    for (const name of list)
    {
        kept[name] = (kept[name] || 0) + each;
    }

    return kept;
}

class ItemBudget
{
    constructor(assets)
    {
        this.assets = assets;
        this.cache = null;
    }

    /** Drops the parsed table so the next read picks up a newly configured client. */
    reset()
    {
        this.cache = null;
    }

    /** RandPropPoints, parsed once — 300 rows of sixteen fields. */
    load()
    {
        if (this.cache)
        {
            return this.cache;
        }

        const raw = this.assets.readEntry('DBFilesClient\\RandPropPoints.dbc');

        if (!raw)
        {
            throw new Error('RandPropPoints.dbc is not in the client archives');
        }

        const table = new Dbc(raw, 'RandPropPoints.dbc');

        if (table.fieldCount !== RAND_PROP.COUNT)
        {
            throw new Error(
                `RandPropPoints.dbc: expected ${RAND_PROP.COUNT} fields, client has ${table.fieldCount} - layout changed`);
        }

        const rows = new Map();

        for (let row = 0; row < table.recordCount; row++)
        {
            const values = [];

            for (let field = 1; field < RAND_PROP.COUNT; field++)
            {
                values.push(table.int(row, field));
            }

            rows.set(table.int(row, RAND_PROP.ID), values);
        }

        this.cache = { rows, levels: [...rows.keys()].sort((a, b) => a - b) };

        return this.cache;
    }

    /** The random-suffix allocation for one item level, quality and slot. */
    points(ilvl, quality, inventoryType)
    {
        const { rows } = this.load();
        const row = rows.get(Number(ilvl));
        const block = QUALITY_BLOCK[Number(quality)];
        const group = SLOT_GROUP[Number(inventoryType)];

        if (!row || block === undefined || group === undefined)
        {
            return null;
        }

        // The stored row drops the ID, so every block index shifts down by one.
        return row[block - 1 + group];
    }

    /**
     * What an item of this description is worth, in stat points.
     *
     * Sockets are paid for out of the same allowance, which is why a three-socket item looks
     * thinner than a plain one of the same item level — it is, by exactly three gems.
     */
    budget({ ilvl, quality = 4, inventoryType, sockets = 0, socketBonus = false, weapon = null })
    {
        const points = this.points(ilvl, quality, inventoryType);

        if (points === null)
        {
            return null;
        }

        const multiplier = QUALITY_MULTIPLIER[Number(quality)] || QUALITY_MULTIPLIER[4];

        /*
         * A weapon's damage comes out of the same allowance. Carrying less than the full dps for
         * the slot buys stats back at a fixed rate, which is how a caster weapon ends up with
         * several times the stats of the melee weapon beside it.
         */
        const damage = this.damagePoints(ilvl, inventoryType, weapon);
        const gross = points * multiplier + damage;
        const spent = (Number(sockets) || 0) * SOCKET_COST + (socketBonus ? SOCKET_BONUS_COST : 0);

        return {
            points,
            multiplier,
            damagePoints: Math.round(damage),
            gross: Math.round(gross),
            sockets: Number(sockets) || 0,
            socketCost: spent,
            budget: Math.round(gross - spent),
            slotGroup: SLOT_GROUP[Number(inventoryType)],
            slotFactor: this.slotFactor(ilvl, quality, inventoryType)
        };
    }

    /**
     * The stats a weapon earns by carrying less damage than its slot allows.
     *
     * Zero for armor, and zero for a melee weapon at full dps. A weapon carrying more damage than
     * its curve goes negative, which is right: it has spent stats on damage.
     */
    damagePoints(ilvl, inventoryType, weapon)
    {
        if (!weapon)
        {
            return 0;
        }

        const kind = weapon.kind || weaponKind(inventoryType, weapon);
        const meleeKind = kind === 'oneHandCaster' ? 'oneHand'
            : kind === 'twoHandCaster' ? 'twoHand' : kind;

        const full = this.weaponDps(meleeKind, ilvl);
        const carried = Number(weapon.dps) || this.weaponDps(kind, ilvl);

        if (full === null || carried === null)
        {
            return 0;
        }

        return (full - carried) * DPS_TO_POINTS;
    }

    /** A slot's share of a chest, which is what the five columns really encode. */
    slotFactor(ilvl, quality, inventoryType)
    {
        const mine = this.points(ilvl, quality, inventoryType);
        const chest = this.points(ilvl, quality, 5);

        return mine && chest ? Math.round((mine / chest) * 1000) / 1000 : null;
    }

    /**
     * Spends a budget on a role's stat spread.
     *
     * The shares are what real gear of that role averages, so what comes out reads like a drop
     * rather than an even split. Rounding is settled at the end against the most expensive stat,
     * so the finished block costs what it was given rather than a point or two either side.
     */
    generate({
        ilvl, quality = 4, inventoryType, role = 'melee-str', sockets = 0, socketBonus = false,
        weapon = null, secondaries = null
    })
    {
        const budget = this.budget({ ilvl, quality, inventoryType, sockets, socketBonus, weapon });

        if (!budget)
        {
            return null;
        }

        const profile = PROFILES[role] || PROFILES['melee-str'];
        const shares = chooseSecondaries(profile.shares, secondaries);
        const total = Object.values(shares).reduce((a, b) => a + b, 0);
        const stats = {};

        for (const [name, share] of Object.entries(shares))
        {
            const points = budget.budget * (share / total);
            const cost = STAT_COST[name] === undefined ? 1 : STAT_COST[name];

            stats[name] = Math.max(1, Math.round(points / cost));
        }

        /* Settle the rounding on the largest stat, so the block costs its budget exactly. */
        const drift = budget.budget - costOf(stats);
        const largest = Object.entries(stats).sort((a, b) => b[1] - a[1])[0];

        if (largest && Math.abs(drift) >= 1)
        {
            const cost = STAT_COST[largest[0]] === undefined ? 1 : STAT_COST[largest[0]];
            stats[largest[0]] = Math.max(1, stats[largest[0]] + Math.round(drift / cost));
        }

        const kind = weapon ? (weapon.kind || weaponKind(inventoryType, weapon)) : null;

        return {
            ilvl: Number(ilvl),
            quality: Number(quality),
            inventoryType: Number(inventoryType),
            slot: SLOT_NAMES[Number(inventoryType)] || String(inventoryType),
            role,
            roleName: profile.name,
            weaponKind: kind,
            weapon: kind ? this.weaponDamage(kind, ilvl, Number(weapon.speed) || 2.6) : null,
            sockets: budget.sockets,
            socketBonus: !!socketBonus,
            ...budget,
            spent: Math.round(costOf(stats)),
            stats,
            lines: Object.entries(stats).map(([name, value]) => ({
                stat: name, label: STAT_LABELS[name] || name, value
            }))
        };
    }

    /**
     * The reverse: given a stat block, what item level is it really?
     *
     * This is the wizard's honesty check. A hand-typed item level is a claim; the budget the
     * stats actually cost is the fact, and the two disagree more often than not.
     */
    identify({ stats, quality = 4, inventoryType, sockets = 0, socketBonus = false, anyLevel = false, weapon = null })
    {
        const { levels } = this.load();
        const cost = costOf(stats) + (Number(sockets) || 0) * SOCKET_COST + (socketBonus ? SOCKET_BONUS_COST : 0);

        /*
         * Snap to the item levels the game actually drops at, not to all 300 rows.
         *
         * The curve rises under 1% per item level, so a stat block that is a single point heavy
         * reads as the next level up and one that is a point light reads as the one below. Against
         * the raw table that makes the answer look wrong when the budget is within a percent of
         * exact; against the fourteen levels content is itemised at, the same answer is right.
         */
        const candidates = anyLevel ? levels : TIERS.map((t) => t.ilvl);

        let best = null;

        for (const ilvl of candidates)
        {
            const points = this.points(ilvl, quality, inventoryType);

            if (points === null)
            {
                continue;
            }

            /*
             * A weapon's allowance rises as its damage falls, and both depend on the item level
             * being tested — a caster staff is mostly paid in stats, so pricing it against the
             * armor budget alone puts it several tiers above where it belongs.
             */
            const gross = points * (QUALITY_MULTIPLIER[Number(quality)] || QUALITY_MULTIPLIER[4])
                + this.damagePoints(ilvl, inventoryType, weapon);

            const distance = Math.abs(gross - cost);

            if (!best || distance < best.distance)
            {
                best = { ilvl, gross: Math.round(gross), distance };
            }
        }

        if (!best)
        {
            return null;
        }

        return {
            cost: Math.round(cost),
            ilvl: best.ilvl,
            budgetAtLevel: best.gross,
            offBy: Math.round(((cost - best.gross) / best.gross) * 1000) / 10,
            tier: this.tierFor(best.ilvl)
        };
    }

    /**
     * Which role a stat block reads as, by the same rules the profiles were grouped under.
     *
     * Order matters: a plate tank piece carries strength as well as defense, so the defensive
     * ratings have to be looked at before the primary stat, or every tank piece files as melee.
     */
    roleOf(stats)
    {
        const has = (name) => (Number(stats[name]) || 0) > 0;
        const spell = has('spellPower') || has('spellDamage') || has('spellHealing');

        if (has('defense') || has('parry') || has('blockValue') || has('blockRating'))
        {
            return 'tank-plate';
        }

        if (spell)
        {
            return has('spi') || has('mp5') ? 'healer' : 'caster-dps';
        }

        if (has('str'))
        {
            return 'melee-str';
        }

        if (has('agi') || has('ap'))
        {
            return 'melee-agi';
        }

        return has('int') ? 'caster-dps' : 'melee-str';
    }

    /** The content an item level belongs to, or the nearest one below it. */
    tierFor(ilvl)
    {
        let found = null;

        for (const entry of TIERS)
        {
            if (entry.ilvl <= ilvl)
            {
                found = entry;
            }
        }

        return found;
    }

    /** Weapon dps for an item level and kind, interpolated between the measured levels. */
    weaponDps(kind, ilvl)
    {
        const table = WEAPON_DPS[kind];

        if (!table)
        {
            return null;
        }

        const dps = interpolate(table, Number(ilvl));

        return dps === null ? null : Math.round(dps * 10) / 10;
    }

    /**
     * A weapon's damage range from its dps and speed.
     *
     * The game stores min and max damage, not dps — the tooltip's dps line is derived. A 30%
     * spread either side of the mean is what real WotLK weapons use.
     */
    weaponDamage(kind, ilvl, speed, spread = 0.3)
    {
        const dps = this.weaponDps(kind, ilvl);

        if (dps === null || !speed)
        {
            return null;
        }

        const mean = dps * speed;

        return {
            dps,
            speed,
            min: Math.round(mean * (1 - spread)),
            max: Math.round(mean * (1 + spread))
        };
    }

    /** Everything an editor needs to draw the pickers, in one call. */
    describe()
    {
        const { levels } = this.load();

        return {
            levels,
            tiers: TIERS,
            roles: Object.entries(PROFILES).map(([id, p]) => ({ id, name: p.name, shares: p.shares })),
            slots: Object.entries(SLOT_NAMES).map(([type, name]) => ({
                inventoryType: Number(type), name, group: SLOT_GROUP[Number(type)]
            })),
            statCosts: STAT_COST,
            statLabels: STAT_LABELS,
            socketCost: SOCKET_COST,
            qualityMultiplier: QUALITY_MULTIPLIER,
            weaponKinds: Object.keys(WEAPON_DPS)
        };
    }
}

module.exports = {
    ItemBudget, weaponKind, DPS_TO_POINTS, STAT_COST, STAT_TYPES, STAT_LABELS, SLOT_GROUP, SLOT_NAMES, PROFILES, TIERS,
    WEAPON_DPS, QUALITY_MULTIPLIER, SOCKET_COST, SOCKET_BONUS_COST, costOf
};
