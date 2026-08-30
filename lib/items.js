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
 * SpellItemEnchantment.dbc, for socket bonuses, gems and enchants alike — all three are a row in
 * this one table.
 *
 * item_template stores a socket bonus as an enchantment id — 3357 rather than "+6 Strength" — and
 * printing the number is what the tooltip did at first. The name is a localised column, so it sits
 * at field 14 with the enUS slot first.
 *
 * The three effect blocks were read out of a real client rather than taken from a layout: row 352
 * is "+8 Strength" and carries type 5, amount 8, arg 4, which is ITEM_ENCHANTMENT_TYPE_STAT with
 * the same ITEM_MOD_* number `item_template.stat_type` uses. That is what makes an enchant's
 * numbers reach the sheet through the vocabulary already here.
 */
const ENCHANT = {
    ID: 0,
    Effect: [2, 3, 4],
    Amount: [5, 6, 7],       // EffectPointsMin; min and max agree on every stat row
    Arg: [11, 12, 13],
    Name: 14,
    Condition: 34,           // what a meta gem needs around it, or 0 for everything else
    COUNT: 38
};

/*
 * SpellItemEnchantmentCondition.dbc, which is the whole of why a meta gem is lit or dark.
 *
 * Byte packed rather than four bytes a field: 49 rows of 64 bytes where the header claims 31
 * fields, so `Dbc` refuses it on principle - a record that is not a whole number of fields is
 * normally a misread layout. This one really is packed, and is read here by hand.
 *
 * Five checks a row, each a left operand, an operator and a right operand. The offsets are the
 * five arrays laid end to end: id, then LtOperandType[5], LtOperand[5], Operator[5],
 * RtOperandType[5], RtOperand[5], Logic[5]. 4 + 5 + 20 + 5 + 5 + 20 + 5 is 64 exactly, which is
 * what makes this the layout rather than a guess.
 */
const CONDITION = {
    RECORD: 64,
    LtType: 4,
    Lt: 9,
    Operator: 29,
    RtType: 34,
    Rt: 39,
    Logic: 59
};

/*
 * A condition counts gems by color, and the colors are indexed rather than masked here: 1 is
 * meta, 2 red, 3 yellow, 4 blue. Read off Relentless Earthsiege Diamond, whose condition is
 * exactly one each of 2, 3 and 4 - the "1 red, 1 yellow, 1 blue" everybody knows it by.
 */
const CONDITION_COLORS = { 1: 'meta', 2: 'red', 3: 'yellow', 4: 'blue' };

/*
 * The three operators the table actually uses, counted across all 49 rows: 90 of them are 5,
 * four are 3 and two are 2. Anything else would be a layout that moved, so it fails the check
 * rather than passing quietly.
 */
const CONDITION_OPS = {
    2: (a, b) => a > b,
    3: (a, b) => a < b,
    5: (a, b) => a >= b
};

/*
 * The enchantment effect kinds, of which two move a character sheet.
 *
 * 5 is a stat and 4 is a resistance, and those are the two this reads. 1, 3 and 7 are spells — a
 * proc, an equip aura, a use — and 2 is weapon damage; none of them is a flat number that can be
 * added to a stat block, so they are carried for their name and left out of the arithmetic. 8 is
 * the prismatic socket, which is a socket rather than a stat.
 */
const ENCHANT_STAT = 5;
const ENCHANT_RESIST = 4;

/* 3 is an equip spell, which is where a gem keeps its numbers when they are not a plain amount:
   a Nightmare Tear's "+10 All Stats" is this, and the spell behind it is what says the ten. */
const ENCHANT_SPELL = 3;

/* And 7 is a spell the enchant lets you *use*, which in practice is what an engineering tinker
   is: Hyperspeed Accelerators, Nitro Boosts, a Frag Belt. Ten enchants in the client carry one,
   and it is how a tinker is told from an ordinary enchant when its row is named badly. */
const ENCHANT_USE_SPELL = 7;

/*
 * GemProperties.dbc: 626 rows of five fields. Field 1 is the enchantment holding the gem's
 * numbers and field 4 is its color; the other two are the count limits, which nothing here reads.
 */
const GEM = { ID: 0, Enchant: 1, Color: 4, COUNT: 5 };

/*
 * A gem's color is a mask over the same bits a socket uses, which is the whole of the rule that
 * makes an orange gem satisfy a red socket and a yellow one.
 *
 * All eight of these were counted in a real client: 53 meta, 94 red, 77 yellow, 138 orange, 47
 * blue, 91 purple, 116 green and 10 prismatic. So the mixed colors are not an edge case - they are
 * more than half of every gem in the game, and reading only the four plain bits would drop them.
 */
