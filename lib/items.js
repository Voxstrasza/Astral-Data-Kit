'use strict';

/*
 * Turning a database item into the thing the editor draws.
 *
 * Two halves. The icon comes from the client: `item_template.displayid` is an index into
 * `ItemDisplayInfo.dbc`, whose sixth field is the inventory icon's texture name — the same kind
 * of name the icon picker and `iconUrl()` already take, so a real item arrives wearing its real
 * icon rather than the question mark.
 *
 * The rest is a translation. The database describes an item in server terms — `class` 4
 * `subclass` 3 `InventoryType` 5 — and the editor in tooltip terms: an armour slot, a type, a
 * quality, a binding. Everything below is that mapping, written out rather than guessed at,
 * because the two vocabularies genuinely do not line up.
 */

const { Dbc } = require('./wow/dbc');

/*
 * ItemDisplayInfo.dbc is 25 fields wide and almost entirely model and texture names. Field 5 is
 * InventoryIcon[0], which is the icon the game shows in a bag slot — verified by reading a few
 * rows out and finding INV_Robe_02, INV_Boots_01, INV_Jewelry_Ring_03 in that column.
 */
const DISPLAY = { ID: 0, InventoryIcon: 5, COUNT: 25 };

/*
 * SpellItemEnchantment.dbc, for socket bonuses.
 *
 * item_template stores a socket bonus as an enchantment id — 3357 rather than "+6 Strength" — and
 * printing the number is what the tooltip did at first. The name is a localised column, so it sits
 * at field 14 with the enUS slot first.
 */
const ENCHANT = { ID: 0, Name: 14, COUNT: 38 };

/** item_template.stat_type -> the editor's stat vocabulary, for the five it shows by name. */
const PRIMARY_STATS = { 4: 'Strength', 3: 'Agility', 7: 'Stamina', 5: 'Intellect', 6: 'Spirit' };

/*
 * Everything else is a rating, and the editor writes those as green Equip: lines rather than as
 * blue stat rows — which is what the game does too.
 *
 * These strings are the editor's own presets, character for character. They have to be: the row's
 * dropdown matches on the whole sentence, so a near-miss like "Improves your block rating" against
 * "Increases your block rating" leaves the select showing the wrong entry.
 */
const RATING_LINES = {
    12: 'Increases defense rating by {N}.',
    13: 'Increases your dodge rating by {N}.',
    14: 'Increases your parry rating by {N}.',
    15: 'Improves your block rating by {N}.',
    31: 'Improves hit rating by {N}.',
    32: 'Improves critical strike rating by {N}.',
    35: 'Improves your resilience rating by {N}.',
    36: 'Improves haste rating by {N}.',
    37: 'Increases your expertise rating by {N}.',
    38: 'Increases attack power by {N}.',
    43: 'Restores {N} mana per 5 sec.',
    44: 'Increases your armor penetration rating by {N}.',
    45: 'Increases spell power by {N}.',
    46: 'Restores {N} health per 5 sec.',
    48: 'Increases your shield block value by {N}.'
};

/*
 * The stats with no preset behind them, written as their own sentence.
 *
 * Ranged attack power, spell penetration and the two pre-3.0 split spell stats appear on real
 * items but not in the editor's preset list — 3.3.5a itemisation barely uses them — so they come
 * through as free text rather than being forced onto a preset that says something else.
 */
const RATING_CUSTOM = {
    39: 'Increases ranged attack power by {N}.',
    41: 'Increases healing done by up to {N} and damage done by up to {N} for all magical spells and effects.',
    42: 'Increases damage and healing done by magical spells and effects by up to {N}.',
    47: 'Increases your spell penetration by {N}.'
};

/*
 * A mount's tooltip is not flavour text.
 *
 * item_template keeps "Teaches you how to summon this mount." in `description`, which is the
 * field ordinary items use for the yellow quote at the bottom. On a mount it is the green Use
 * line at the top instead, so it is moved there and the flavour left empty.
 */
const MOUNT_CLASS = { class: 15, subclass: 5 };
const MOUNT_USE = 'Teaches you how to summon this mount.  This is a very fast mount.';

/** item_template.class 10 is currency — emblems, badges, marks, seals. */
const CURRENCY_CLASS = 10;

