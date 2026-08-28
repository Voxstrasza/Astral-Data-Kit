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
 * `subclass` 3 `InventoryType` 5 — and the editor in tooltip terms: an armor slot, a type, a
 * quality, a binding. Everything below is that mapping, written out rather than guessed at,
 * because the two vocabularies genuinely do not line up.
 */

const { Dbc, LOCALE_FIELDS } = require('./wow/dbc');

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
    39: 'Increases ranged attack power by {N}.',
    43: 'Restores {N} mana per 5 sec.',
    44: 'Increases your armor penetration rating by {N}.',
    45: 'Increases spell power by {N}.',
    46: 'Restores {N} health per 5 sec.',
    47: 'Increases your spell penetration by {N}.',
    48: 'Increases your shield block value by {N}.'
};

/*
 * The stats with no preset behind them, written as their own sentence.
 *
 * Only the two pre-3.0 split spell stats are left here. They appear on real items — 3.0 folded
 * healing and spell damage into spell power and the old rows stayed in the database — but they are
 * not stats anyone should be offered when inventing a piece, so they stay as text rather than
 * joining the preset list.
 *
 * Ranged attack power and spell penetration used to sit here too, and were promoted on 2026-08-27:
 * both are live 3.3.5a stats, and free text meant `budgetStats` could not price them and the
 * character sheet never moved for them.
 */
const RATING_CUSTOM = {
    41: 'Increases healing done by up to {N} and damage done by up to {N} for all magical spells and effects.',
    42: 'Increases damage and healing done by magical spells and effects by up to {N}.'
};

/*
 * What the two legacy lines are worth, which is not what they say.
 *
 * `Player::_ApplyItemMods` sends 42 to `ApplySpellDamageBonus`, which adds to the damage field of
 * every school — the number the spell tab shows — so it is spell power in everything but name.
 * 41 goes to `ApplySpellHealingBonus`, which touches the healing field alone, and 3.3.5a's paper
 * doll has no healing line to move: 3.0 merged the two and the sheet only kept the damage half.
 * So 41 is worth nothing on a character sheet however generously its sentence is written.
 *
 * Both are still named, because these names are read twice: the character sheet ignores a stat it
 * has no line for, while lib/item-budget.js prices every one it is given. `spellDamage` and
 * `spellPower` cost the same there, so 42 arriving as spell power changes no price, and 41 arriving
 * as `spellHealing` is priced at half — which is what it was worth and what it was never priced at
 * before, since a custom line used to reach neither reader.
 *
 * Matched on the fixed half of the sentence, since a custom line carries its number both in
 * `value` and baked into its text.
 */
const LEGACY_LINES = [
    { prefix: 'Increases damage and healing done by magical spells and effects by up to ', budget: 'spellPower' },
    { prefix: 'Increases healing done by up to ', budget: 'spellHealing' }
];

/*
 * The five schools a character has resistance in.
 *
 * `RESISTANCES` above has six, because `item_template` has a holy column. The game never gave
 * players holy resistance and the paper doll has no line for it, so a holy value on an invented
 * item stays on its tooltip and is left out of the character.
 */
const SCHOOLS = new Set(['arcane', 'fire', 'frost', 'nature', 'shadow']);

/*
 * A mount's tooltip is not flavor text.
 *
 * item_template keeps "Teaches you how to summon this mount." in `description`, which is the
 * field ordinary items use for the yellow quote at the bottom. On a mount it is the green Use
 * line at the top instead, so it is moved there and the flavor left empty.
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

/*
 * What each of the Armory's nineteen slots will take, as InventoryTypes.
 *
 * The paper doll's slots and an item's own slot do not line up one to one, which is the whole
 * reason this table exists rather than a string comparison. A character has two ring slots and the
 * item has one `Finger`; a main hand accepts a one-hander, a two-hander or a main-hand-only weapon;
 * an off hand accepts a shield, a held-in-off-hand and a one-hander for anyone who can dual wield.
 * Chest is two numbers because a robe is its own InventoryType.
 *
 * Kept here beside `SLOTS` so there is one place that knows what an InventoryType means. The
 * editor's slot *labels* are derived from it by `slotNames` rather than written out again.
 */
const ARMORY_SLOTS = {
    'Head': [1],
    'Neck': [2],
    'Shoulder': [3],
    'Back': [16],
    'Chest': [5, 20],
    'Shirt': [4],
    'Tabard': [19],
    'Wrist': [9],
    'Hands': [10],
    'Waist': [6],
    'Legs': [7],
    'Feet': [8],
    'Finger 1': [11],
    'Finger 2': [11],
    'Trinket 1': [12],
    'Trinket 2': [12],
    'Main hand': [13, 17, 21],
    'Off hand': [13, 14, 22, 23],
    'Ranged': [15, 25, 26, 28]
};