const GEM_COLORS = {
    1: 'meta', 2: 'red', 4: 'yellow', 6: 'orange',
    8: 'blue', 10: 'purple', 12: 'green', 14: 'prismatic'
};

/*
 * A socket's color as the bit a gem has to carry to sit in it.
 *
 * A prismatic socket is the one you added yourself and it takes anything, so it is every bit at
 * once rather than a color of its own.
 */
const SOCKET_MASKS = { meta: 1, red: 2, yellow: 4, blue: 8, prismatic: 15 };

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
 * The classes, by the bit each occupies in item_template.AllowableClass — bit 0 is class 1.
 *
 * The hole at index 9 is class 10, which does not exist in 3.3.5a, so druid is class 11 and bit
 * 10. Writing the ten names as a flat list would put druid on bit 9 and hand it every item whose
 * mask happens to set that bit — Shadowmourne's does, and it is a warrior, paladin and death
 * knight weapon.
 */
const CLASS_NAMES = [
    'Warrior', 'Paladin', 'Hunter', 'Rogue', 'Priest',
    'Death Knight', 'Shaman', 'Mage', 'Warlock', null, 'Druid'
];

/** How many of those are real, for telling "every class" from a genuine restriction. */
const CLASS_COUNT = CLASS_NAMES.filter(Boolean).length;

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

    /*
     * The last slot is not the same slot for everyone.
     *
     * A warrior, rogue, hunter, priest, mage or warlock puts a bow, a gun, a thrown weapon or a
     * wand there. The other four put a relic there instead, and the game names the slot after the
     * relic rather than calling it Ranged. So this is five slots and not one with five labels:
     * each takes only what belongs in it, and the panel picks which by class.
     */
    'Ranged': [15, 25, 26],
    'Libram': [28],
    'Idol': [28],
    'Totem': [28],
    'Sigil': [28]
};

/*
 * Which attack a filled Armory slot feeds.
 *
 * A weapon's numbers are the one thing `equipped()` cannot sum: two one-handers are two
 * different lines on the sheet, and which is which is the hand it was put in rather than
 * anything the item itself knows. So the panel sends the slot along with the item and this
 * table reads it. The other sixteen slots move no weapon numbers at all.
 */
const WEAPON_HANDS = { 'Main hand': 'main', 'Off hand': 'off', 'Ranged': 'ranged' };

/*
 * The same answer from an item's own slot, for a rack handed over without its slot keys.
 *
 * A one-hander says only "One-Hand", so a pair of them both read as a main hand and the first
 * one wins. That is the ambiguity the table above exists to settle; this is the fallback for a
 * caller with no slots to give, like the coverage tool.
 */
const SLOT_HANDS = {
    'Main Hand': 'main', 'One-Hand': 'main', 'Two-Hand': 'main',
    'Off Hand': 'off', 'Held In Off-hand': 'off',
    'Ranged': 'ranged', 'Thrown': 'ranged'
};

/*
 * The four relics share one InventoryType and are told apart by armor subclass.
 *
 * A libram, an idol, a totem and a sigil are all InventoryType 28, so a filter on the type alone
 * offers a death knight the paladin's librams. `item_template.subclass` is what separates them:
 * 7, 8, 9 and 10 under item class 4, out of ItemTemplate.h.
 */
const RELIC_SUBCLASS = { 'Libram': 7, 'Idol': 8, 'Totem': 9, 'Sigil': 10 };

/** The item class and subclass a relic slot accepts, or nothing for a slot that is not one. */
function slotSubclasses(armorySlot)
{
    const subclass = RELIC_SUBCLASS[armorySlot];

    return subclass === undefined ? null : { itemClass: 4, subclasses: [subclass] };
}

/*
 * What each class's last weapon slot is called.
 *
 * Mage is deliberately absent and so reads Ranged: a wand is a ranged weapon and goes in the
 * same slot a priest's and a warlock's does. The six classes not listed here all read Ranged.
 */
const RANGED_SLOT = { 2: 'Libram', 6: 'Sigil', 7: 'Totem', 11: 'Idol' };

/** The name of one class's ranged slot, which is also the key it is filed under. */
function rangedSlotName(cls)
{
    return RANGED_SLOT[cls] || 'Ranged';
}