/*
 * Class 7 is trade goods: the frozen orbs, runed orbs, primordial saronite and eternals that every
 * boss of a tier drops alongside its real loot. Like currency, they say nothing about the boss
 * they came from, so they are listed once under Misc rather than down every roster.
 */
const MATERIAL_CLASS = 7;

/** item_template.InventoryType -> the editor's slot label. */
const SLOTS = {
    1: 'Head', 2: 'Neck', 3: 'Shoulder', 4: 'Shirt', 5: 'Chest', 6: 'Waist', 7: 'Legs',
    8: 'Feet', 9: 'Wrist', 10: 'Hands', 11: 'Finger', 12: 'Trinket', 13: 'One-Hand',
    14: 'Off Hand', 15: 'Ranged', 16: 'Back', 17: 'Two-Hand', 19: 'Tabard', 20: 'Chest',
    21: 'Main Hand', 22: 'Off Hand', 23: 'Held In Off-hand', 24: 'Ammo', 25: 'Thrown',
    26: 'Ranged', 28: 'Relic'
};

/** Armour: class 4, subclass -> what the tooltip's right column says. */
const ARMOR_TYPES = { 0: 'Miscellaneous', 1: 'Cloth', 2: 'Leather', 3: 'Mail', 4: 'Plate', 6: 'Shield' };

/** Weapons: class 2, subclass -> the weapon type line. */
const WEAPON_TYPES = {
    0: 'Axe', 1: 'Axe', 2: 'Bow', 3: 'Gun', 4: 'Mace', 5: 'Mace', 6: 'Polearm', 7: 'Sword',
    8: 'Sword', 10: 'Staff', 13: 'Fist Weapon', 14: 'Miscellaneous', 15: 'Dagger',
    16: 'Thrown', 18: 'Crossbow', 19: 'Wand', 20: 'Fishing Pole'
};

/** item_template.bonding -> the editor's binding values. */
const BONDING = { 0: 'none', 1: 'bop', 2: 'boe', 3: 'bou', 4: 'quest', 5: 'boe', 6: 'boe' };

/** socketColor is a mask: 1 meta, 2 red, 4 yellow, 8 blue. */
const SOCKET_COLORS = { 1: 'meta', 2: 'red', 4: 'yellow', 8: 'blue' };

const RESISTANCES = [
    ['holy_res', 'Holy'], ['fire_res', 'Fire'], ['nature_res', 'Nature'],
    ['frost_res', 'Frost'], ['shadow_res', 'Shadow'], ['arcane_res', 'Arcane']
];

/** ITEM_FLAG_HEROIC is bit 3 — the green "Heroic" line under the name. */
const FLAG_HEROIC = 0x8;

class ItemDisplay
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
        this.enchants = null;
    }

    /**
     * displayId -> icon name, parsed once.
     *
     * 58,000 rows of which one field is kept, so this is a few megabytes at most and needs none
     * of the on-disk caching the icon index uses.
     */
    load()
    {
        if (this.cache)
        {
            return this.cache;
        }

        const raw = this.assets.readEntry('DBFilesClient\\ItemDisplayInfo.dbc');

        if (!raw)
        {
            throw new Error('ItemDisplayInfo.dbc is not in the client archives');
        }

        const table = new Dbc(raw, 'ItemDisplayInfo.dbc');

        if (table.fieldCount !== DISPLAY.COUNT)
        {
            throw new Error(
                `ItemDisplayInfo.dbc: expected ${DISPLAY.COUNT} fields, client has ${table.fieldCount} — layout changed`);
        }

        const icons = new Map();

        for (let row = 0; row < table.recordCount; row++)
        {
            const icon = table.string(row, DISPLAY.InventoryIcon);

            if (icon)
            {
                icons.set(table.int(row, DISPLAY.ID), icon.toLowerCase());
            }
        }

        this.cache = icons;

        return icons;
    }

    /**
     * Socket bonus text for an enchantment id: 3357 -> "+6 Strength".
     *
     * Parsed on first use and kept, like the icons. 2,656 rows of one string each.
     */
    enchantName(id)
    {
        if (!Number(id))
        {
            return '';
        }

        try
        {
            if (!this.enchants)
            {
                const raw = this.assets.readEntry('DBFilesClient\SpellItemEnchantment.dbc');
                const table = new Dbc(raw, 'SpellItemEnchantment.dbc');

                if (table.fieldCount !== ENCHANT.COUNT)
                {
                    throw new Error(
                        `SpellItemEnchantment.dbc: expected ${ENCHANT.COUNT} fields, client has ${table.fieldCount}`);
                }

                this.enchants = new Map();

                for (let row = 0; row < table.recordCount; row++)
                {
                    this.enchants.set(table.int(row, ENCHANT.ID), table.string(row, ENCHANT.Name));
                }
            }

            return this.enchants.get(Number(id)) || '';
        }
        catch
        {
            /* No client, or a layout that moved: better a blank line than an id on the tooltip. */
            return '';
        }
    }

    /** The icon name for a display id, or empty when the client has no row for it. */
    icon(displayId)
    {
        try
        {
            return this.load().get(Number(displayId)) || '';
        }
        catch
        {
            // No client configured: the editor falls back to its own placeholder.
            return '';
        }
    }
}