/** The InventoryTypes one Armory slot accepts, or none for a name that is not a slot. */
function slotTypes(armorySlot)
{
    return ARMORY_SLOTS[armorySlot] || [];
}

/**
 * The editor slot labels one Armory slot accepts.
 *
 * Saved items keep their slot as the label a human picked - "One-Hand", not 13 - so filtering the
 * saved store needs the names. Derived from the numbers so the two can never disagree.
 */
function slotNames(armorySlot)
{
    return [...new Set(slotTypes(armorySlot).map((type) => SLOTS[type]).filter(Boolean))];
}

/** Every slot's names at once, for handing to a client that has to filter saved work itself. */
function slotNameTable()
{
    return Object.fromEntries(Object.keys(ARMORY_SLOTS).map((slot) => [slot, slotNames(slot)]));
}

/** Armor: class 4, subclass -> what the tooltip's right column says. */
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


/*
 * ItemSet.dbc, for the green block at the foot of a tier piece's tooltip.
 *
 * 53 fields: the id, a localized name, seventeen item ids, then eight spell ids paired with the
 * eight piece counts that turn them on. Read out of a real client rather than taken from a layout
 * - Bloodfang Armor comes back with eight pieces and its three bonuses at 3, 5 and 8, which is what
 * the game shows.
 *
 * The set is the client's, but the *names* of its pieces are not: 3.3.5a keeps item names in the
 * world database, so a caller that wants them has to look the ids up there.
 */
const ITEM_SET = (() =>
{
    const f = { ID: 0, Name: 1 };

    f.Items = f.Name + LOCALE_FIELDS;    // 18, seventeen of them
    f.Spells = f.Items + 17;             // 35, eight
    f.Thresholds = f.Spells + 8;         // 43, eight
    f.COUNT = f.Thresholds + 8 + 2;      // 53, with the skill requirement after

    return f;
})();

class ItemSets
{
    constructor(assets)
    {
        this.assets = assets;
        this.cache = null;
    }

    reset()
    {
        this.cache = null;
    }

    load()
    {
        if (this.cache)
        {
            return this.cache;
        }

        const raw = this.assets.readEntry('DBFilesClient\\ItemSet.dbc');

        if (!raw)
        {
            throw new Error('ItemSet.dbc is not in the client archives');
        }

        const table = new Dbc(raw, 'ItemSet.dbc');

        if (table.fieldCount < ITEM_SET.COUNT)
        {
            throw new Error(
                `ItemSet.dbc: expected ${ITEM_SET.COUNT} fields, client has ${table.fieldCount}`);
        }

        const sets = new Map();

        for (let row = 0; row < table.recordCount; row++)
        {
            const items = [];
            const bonuses = [];

            for (let i = 0; i < 17; i++)
            {
                const id = table.int(row, ITEM_SET.Items + i);

                if (id)
                {
                    items.push(id);
                }
            }

            for (let i = 0; i < 8; i++)
            {
                const spell = table.int(row, ITEM_SET.Spells + i);

                if (spell)
                {
                    bonuses.push({ count: table.int(row, ITEM_SET.Thresholds + i), spell });
                }
            }

            /* The game lists them in ascending order of pieces; the table does not. */
            bonuses.sort((a, b) => a.count - b.count);

            sets.set(table.int(row, ITEM_SET.ID), {
                id: table.int(row, ITEM_SET.ID),
                name: table.string(row, ITEM_SET.Name),
                items,
                bonuses
            });
        }

        this.cache = sets;

        return sets;
    }