/*
 * Titan's Grip, which is the one place a slot's answer depends on who is wearing it.
 *
 * A warrior can hold a two-hander in the off hand, so the off hand slot has to offer them or the
 * search comes back empty for the build people most want to put together. It is a Fury talent
 * rather than a class feature, and the Armory asks the class rather than the talent deliberately:
 * an empty off hand list on a warrior who has not spent the points yet is a slot that looks
 * broken, where an offered two-hander is only ever a build you have not finished.
 */
const TITANS_GRIP = 1;

/**
 * The InventoryTypes one Armory slot accepts, or none for a name that is not a slot.
 *
 * The class is optional and only ever matters for a warrior's off hand.
 */
function slotTypes(armorySlot, cls)
{
    const types = ARMORY_SLOTS[armorySlot] || [];

    return armorySlot === 'Off hand' && Number(cls) === TITANS_GRIP ? [...types, 17] : types;
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


/*
 * Faction.dbc, for the reputation line on an item.
 *
 * item_template names the faction by id and the rank by number, and neither is a word: an Ashen
 * Band of Unmatched Vengeance carries 1156 and 6, which is Revered with The Ashen Verdict. The id
 * resolves here, out of the client, since 3.3.5a keeps faction names in the DBCs.
 *
 * 57 fields, name at 23 — after the id, the reputation index, four race masks, four class masks,
 * four bases, four flags, the parent and its two mods and two caps. Read out of a real client: 1156
 * comes back "The Ashen Verdict" and 67 "Horde".
 */
const FACTION = { ID: 0, Name: 1 + 1 + 4 + 4 + 4 + 4 + 1 + 2 + 2, COUNT: 57 };

/** Reputation standings, in the order item_template numbers them. */
const REPUTATION = [
    'Hated', 'Hostile', 'Unfriendly', 'Neutral', 'Friendly', 'Honored', 'Revered', 'Exalted'
];

class Factions
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

        const raw = this.assets.readEntry('DBFilesClient\\Faction.dbc');

        if (!raw)
        {
            throw new Error('Faction.dbc is not in the client archives');
        }

        const table = new Dbc(raw, 'Faction.dbc');

        if (table.fieldCount < FACTION.COUNT)
        {
            throw new Error(
                `Faction.dbc: expected ${FACTION.COUNT} fields, client has ${table.fieldCount}`);
        }

        const names = new Map();

        for (let row = 0; row < table.recordCount; row++)
        {
            names.set(table.int(row, FACTION.ID), table.string(row, FACTION.Name));
        }

        this.cache = names;

        return names;
    }

    /** One faction's name, or an empty string. */
    name(id)
    {
        return id ? this.load().get(Number(id)) || '' : '';
    }
}

/**
 * The requirement lines a real item carries, as the editor's own free-text rows.
 *
 * Class and reputation both land in the same list the game prints them in, between durability and
 * the level requirement, so a loaded item and an invented one produce the same thing and either can
 * be edited afterwards.
 */