/** Splits socketColor_1..3 into the editor's socket list. */
function socketsOf(row)
{
    const sockets = [];

    for (const field of ['socketColor_1', 'socketColor_2', 'socketColor_3'])
    {
        const colour = SOCKET_COLORS[row[field]];

        if (colour)
        {
            sockets.push(colour);
        }
    }

    return sockets;
}

/**
 * A database row as the editor's item fields.
 *
 * Only the fields the item window owns are returned, so applying one cannot disturb the spell or
 * target frame sitting in the next tab.
 */
function toEditor(row, icon, socketBonusText)
{
    const stats = [];
    const effects = [];

    for (let i = 1; i <= 10; i++)
    {
        const type = row[`stat_type${i}`];
        const value = row[`stat_value${i}`];

        if (!value)
        {
            continue;
        }

        if (PRIMARY_STATS[type])
        {
            stats.push({ type: PRIMARY_STATS[type], value });
        }
        else if (RATING_LINES[type])
        {
            effects.push({ kind: 'Equip', preset: RATING_LINES[type], value, text: '' });
        }
        else if (RATING_CUSTOM[type])
        {
            effects.push({
                kind: 'Equip',
                preset: 'custom',
                value,
                text: RATING_CUSTOM[type].replace(/\{N\}/g, value)
            });
        }
    }

    const isMount = row.class === MOUNT_CLASS.class && row.subclass === MOUNT_CLASS.subclass;

    if (isMount)
    {
        effects.push({ kind: 'Use', preset: 'custom', value: 0, text: MOUNT_USE });
    }

    const resistances = [];

    for (const [field, name] of RESISTANCES)
    {
        if (row[field])
        {
            resistances.push({ type: name, value: row[field] });
        }
    }

    const weapon = row.class === 2 && row.delay > 0;
    const sell = Number(row.SellPrice) || 0;

    return {
        entry: row.entry,
        icon: icon || '',
        name: row.name,
        quality: row.Quality,
        heroic: !!(row.Flags & FLAG_HEROIC),
        binding: BONDING[row.bonding] || 'none',

        slot: SLOTS[row.InventoryType] || '',
        itemType: row.class === 2 ? (WEAPON_TYPES[row.subclass] || '')
            : row.class === 4 ? (ARMOR_TYPES[row.subclass] || '') : '',
        hasWeapon: weapon,
        dmgMin: weapon ? row.dmg_min1 : 0,
        dmgMax: weapon ? row.dmg_max1 : 0,
        speed: weapon ? row.delay / 1000 : 0,

        armor: row.armor || 0,
        block: row.block || 0,
        durability: row.MaxDurability || 0,
        reqLevel: row.RequiredLevel || 0,
        itemLevel: row.ItemLevel || 0,

        stats,
        resistances,
        effects,
        sockets: socketsOf(row),
        socketBonus: socketBonusText || '',

        flavor: isMount ? '' : (row.description || ''),
        sellGold: Math.floor(sell / 10000),
        sellSilver: Math.floor((sell % 10000) / 100),
        sellCopper: sell % 100
    };
}

/** The short form the finder's result rows show. */
/** Which bucket an item belongs in: currency and mounts are listed apart from boss loot. */
function categoryOf(row)
{
    if (row.class === CURRENCY_CLASS)
    {
        return 'currency';
    }

    if (row.class === MATERIAL_CLASS)
    {
        return 'material';
    }

    return row.class === MOUNT_CLASS.class && row.subclass === MOUNT_CLASS.subclass ? 'mount' : null;
}