    /** One set, or null for an item that is not part of one. */
    get(id)
    {
        return id ? this.load().get(Number(id)) || null : null;
    }
}

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
                `ItemDisplayInfo.dbc: expected ${DISPLAY.COUNT} fields, client has ${table.fieldCount} - layout changed`);
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
                const raw = this.assets.readEntry('DBFilesClient\\SpellItemEnchantment.dbc');
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
        const color = SOCKET_COLORS[row[field]];

        if (color)
        {
            sockets.push(color);
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
/*
 * What each spelltrigger means on a tooltip. The numbers are the column's own: 0 is on use,
 * 1 on equip, 2 a chance on hit. 4 and 5 are the soulstone and the no-delay use, both of
 * which the game prints as a Use line.
 */
const SPELL_TRIGGER = {
    0: 'Use',
    1: 'Equip',
    2: 'Chance on hit',
    4: 'Use',
    5: 'Use'
};

/**
 * The green lines an item carries as spells rather than as stat ratings.
 *
 * `spellText` resolves a spell id to its filled-in description. Without a client there is
 * none, and a line is left out rather than printed as a prefix with nothing after it.
 */
function spellEffects(row, spellText)
{
    const effects = [];

    if (!spellText)
    {
        return effects;
    }

    for (let i = 1; i <= 5; i++)
    {
        const id = Number(row[`spellid_${i}`]);

        if (!id)
        {
            continue;
        }

        const kind = SPELL_TRIGGER[Number(row[`spelltrigger_${i}`])];
        const text = spellText(id);

        if (!kind || !text)
        {
            continue;
        }

        effects.push({ kind, preset: 'custom', value: 0, text });
    }

    return effects;
}

function toEditor(row, icon, socketBonusText, spellText)
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

    /*
     * A mount's Use line is the one spell whose text is not worth reading out of the client:
     * every mount says the same sentence, and the spell it carries describes the ride rather
     * than the item.
     */
    const isMount = row.class === MOUNT_CLASS.class && row.subclass === MOUNT_CLASS.subclass;

    if (isMount)
    {
        effects.push({ kind: 'Use', preset: 'custom', value: 0, text: MOUNT_USE });
    }
    else
    {
        effects.push(...spellEffects(row, spellText));
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
        if (effect.preset === 'custom')
        {
            const legacy = LEGACY_LINES.find((one) => (effect.text || '').startsWith(one.prefix));

            add(legacy && legacy.budget, effect.value);
            continue;
        }

        add(LINE_TO_BUDGET[effect.preset], effect.value);
    }

    return out;
}

/**
 * A rack of equipped items as one stat block, in the shape lib/character.js takes.
 *
 * Three sources, not one, because the editor does not keep an item's numbers in a single place:
 * the stat rows and green lines go through `budgetStats`, armor is its own field, and resistances
 * are their own list. A shield's block value is a fourth — the item carries it beside stat type
 * 48, and the core adds the two rather than choosing between them, so this does too.
 *
 * Sums rather than replaces, so nineteen items land the way nineteen items should. What it does
 * not do is care which slot anything came from: enforcing that a helm is in the head slot belongs
 * to the panel, and by the time a set of items reaches here the question is settled.
 */
function equipped(items)
{
    const gear = { stats: {}, armor: 0, resistances: {}, weapons: [] };

    for (const item of items || [])
    {
        /*
         * What is in hand, for the racials that wait on it. The orc's expertise is worth nothing
         * without an axe and the client says so in `EquippedItemSubClassMask`, so the character
         * side needs the class and subclass rather than the editor's label.
         *
         * A label maps to more than one subclass - "Axe" is both the one-handed and the two-handed
         * kind - and every racial mask that names a weapon family names both, so all the matching
         * subclasses go in and the mask decides.
         */
        for (const [subclass, label] of Object.entries(WEAPON_TYPES))
        {
            if (label === item.itemType)
            {
                gear.weapons.push({ itemClass: 2, subclass: Number(subclass) });
            }
        }

        if (item.itemType === 'Shield')
        {
            gear.weapons.push({ itemClass: 4, subclass: 6 });
        }

        for (const [name, value] of Object.entries(budgetStats(item)))
        {
            gear.stats[name] = (gear.stats[name] || 0) + value;
        }

        gear.armor += Number(item.armor) || 0;

        /* The shield's own block value, which is the same quantity as stat type 48 by another
           route. `_ApplyItemMods` and `GetShieldBlockValue` both feed the one flat modifier. */
        if (Number(item.block))
        {
            gear.stats.blockValue = (gear.stats.blockValue || 0) + Number(item.block);
        }

        for (const row of item.resistances || [])
        {
            const school = String(row.type || '').toLowerCase();

            if (SCHOOLS.has(school))
            {
                gear.resistances[school] = (gear.resistances[school] || 0) + (Number(row.value) || 0);
            }
        }
    }

    return gear;
}

/** Slot label -> InventoryType, taking the first match so Chest resolves to 5 rather than a robe. */
function inventoryTypeFor(slotName)
{
    const found = Object.entries(SLOTS).find(([, name]) => name === slotName);

    return found ? Number(found[0]) : 0;
}

module.exports = {
    ItemDisplay, ItemSets, toEditor, toResult, categoryOf, editorLines, budgetStats, equipped, inventoryTypeFor, slotTypes, slotNames, slotNameTable, ARMORY_SLOTS, CURRENCY_CLASS, MATERIAL_CLASS, MOUNT_CLASS, SLOTS, ARMOR_TYPES, WEAPON_TYPES, PRIMARY_STATS,
    RATING_LINES, RATING_CUSTOM, SOCKET_COLORS, DISPLAY
};