function requirementsOf(row, factionName)
{
    const out = [];
    const classes = CLASS_NAMES.filter((name, i) => name && (row.AllowableClass & (1 << i)));

    /*
     * -1 is every class, and so is a mask with all ten set. The masks carry bits past the real
     * classes as well - Shadowmourne's is 260643, which is warrior, paladin and death knight with
     * eight unused bits above them - so only the named ones are ever looked at.
     */
    if (row.AllowableClass > 0 && classes.length && classes.length < CLASS_COUNT)
    {
        out.push({ text: `Classes: ${classes.join(', ')}`, unmet: false });
    }

    if (row.RequiredReputationFaction && row.RequiredReputationRank !== null)
    {
        const faction = factionName ? factionName(row.RequiredReputationFaction) : '';
        const rank = REPUTATION[row.RequiredReputationRank] || '';

        if (faction && rank)
        {
            out.push({ text: `Requires ${rank} with ${faction}`, unmet: false });
        }
    }

    return out;
}

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
        this.enchantRows = null;
        this.gemRows = null;
    }

    /** Drops the parsed tables so the next read picks up a newly configured client. */
    reset()
    {
        this.cache = null;

        /* The rows, not the readers: `enchants()` and `gems()` are methods on this class, and
           clearing a field of the same name would hide them behind a null for good. */
        this.enchantRows = null;
        this.gemRows = null;
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
     * The whole enchantment table, id -> { id, name, effects }, parsed on first use and kept.
     *
     * 2,656 rows of a string and three small effect blocks. One table serves three readers: a
     * socket bonus on a tooltip wants only the name, while a gem and an enchant want the numbers
     * behind it, and there is no sense parsing it twice.
     */
    enchants()
    {
        if (this.enchantRows)
        {
            return this.enchantRows;
        }

        const raw = this.assets.readEntry('DBFilesClient\\SpellItemEnchantment.dbc');
        const table = new Dbc(raw, 'SpellItemEnchantment.dbc');

        if (table.fieldCount !== ENCHANT.COUNT)
        {
            throw new Error(
                `SpellItemEnchantment.dbc: expected ${ENCHANT.COUNT} fields, client has ${table.fieldCount}`);
        }

        this.enchantRows = new Map();

        for (let row = 0; row < table.recordCount; row++)
        {
            const effects = [];

            for (let i = 0; i < 3; i++)
            {
                const type = table.int(row, ENCHANT.Effect[i]);

                if (type)
                {
                    effects.push({
                        type,
                        amount: table.int(row, ENCHANT.Amount[i]),
                        arg: table.int(row, ENCHANT.Arg[i])
                    });
                }
            }

            this.enchantRows.set(table.int(row, ENCHANT.ID), {
                id: table.int(row, ENCHANT.ID),
                name: table.string(row, ENCHANT.Name),
                effects,
                conditionId: table.int(row, ENCHANT.Condition)
            });
        }

        return this.enchantRows;
    }

    /** One enchantment row, or null where there is no client or no such id. */
    enchant(id)
    {
        try
        {
            return this.enchants().get(Number(id)) || null;
        }
        catch
        {
            return null;
        }
    }

    /**
     * Socket bonus text for an enchantment id: 3357 -> "+6 Strength".
     *
     * Kept as its own call because that is what a tooltip asks for, and because a missing client
     * has to read as a blank line there rather than as a thrown error.
     */
    enchantName(id)
    {
        if (!Number(id))
        {
            return '';
        }

        const row = this.enchant(id);

        /* No client, or a layout that moved: better a blank line than an id on the tooltip. */
        return row ? row.name : '';
    }

    /**
     * GemProperties.dbc: the gem property id an item carries -> its color and its enchantment.
     *
     * 626 rows of five fields, of which two matter: field 1 is the enchantment that holds the
     * gem's actual numbers, and field 4 is the color as the same 1/2/4/8 mask
     * `item_template.socketColor` uses, so `SOCKET_COLORS` reads both.
     */
    gems()
    {
        if (this.gemRows)
        {
            return this.gemRows;
        }

        const raw = this.assets.readEntry('DBFilesClient\\GemProperties.dbc');
        const table = new Dbc(raw, 'GemProperties.dbc');

        if (table.fieldCount !== GEM.COUNT)
        {
            throw new Error(
                `GemProperties.dbc: expected ${GEM.COUNT} fields, client has ${table.fieldCount}`);
        }

        this.gemRows = new Map();

        for (let row = 0; row < table.recordCount; row++)
        {
            this.gemRows.set(table.int(row, GEM.ID), {
                id: table.int(row, GEM.ID),
                enchantId: table.int(row, GEM.Enchant),
                colorMask: table.int(row, GEM.Color),
                color: GEM_COLORS[table.int(row, GEM.Color)] || ''
            });
        }

        return this.gemRows;
    }

    /**
     * SpellItemEnchantmentCondition.dbc, id -> the checks that have to hold.
     *
     * Parsed by hand out of the raw bytes, since the record is packed. Only the checks with a
     * left operand are kept: the five slots are a fixed-width array and most rows use one or
     * three of them, so the empty ones are padding rather than a check that always passes.
     */
    gemConditions()
    {
        if (this.conditionRows)
        {
            return this.conditionRows;
        }

        const buf = this.assets.readEntry('DBFilesClient\\SpellItemEnchantmentCondition.dbc');

        if (!buf || buf.toString('ascii', 0, 4) !== 'WDBC')
        {
            throw new Error('SpellItemEnchantmentCondition.dbc: not a DBC');
        }

        const count = buf.readUInt32LE(4);
        const size = buf.readUInt32LE(12);

        if (size !== CONDITION.RECORD)
        {
            throw new Error(
                `SpellItemEnchantmentCondition.dbc: expected ${CONDITION.RECORD} byte records, client has ${size}`);
        }

        this.conditionRows = new Map();

        for (let row = 0; row < count; row++)
        {
            const at = 20 + row * size;
            const checks = [];

            for (let i = 0; i < 5; i++)
            {
                const color = buf.readUInt8(at + CONDITION.LtType + i);

                if (!color)
                {
                    continue;
                }

                checks.push({
                    color: CONDITION_COLORS[color] || '',
                    operator: buf.readUInt8(at + CONDITION.Operator + i),

                    /* The right side is either a plain number of gems or another color's count,
                       which is what "more blue than red" is written as. Six of the ninety-six
                       checks in the table are the second kind. */
                    against: CONDITION_COLORS[buf.readUInt8(at + CONDITION.RtType + i)] || '',
                    value: buf.readUInt32LE(at + CONDITION.Rt + i * 4)
                });
            }

            this.conditionRows.set(buf.readUInt32LE(at), checks);
        }

        return this.conditionRows;
    }

    /** The checks behind one condition id, or an empty list where there is no client. */
    gemCondition(id)
    {
        try
        {
            return (Number(id) && this.gemConditions().get(Number(id))) || [];
        }
        catch
        {
            return [];
        }
    }

    /**
     * One gem's color, numbers and requirement, ready to travel on an item.
     *
     * Everything a gem is worth is folded in here rather than looked up again later, because the
     * character sheet adds up items that were handed to it whole - half of what the Armory wears
     * was invented and has no id to look anything up by.
     */
    gem(id)
    {
        try
        {
            const row = this.gems().get(Number(id));

            if (!row)
            {
                return null;
            }

            const enchant = this.enchant(row.enchantId);
            const requires = enchant ? this.gemCondition(enchant.conditionId) : [];

            return {
                ...row,
                name: enchant ? enchant.name : '',
                effects: enchant ? enchant.effects : [],
                requires,
                requiresText: requirementText(requires)
            };
        }
        catch
        {
            return null;
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

function toEditor(row, icon, socketBonusRow, spellText, factionName)
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
        socketBonus: socketBonusRow ? socketBonusRow.name : '',

        /* The numbers behind that sentence, carried so the character sheet does not have to look
           the row up again. An item travels whole through the Armory - half of what it wears was
           invented and has no id to look anything up by - so what the bonus is worth travels with
           it. An invented item has no row and its typed sentence is read instead. */
        socketBonusEffects: socketBonusRow ? socketBonusRow.effects : [],
        requires: requirementsOf(row, factionName),

        /*
         * A reputation item arrives with its level line switched off.
         *
         * Both are in the database - the Ashen Bands require level 80 as well as a standing with
         * The Ashen Verdict - but the standing is the requirement worth reading, and the level is
         * noise beside it. Keyed off the reputation field rather than off the two ring ids, so any
         * item earned through a faction behaves the same. The tick is there to put it back.
         */
        reqLevelShow: !row.RequiredReputationFaction,

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


/* ------------------------------------------------------- gems, enchants and socket bonuses */

/*
 * The word each stat is written as on a gem, an enchant or a socket bonus.
 *
 * The client writes these as short phrases rather than as the editor's whole sentences — "+4
 * Critical Strike Rating", not "Improves critical strike rating by 4" — so this is a second
 * spelling of the same vocabulary and not a duplicate of `RATING_LINES`. It is read both ways:
 * to name a stat on a picker row, and to read a socket bonus a person typed by hand.
 *
 * Every one was taken from an enchantment name in a real client. The lower case in "mana per 5
 * sec." is the client's own and the match ignores case anyway.
 */
const STAT_WORDS = {
    str: 'Strength', agi: 'Agility', sta: 'Stamina', int: 'Intellect', spi: 'Spirit',
    defense: 'Defense Rating', dodge: 'Dodge Rating', parry: 'Parry Rating',
    blockRating: 'Block Rating', blockValue: 'Block Value',
    hit: 'Hit Rating', crit: 'Critical Strike Rating', resilience: 'Resilience Rating',
    haste: 'Haste Rating', expertise: 'Expertise Rating',
    ap: 'Attack Power', rangedAp: 'Ranged Attack Power', mp5: 'mana per 5 sec.',
    arp: 'Armor Penetration Rating', spellPower: 'Spell Power', spellPen: 'Spell Penetration',
    health: 'Health', mana: 'Mana'
};

/*
 * ITEM_MOD_* numbers the enchantment table uses that the budget vocabulary has no name for.
 *
 * Health and mana are flat pools rather than budgeted stats, so they are deliberately absent from
 * `BUDGET_TO_STAT_TYPE` - nothing prices them. They still have to be carried, because the sheet
 * has a health line and a mana line and an old "+100 Health" enchant that moved neither would be
 * the silent no-op this whole pipeline exists to prevent.
 */
const ENCHANT_POOLS = { 0: 'mana', 1: 'health' };

/*
 * The split ratings, from before 3.0 merged them.
 *
 * A "+2 Critical Strike Rating" socket bonus from Burning Crusade carries ITEM_MOD 19, which is
 * melee crit alone, where a Wrath one carries 32 and means all three schools. The sheet has one
 * crit rating line and reads `crit`, so the older numbers land there too: a couple of points of
 * spell crit that the original never gave is a smaller error than the whole bonus reading as
 * nothing, which is what dropping them would do.
 *
 * They only ever turn up on pre-Wrath gear, which is the only place these enchantment rows are
 * used at all.
 */
const ENCHANT_LEGACY_RATINGS = {
    16: 'hit', 17: 'hit', 18: 'hit',
    19: 'crit', 20: 'crit', 21: 'crit',
    28: 'haste', 29: 'haste', 30: 'haste'
};

/*
 * A resistance effect's argument is a spell school, with armor sharing the zero.
 *
 * Read out of the client: "+125 Armor" is arg 0, "+20 Fire Resistance" is arg 2 and "+10 Shadow
 * Resistance" is arg 5, which is SPELL_SCHOOL order. Holy is in the list because the table has it
 * and left out further down for the same reason the item's own holy column is - the paper doll
 * has no line for it.
 */
const ENCHANT_SCHOOLS = {
    0: 'armor', 1: 'holy', 2: 'fire', 3: 'nature', 4: 'frost', 5: 'shadow', 6: 'arcane'
};

/**
 * One enchantment row's effects as the same three piles `equipped()` already sums.
 *
 * Only the two effect kinds that are a flat number come through. A proc, an equip aura or a use
 * effect is a spell, and a spell is not something a stat block can add - Mongoose and Berserking
 * keep their name on the tooltip and move nothing here, which is honest rather than lossy.
 */
function enchantStats(effects)
{
    const out = { stats: {}, resistances: {}, armor: 0 };

    for (const effect of effects || [])
    {
        const amount = Number(effect.amount) || 0;

        if (!amount)
        {
            continue;
        }

        if (effect.type === ENCHANT_STAT)
        {
            const name = STAT_TYPE_TO_BUDGET[effect.arg]
                || ENCHANT_POOLS[effect.arg]
                || ENCHANT_LEGACY_RATINGS[effect.arg];

            if (name)
            {
                out.stats[name] = (out.stats[name] || 0) + amount;
            }
        }
        else if (effect.type === ENCHANT_RESIST)
        {
            const school = ENCHANT_SCHOOLS[effect.arg];

            if (school === 'armor')
            {
                out.armor += amount;
            }
            else if (SCHOOLS.has(school))
            {
                out.resistances[school] = (out.resistances[school] || 0) + amount;
            }
        }
    }

    return out;
}

/**
 * A socket bonus written out by hand, read back into stats: "+6 Strength" -> { str: 6 }.
 *
 * Only for an item that has no enchantment id to read instead, which means one you invented. A
 * database item carries the id and goes the exact route; this is the fallback that keeps a custom
 * piece's bonus from being worth nothing just because it was typed rather than picked.
 *
 * Deliberately strict. A sentence it cannot read contributes nothing rather than something
 * guessed, which is the same rule the green lines above follow.
 */
function parseStatText(text)
{
    const match = /^\s*\+?\s*(\d+)\s+(.+?)\s*$/.exec(String(text || ''));

    if (!match)
    {
        return {};
    }

    const words = match[2].toLowerCase();
    const found = Object.entries(STAT_WORDS).find(([, word]) => word.toLowerCase() === words);

    return found ? { [found[0]]: Number(match[1]) } : {};
}

/**
 * How many gems of each color are on the character, counted the way the game counts them.
 *
 * By mask rather than by name, and this is the whole subtlety: a gem carries a color mask, so a
 * Nightmare Tear at 14 is red and yellow and blue at once and counts once toward each. That is
 * why one of them alone lights a meta that wants one red, one yellow and one blue.
 *
 * Counted across everything worn rather than per item, because a meta gem in a helm is answered
 * by a red gem in a boot.
 */
function gemColorCounts(items)
{
    const counts = { meta: 0, red: 0, yellow: 0, blue: 0 };
    const bits = { meta: 1, red: 2, yellow: 4, blue: 8 };

    for (const item of items || [])
    {
        for (const gem of item.gems || [])
        {
            if (!gem)
            {
                continue;
            }

            for (const [color, bit] of Object.entries(bits))
            {
                if (Number(gem.colorMask) & bit)
                {
                    counts[color]++;
                }
            }
        }
    }

    return counts;
}

/**
 * Whether a gem's requirement is met by what else is socketed - the meta gem's own rule.
 *
 * Every check has to hold. The table's `Logic` column is 1 on each check but the last and 0 on
 * the last, on all forty-nine rows, so there is nothing here but an AND and no reason to invent
 * an OR that the data never asks for.
 *
 * A gem with no requirement is always on, which is every gem that is not a meta.
 */
function metaHolds(requires, counts)
{
    return (requires || []).every((check) =>
    {
        const test = CONDITION_OPS[check.operator];

        if (!test || !check.color)
        {
            /* An operator this does not know is not a reason to light a gem it cannot judge. */
            return false;
        }

        /* Either a plain number of gems, or another color's count: "more blue than red". */
        const against = check.against ? (counts[check.against] || 0) : Number(check.value) || 0;

        return test(counts[check.color] || 0, against);
    });
}

/** A requirement as the sentence the game writes: "Requires at least 1 Red and 1 Yellow gem." */
function requirementText(requires)
{
    if (!requires || !requires.length)
    {
        return '';
    }

    const word = (color) => color.charAt(0).toUpperCase() + color.slice(1);

    const parts = requires.map((check) =>
    {
        const name = word(check.color);

        if (check.against)
        {
            return check.operator === 3
                ? `fewer ${name} than ${word(check.against)} gems`
                : `more ${name} than ${word(check.against)} gems`;
        }

        const count = Number(check.value) || 0;

        if (check.operator === 3)
        {
            return `fewer than ${count} ${name} gems`;
        }

        /* 5 is "at least" and 2 is "more than"; the table has no others. */
        const lead = check.operator === 2 ? 'more than' : 'at least';

        return `${lead} ${count} ${name} gem${count === 1 ? '' : 's'}`;
    });

    return `Requires ${parts.join(' and ')}.`;
}

/**
 * Whether an item's socket bonus is earned: every socket filled, and every gem a color its
 * socket takes.
 *
 * The second half is the rule everyone knows and nobody writes down. A gem carries a color mask
 * rather than one color, so an orange gem is red and yellow at once and satisfies either socket;
 * the test is that the two masks overlap at all. A prismatic socket is every bit, so anything
 * sits in it.
 *
 * An item with no sockets has no bonus to earn, whatever its text says.
 */
function socketBonusMet(item)
{
    const sockets = item.sockets || [];
    const gems = item.gems || [];

    if (!sockets.length)
    {
        return false;
    }

    return sockets.every((color, index) =>
    {
        const gem = gems[index];

        return gem && (Number(gem.colorMask) & (SOCKET_MASKS[color] || 0)) !== 0;
    });
}

/**
 * The stats an item's gems, enchant and earned socket bonus are worth, as one block.
 *
 * `counts` is the whole character's gem colors, because a meta gem's requirement is answered by
 * what is socketed elsewhere. An item asked about on its own gets an empty count and its meta
 * reads as dark, which is the right answer for an item that is not on anybody.
 */
function extrasOf(item, counts = {})
{
    const out = { stats: {}, resistances: {}, armor: 0 };

    const fold = (piece) =>
    {
        for (const [name, value] of Object.entries(piece.stats || {}))
        {
            out.stats[name] = (out.stats[name] || 0) + value;
        }

        for (const [school, value] of Object.entries(piece.resistances || {}))
        {
            out.resistances[school] = (out.resistances[school] || 0) + value;
        }

        out.armor += piece.armor || 0;
    };

    for (const gem of item.gems || [])
    {
        /* A meta whose requirement is not met is socketed and dark: it sits in the item and is
           worth nothing, which is exactly what the game does with it. */
        if (gem && metaHolds(gem.requires, counts))
        {
            fold(enchantStats(gem.effects));
        }
    }

    if (item.enchant)
    {
        fold(enchantStats(item.enchant.effects));
    }

    if (socketBonusMet(item))
    {
        /*
         * The row first and the sentence second.
         *
         * Neither alone is enough, which was measured rather than assumed. Reading the effects
         * misses the handful of old bonuses written as an equip spell - "+6 Block Value" carries
         * a spell id and no number - and reading the text misses the ones whose wording drifted,
         * like "+12 mana every 5 sec." beside "+2 mana per 5 sec.". The row is exact where it
         * has numbers at all, so it goes first and the sentence catches the rest.
         */
        const fromRow = enchantStats(item.socketBonusEffects);

        fold(Object.keys(fromRow.stats).length || fromRow.armor
            ? fromRow
            : { stats: parseStatText(item.socketBonus) });
    }

    return out;
}

/**
 * The spells an item's live gems, enchant and earned socket bonus apply.
 *
 * Not every gem keeps its numbers in the enchantment row. A Nightmare Tear's "+10 All Stats" is
 * effect type 3, an equip spell, and the row carries a spell id where the amount would be - so
 * reading only the flat effects reads that gem as worth nothing.
 *
 * The spell is exactly the shape a racial is, which is why nothing new computes them: `auraStats`
 * in lib/auras.js already turns a passive spell into what it is worth, and it already refuses the
 * ones that are procs rather than passives. Mongoose and Lightweave come back empty from it,
 * which is the honest answer for a proc on a stat sheet.
 *
 * Gated on the same meta requirement the stats are, so a dark meta's spell is dark too.
 */
function extraSpells(item, counts = {})
{
    const out = [];

    const collect = (effects) =>
    {
        for (const effect of effects || [])
        {
            if (effect.type === ENCHANT_SPELL && effect.arg)
            {
                out.push(effect.arg);
            }
        }
    };

    for (const gem of item.gems || [])
    {
        if (gem && metaHolds(gem.requires, counts))
        {
            collect(gem.effects);
        }
    }

    if (item.enchant)
    {
        collect(item.enchant.effects);
    }

    if (socketBonusMet(item))
    {
        collect(item.socketBonusEffects);
    }

    return out;
}

/** Every such spell across a whole rack, which is what the sheet route asks for. */
function extraSpellsOf(items)
{
    const counts = gemColorCounts(items);

    return (items || []).flatMap((item) => extraSpells(item, counts));
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
    const gear = { stats: {}, armor: 0, resistances: {}, weapons: [], hands: {} };

    /*
     * Counted once, over the whole rack, before anything is summed: a meta gem asks what else is
     * socketed, and the answer cannot depend on which item happens to be read first.
     */
    const gemCounts = gemColorCounts(items);

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

        /*
         * What each hand swings, kept apart rather than summed. The sheet quotes a range and a
         * speed per hand, and a weapon with no delay leaves the swing where an empty hand has it -
         * the same `if (proto->Delay)` the core guards its own SetAttackTime with.
         */
        const hand = WEAPON_HANDS[item.armorySlot] || SLOT_HANDS[item.slot];

        if (hand && item.hasWeapon && !gear.hands[hand])
        {
            gear.hands[hand] = {
                dmgMin: Number(item.dmgMin) || 0,
                dmgMax: Number(item.dmgMax) || 0,
                speed: Number(item.speed) || 0
            };
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

        /*
         * The gems, the enchant and the socket bonus, which are three more sources of the same
         * stats and go in through the same door. They are flat gear numbers, so they join here
         * and are multiplied by the percentage auras afterwards along with everything else - the
         * order lib/character.js writes down and the reason a gemmed helm on a gnome reads right.
         */
        const extras = extrasOf(item, gemCounts);

        for (const [name, value] of Object.entries(extras.stats))
        {
            gear.stats[name] = (gear.stats[name] || 0) + value;
        }

        for (const [school, value] of Object.entries(extras.resistances))
        {
            gear.resistances[school] = (gear.resistances[school] || 0) + value;
        }

        gear.armor += extras.armor;
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
    ItemDisplay, ItemSets, Factions, toEditor, toResult, categoryOf, editorLines, budgetStats, equipped, inventoryTypeFor, slotTypes, slotSubclasses, slotNames, slotNameTable, rangedSlotName, RANGED_SLOT, ARMORY_SLOTS, CURRENCY_CLASS, MATERIAL_CLASS, MOUNT_CLASS, SLOTS, ARMOR_TYPES, WEAPON_TYPES, PRIMARY_STATS,
    RATING_LINES, RATING_CUSTOM, SOCKET_COLORS, DISPLAY, TITANS_GRIP,
    enchantStats, parseStatText, socketBonusMet, extrasOf, extraSpells, extraSpellsOf,
    gemColorCounts, metaHolds, requirementText, STAT_WORDS, GEM_COLORS, SOCKET_MASKS, ENCHANT_USE_SPELL
};