function toResult(row, icon)
{
    return {
        category: categoryOf(row),
        entry: row.entry,
        name: row.name,
        icon: icon || '',
        quality: row.Quality,
        itemLevel: row.ItemLevel,
        slot: SLOTS[row.InventoryType] || '',
        type: row.class === 2 ? (WEAPON_TYPES[row.subclass] || '')
            : row.class === 4 ? (ARMOR_TYPES[row.subclass] || '') : '',
        drop: row.drop || null
    };
}


/*
 * The budget module and the editor call the same stats different things.
 *
 * lib/item-budget.js works in the names the client's own cost table uses — str, sta, crit — while
 * the editor holds five named stat rows and a list of green sentences. These two maps are the
 * bridge, and they are the reverse of the tables above rather than a second opinion: the editor
 * label comes from PRIMARY_STATS, the sentence from RATING_LINES.
 */
const BUDGET_TO_STAT_TYPE = {
    str: 4, agi: 3, sta: 7, int: 5, spi: 6,
    defense: 12, dodge: 13, parry: 14, blockRating: 15, blockValue: 48,
    hit: 31, crit: 32, resilience: 35, haste: 36, expertise: 37,
    ap: 38, rangedAp: 39, mp5: 43, arp: 44, spellPower: 45, healthRegen: 46, spellPen: 47
};

/** The other direction, for pricing what the editor is showing. */
const STAT_TYPE_TO_BUDGET = Object.fromEntries(
    Object.entries(BUDGET_TO_STAT_TYPE).map(([name, type]) => [type, name]));

/** The preset sentence back to the stat it describes, so a green line can be priced. */
const LINE_TO_BUDGET = Object.fromEntries(
    Object.entries(RATING_LINES).map(([type, line]) => [line, STAT_TYPE_TO_BUDGET[Number(type)]]));

/**
 * A budget stat block as the editor's own rows: named stats above, green lines below.
 *
 * Which side a stat lands on is the game's rule rather than a choice here — the five primaries are
 * blue rows and everything else is an Equip: line.
 */
function editorLines(stats)
{
    const rows = [];
    const effects = [];

    for (const [name, value] of Object.entries(stats || {}))
    {
        const type = BUDGET_TO_STAT_TYPE[name];

        if (!type || !value)
        {
            continue;
        }

        if (PRIMARY_STATS[type])
        {
            rows.push({ type: PRIMARY_STATS[type], value });
        }
        else if (RATING_LINES[type])
        {
            effects.push({ kind: 'Equip', preset: RATING_LINES[type], value, text: '' });
        }
    }

    return { stats: rows, effects };
}

/**
 * The reverse: what the editor is showing, as a budget stat block.
 *
 * Green lines that are not one of the presets are ignored rather than guessed at — a hand-written
 * "Chance on hit: something interesting" has no price in the budget table, and pretending it costs
 * a point per number in the sentence would make the answer worse, not better.
 */
function budgetStats({ stats, effects })
{
    const out = {};
    const add = (name, value) =>
    {
        if (name && value)
        {
            out[name] = (out[name] || 0) + Number(value);
        }
    };

    for (const row of stats || [])
    {
        const type = Object.entries(PRIMARY_STATS).find(([, label]) => label === row.type);
        add(type && STAT_TYPE_TO_BUDGET[Number(type[0])], row.value);
    }

    for (const effect of effects || [])
    {
        add(LINE_TO_BUDGET[effect.preset], effect.value);
    }

    return out;
}

/** Slot label -> InventoryType, taking the first match so Chest resolves to 5 rather than a robe. */
function inventoryTypeFor(slotName)
{
    const found = Object.entries(SLOTS).find(([, name]) => name === slotName);

    return found ? Number(found[0]) : 0;
}

module.exports = {
    ItemDisplay, toEditor, toResult, categoryOf, editorLines, budgetStats, inventoryTypeFor, CURRENCY_CLASS, MATERIAL_CLASS, MOUNT_CLASS, SLOTS, ARMOR_TYPES, WEAPON_TYPES, PRIMARY_STATS,
    RATING_LINES, SOCKET_COLORS, DISPLAY
};
