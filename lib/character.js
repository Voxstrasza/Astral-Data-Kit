'use strict';

/*
 * What a character's stats turn into: ratings to percentages, agility to crit, spirit to regen.
 *
 * The client carries all of this. 3.3.5a ships a family of `gt*.dbc` game tables that are nothing
 * but a column of floats, one row per class per level, and the client's own PaperDollFrame reads
 * them to draw the character sheet. So does this, which is why the numbers agree with the game
 * rather than approximating it.
 *
 * What the client does *not* carry is where a character starts: base health, base mana and the
 * five stats before anything is equipped. Those tables are Cataclysm additions, so they are baked
 * into lib/character-stats.js instead. See the header there for why they are checked in.
 *
 * The lookups below are the ones AzerothCore performs in Player.cpp, written out with the same
 * indexing:
 *
 *   rating to percent      classRating->ratio / Rating->ratio          Player::GetRatingMultiplier
 *   agility to melee crit  (base + agility * ratio) * 100              Player::GetMeleeCritFromAgility
 *   intellect to spell crit(base + intellect * ratio) * 100            Player::GetSpellCritFromIntellect
 *   spirit to mana regen   spirit * ratio, times sqrt(intellect)       Player::OCTRegenMPPerSpirit
 *
 * The scope is what the in-game character sheet shows, and nothing else. That is why health regen
 * is absent: the core computes it, Wrath's paper doll never displays it, so gtRegenHPPerSpt and
 * gtOCTRegenHP are not read here.
 *
 * The conversions are half of this file. The other half is `sheet`, which assembles one character
 * out of them: base stats, then what gear adds flat, then percentage auras, then everything
 * derived from the totals, in that order and no other. Those formulas are not data anywhere, so
 * they are transcribed from AzerothCore's StatSystem.cpp and Player.cpp with the source named at
 * each one.
 *
 * Undiminished throughout. Dodge and parry come out as the plain sum of their parts, which is what
 * the core sets the field the character sheet reads to; it keeps the diminished figures privately
 * for combat, and none of that machinery is here. Racials and talents land in the percentage step
 * the order above leaves a gap for, in later phases.
 */

const { Dbc } = require('./wow/dbc');
const { baseStats, MAX_LEVEL } = require('./character-stats');
const { auraStats, conditionMet } = require('./auras');

/*
 * Every gt* table is indexed the same way: class-major, one hundred levels per class, or in
 * gtCombatRatings' case one hundred levels per rating. The client has room for levels past 80
 * and Astral does not use it - Wrath stops at 80 and so does the baked stat table.
 */
const GT_LEVELS = 100;
const GT_RATINGS = 32;

/** CombatRating, straight out of AzerothCore's Unit.h. Only the ones a sheet shows are named. */
const RATING = {
    weaponSkill: 0,
    defense: 1,
    dodge: 2,
    parry: 3,
    block: 4,
    meleeHit: 5,
    rangedHit: 6,
    spellHit: 7,
    meleeCrit: 8,
    rangedCrit: 9,
    spellCrit: 10,
    resilience: 14,
    meleeHaste: 17,
    rangedHaste: 18,
    spellHaste: 19,
    expertise: 23,
    armorPen: 24
};

/*
 * The gt tables this reads, and what each one holds.
 *
 * `perClass` tables are (class - 1) * 100 + (level - 1). `base` tables are one row per class.
 * gtCombatRatings is the odd one, indexed by rating rather than class, and
 * gtOCTClassCombatRatingScalar is the only one with a real ID column, so it is looked up by id
 * rather than by position.
 */
const TABLES = {
    combatRatings: 'gtCombatRatings',
    classScalar: 'gtOCTClassCombatRatingScalar',
    meleeCrit: 'gtChanceToMeleeCrit',
    meleeCritBase: 'gtChanceToMeleeCritBase',
    spellCrit: 'gtChanceToSpellCrit',
    spellCritBase: 'gtChanceToSpellCritBase',
    regenMp: 'gtRegenMPPerSpt'
};

/* ChrClasses: id, an unknown, power type, the pet name token, then the localized name. */
const CHR_CLASS = { ID: 0, Name: 4 };

/* ChrRaces: the localized name sits after the faction, model and file-string columns. */
const CHR_RACE = { ID: 0, Name: 14 };

/* TalentTab: id, the localized name, then icon, race mask, class mask, pet mask, order, and the
   name the game's talent frame tiles its background art from - "WarriorProtection". */
const TALENT_TAB = {
    ID: 0, Name: 1, ClassMask: 1 + 17 + 2, Order: 1 + 17 + 4, Background: 1 + 17 + 5
};

/*
 * Talent.dbc, 23 fields wide, and the four that matter beyond the position.
 *
 * `Prereq` and `PrereqRank` were read out rather than taken from a layout: field 13 holds a talent
 * id in 137 of the 139 rows that use it, and field 16 holds the rank, zero-based. In every one of
 * those 137 rows `PrereqRank + 1` is exactly the parent's own number of ranks - which is to say the
 * game's rule is "the talent above must be maxed", and the field is a restatement of it. The field
 * is read anyway rather than assuming the maximum, since it is the client that gets to say.
 */
const TALENT = {
    ID: 0, TabID: 1, Tier: 2, Column: 3, Ranks: [4, 5, 6, 7, 8], Prereq: 13, PrereqRank: 16
};

/* SkillLineAbility.dbc: id, the line it is on, the spell, then the race and class masks. */
const SKILL_ABILITY = { ID: 0, SkillLine: 1, Spell: 2, RaceMask: 3, ClassMask: 4 };

/*
 * Each race's own skill line, read out of SkillLine.dbc's category 9 rather than guessed. The
 * naming is the client's and is not consistent - "Orc Racial" beside "Racial - Human" - which is
 * why these are ids and not a name match.
 */
const RACIAL_LINES = {
    1: 754,   // Human
    2: 125,   // Orc
    3: 101,   // Dwarf
    4: 126,   // Night Elf
    5: 220,   // Undead
    6: 124,   // Tauren
    7: 753,   // Gnome
    8: 733,   // Troll
    10: 756,  // Blood Elf
    11: 760   // Draenei
};

/*
 * Dodge, which the client has no table for.
 *
 * `Player::GetDodgeFromAgility` builds it out of the crit table instead, with a base per class and
 * a coefficient that turns crit per agility into dodge per agility. 3.2.0 raised the agility a
 * point of dodge costs by fifteen percent, which is the 1.15 every one of them is divided by.
 *
 * Indexed by class id, so 10 is absent the same way it is absent from the game. The hunter's base
 * being negative is the client's own number and not a transcription slip.
 */
const DODGE_BASE = {
    1: 0.036640, 2: 0.034943, 3: -0.040873, 4: 0.020957, 5: 0.034178,
    6: 0.036640, 7: 0.021080, 8: 0.036587, 9: 0.024211, 11: 0.056097
};

const CRIT_TO_DODGE = {
    1: 0.85 / 1.15, 2: 1.00 / 1.15, 3: 1.11 / 1.15, 4: 2.00 / 1.15, 5: 1.00 / 1.15,
    6: 0.85 / 1.15, 7: 1.60 / 1.15, 8: 1.00 / 1.15, 9: 0.97 / 1.15, 11: 2.00 / 1.15
};

/*
 * Who parries and who blocks at all.
 *
 * Parry is not a judgement call: `UpdateParryPercentage` reads a zero cap for the four classes
 * that cannot, and this is the shape of that table. Block is the classes that learn the Block
 * passive, which the core grants through a spell rather than through a table, so it is written
 * out here instead of derived.
 *
 * Neither one asks what is equipped. The core turns both on from a learned spell and never looks
 * for a shield or a weapon, so this reads five percent block on a warrior holding nothing. Whether
 * the game's own paper doll agrees is a question for a naked warrior rather than for this comment.
 */
const PARRIES = new Set([1, 2, 3, 4, 6, 7]);
const BLOCKS = new Set([1, 2, 7]);

/*
 * An empty main hand, out of Unit.h: one to two damage on a two second swing.
 *
 * The core puts these back the moment a main-hand weapon comes off, so a naked character still
 * swings and the sheet still has a damage line to show. An empty off hand and an empty ranged
 * slot have no line at all, which is why only this one has a stand-in.
 */
const BARE_HAND = { dmgMin: 1, dmgMax: 2, speed: 2 };


class Character
{
    constructor(assets)
    {
        this.assets = assets;
        this.cache = null;
        this.setupCache = null;
        this.talentCache = null;
    }

    /** Drops the parsed tables so the next read picks up a newly configured client. */
    reset()
    {
        this.cache = null;
        this.setupCache = null;
        this.talentCache = null;
    }

    /** All nine game tables, parsed once. */
    load()
    {
        if (this.cache)
        {
            return this.cache;
        }

        const loaded = {};

        for (const [key, name] of Object.entries(TABLES))
        {
            const raw = this.assets.readEntry(`DBFilesClient\\${name}.dbc`);

            if (!raw)
            {
                throw new Error(`${name}.dbc is not in the client archives`);
            }

            loaded[key] = new Dbc(raw, `${name}.dbc`);
        }

        /*
         * Every one of these is a single float per row except the class scalar, which carries an
         * id alongside it. A client whose tables are shaped differently is not a 3.3.5a client,
         * and saying so here beats reading a number out of the wrong column later.
         */
        for (const [key, table] of Object.entries(loaded))
        {
            const expected = key === 'classScalar' ? 2 : 1;

            if (table.fieldCount !== expected)
            {
                throw new Error(
                    `${TABLES[key]}.dbc: expected ${expected} fields, client has ${table.fieldCount} - layout changed`);
            }
        }

        if (loaded.combatRatings.recordCount !== GT_RATINGS * GT_LEVELS)
        {
            throw new Error(
                `gtCombatRatings.dbc: expected ${GT_RATINGS * GT_LEVELS} rows, client has ${loaded.combatRatings.recordCount}`);
        }

        /* The scalar table is looked up by id, so build the map once rather than per query. */
        const scalar = new Map();

        for (let row = 0; row < loaded.classScalar.recordCount; row++)
        {
            scalar.set(loaded.classScalar.int(row, 0), loaded.classScalar.float(row, 1));
        }

        this.cache = { ...loaded, scalar };

        return this.cache;
    }

    /** A class-major row: (class - 1) * 100 + (level - 1), clamped the way the core clamps it. */
    static perClass(table, cls, level)
    {
        return table.float((cls - 1) * GT_LEVELS + Math.min(level, GT_LEVELS) - 1, 0);
    }

    /**
     * Percent per point of a rating, for this class at this level.
     *
     * The class scalar is 1 for most ratings and most classes, and is not for the rest, so it is
     * read rather than assumed. Its ids start at one where CombatRating starts at zero, hence the
     * `+ 1` - the same off-by-one the core comments on.
     */
    percentPerPoint(rating, cls, level)
    {
        const tables = this.load();
        const index = rating * GT_LEVELS + Math.min(level, GT_LEVELS) - 1;
        const ratio = tables.combatRatings.float(index, 0);
        const classRatio = tables.scalar.get((cls - 1) * GT_RATINGS + rating + 1);

        if (!ratio || classRatio === undefined)
        {
            return 0;
        }

        return classRatio / ratio;
    }

    /**
     * The readable direction: how much rating buys one percent.
     *
     * This is what a gear planner quotes and what the numbers can be checked against - 45.91 crit
     * rating for one percent at level 80, 32.79 hit, 8.20 expertise rating for one point of
     * expertise.
     */
    pointsPerPercent(rating, cls, level)
    {
        const per = this.percentPerPoint(rating, cls, level);

        return per ? 1 / per : 0;
    }

    /** Every named rating at once, as points per percent. */
    ratingTable(cls, level)
    {
        const out = {};

        for (const [name, rating] of Object.entries(RATING))
        {
            out[name] = this.pointsPerPercent(rating, cls, level);
        }

        return out;
    }

    /** Melee and ranged crit from agility, as a percentage. Base crit is negative for some. */
    meleeCritFromAgility(cls, level, agility)
    {
        const tables = this.load();
        const base = tables.meleeCritBase.float(cls - 1, 0);
        const ratio = Character.perClass(tables.meleeCrit, cls, level);

        return (base + agility * ratio) * 100;
    }

    /** Spell crit from intellect, as a percentage. Zero for the classes that cast nothing. */
    spellCritFromIntellect(cls, level, intellect)
    {
        const tables = this.load();
        const base = tables.spellCritBase.float(cls - 1, 0);
        const ratio = Character.perClass(tables.spellCrit, cls, level);

        return (base + intellect * ratio) * 100;
    }

    /**
     * Mana regenerated per five seconds from spirit, outside the five-second rule.
     *
     * The core works per second and the character sheet quotes per five, so the multiply happens
     * here rather than leaving every caller to remember it.
     */
    manaRegenPer5(cls, level, spirit, intellect)
    {
        const tables = this.load();
        const ratio = Character.perClass(tables.regenMp, cls, level);

        return Math.sqrt(intellect) * spirit * ratio * 5;
    }

    /** What a race and class has at a level with nothing equipped. Null for a combination
        that does not exist, such as a death knight below 55. */
    base(race, cls, level)
    {
        return baseStats(race, cls, level);
    }

    /**
     * A pile of aura contributions summed into what is flat and what is a multiplier.
     *
     * The weapon conditions are settled here rather than left to the caller: the orc's expertise
     * and the human's are worth nothing without the right weapon in hand, and the client says which
     * weapon in `EquippedItemClass` and its subclass mask rather than in prose.
     */
    auraTotals(list, weapons)
    {
        const flat = {};
        const percent = {};

        for (const one of list || [])
        {
            if (!conditionMet(one.condition, weapons))
            {
                continue;
            }

            const into = one.percent ? percent : flat;

            into[one.to] = (into[one.to] || 0) + one.value;
        }

        return { flat, percent };
    }

    /** What stamina adds to the health pool: the first twenty points are worth one each, the
        rest ten. `GetHealthBonusFromStamina`. */
    static healthFromStamina(stamina)
    {
        const first = Math.min(stamina, 20);

        return first + (stamina - first) * 10;
    }

    /** The same shape for intellect and the mana pool, at fifteen a point past the first twenty. */
    static manaFromIntellect(intellect)
    {
        const first = Math.min(intellect, 20);

        return first + (intellect - first) * 15;
    }

    /**
     * Melee attack power before gear, straight out of `Player::UpdateAttackPowerAndDamage`.
     *
     * A druid's is the one that is not a formula: cat, bear and moonkin each have their own, and
     * all three lean on Predatory Strikes, which is a talent the core implements in script code
     * rather than in spell data. Caster form is what a druid standing in a city shows, so caster
     * form is what this answers until phase 5 knows about forms.
     */
    static attackPower(cls, level, str, agi)
    {
        switch (cls)
        {
            case 1: case 2: case 6: return level * 3 + str * 2 - 20;     // warrior, paladin, DK
            case 3: case 4: case 7: return level * 2 + str + agi - 20;   // hunter, rogue, shaman
            case 5: case 8: case 9: return str - 10;                     // priest, mage, warlock
            case 11: return str * 2 - 20;                                // druid, caster form
            default: return 0;
        }
    }

    /** Ranged attack power. Everyone who is not a hunter, rogue or warrior reads agility alone. */
    static rangedAttackPower(cls, level, agi)
    {
        switch (cls)
        {
            case 3: return level * 2 + agi - 10;        // hunter
            case 1: case 4: return level + agi - 10;    // warrior, rogue
            default: return agi - 10;
        }
    }

    /**
     * One hand's damage and speed, as the paper doll writes them.
     *
     * `Player::CalculateMinMaxDamage` with nothing on the character but its own attack power:
     * the weapon's own range, plus what attack power is worth over one swing, which is
     * `attackPower / 14 * speed`.
     *
     * **The speed in that expression is the hasted one**, and only the attack power half of the
     * range is measured in swings. So haste shortens the swing, that half shrinks with it and the
     * weapon's own numbers do not - which is why a haste trinket makes the damage line go slightly
     * down while damage per second goes up. Measured: a 991-1487 axe on a level 80 warrior reads
     * 1137-1633 at 384.7 dps, and 1124-1620 at 419.2 with ten percent haste.
     *
     * The off hand's whole line is halved. `UpdateDamagePctDoneMods` puts 0.5 into
     * UNIT_MOD_DAMAGE_OFFHAND's TOTAL_PCT and `UpdateDamagePhysical` asks for the total percentage
     * when it fills the field the sheet reads, so the halving is on the paper doll and not only on
     * the swing.
     */
    static weaponDamage(weapon, attackPower, hastePercent, offHand = false)
    {
        const speed = (Number(weapon.speed) || BARE_HAND.speed) / (1 + (hastePercent || 0) / 100);
        const fromPower = attackPower / 14 * speed;
        const factor = offHand ? 0.5 : 1;

        return {
            min: ((Number(weapon.dmgMin) || 0) + fromPower) * factor,
            max: ((Number(weapon.dmgMax) || 0) + fromPower) * factor,
            speed
        };
    }

    /**
     * Dodge percent from agility, both halves of it summed.
     *
     * The core splits the answer in two so it can diminish the half that came from gear, and then
     * sets the field the character sheet reads to `diminishing + nondiminishing` anyway. So there
     * is nothing to split here: what the sheet shows is the plain sum, the same decision this file
     * makes about parry and about dodge rating.
     *
     * There is no dodge table in the client. Dodge per point of agility is proportional to crit per
     * point of agility, so `gtChanceToMeleeCrit` answers both and the two constants at the top of
     * this file turn one into the other.
     */
    dodgeFromAgility(cls, level, agility)
    {
        const base = DODGE_BASE[cls];

        if (base === undefined)
        {
            return 0;
        }

        const ratio = Character.perClass(this.load().meleeCrit, cls, level);

        return 100 * (base + agility * ratio * CRIT_TO_DODGE[cls]);
    }

    /**
     * One character, from base stats through to every number the sheet shows.
     *
     * `gear` is what is equipped, already aggregated rather than slot by slot: `stats` in the
     * budget names lib/items.js speaks, plus `armor` and `resistances`. Nothing fills it in yet,
     * and leaving it out answers for the naked character - which is the case to put beside the
     * game first, because it isolates these formulas from the gear pipeline that will feed them.
     */
    sheet(race, cls, level, gear = {}, auraList = [])
    {
        const base = this.base(race, cls, level);

        if (!base)
        {
            return null;
        }

        const worn = gear.stats || {};

        /*
         * The order of operations is the whole game.
         *
         * Base stats, then what gear adds flat, then percentage auras, then everything derived
         * from the totals. Derive before the additions are in and every number comes out a little
         * wrong and all of them still look plausible. The percentage step is racials and talents,
         * which do not exist yet - that is why nothing sits between the two below, and it is where
         * a gnome's five percent intellect goes when it does.
         */
        const stats = {
            str: base.str + (worn.str || 0),
            agi: base.agi + (worn.agi || 0),
            sta: base.sta + (worn.sta || 0),
            int: base.int + (worn.int || 0),
            spi: base.spi + (worn.spi || 0)
        };

        /*
         * The percentage step, and the reason the order above is written down.
         *
         * Racials and talents arrive as a list of what their auras are worth. The flat ones join
         * the stats; the percentage ones multiply the total, which is why they run after gear and
         * not before it. A five percent intellect racial on a gnome wearing a five thousand
         * intellect helm reads 5,250 - and reads 5,000 if this happens in the wrong order, which
         * is the sort of wrong that looks right.
         */
        const auras = this.auraTotals(auraList, gear.weapons);

        for (const stat of ['str', 'agi', 'sta', 'int', 'spi'])
        {
            stats[stat] += auras.flat[stat] || 0;
            stats[stat] = Math.floor(stats[stat] * (1 + (auras.percent[stat] || 0) / 100));
        }

        /* Rating to percent, for the ratings gear carries. One point of hit rating buys different
           amounts of melee and spell hit, so each reads its own row rather than sharing one. */
        const from = (rating, points) =>
            points ? points * this.percentPerPoint(rating, cls, level) : 0;

        /*
         * Defense skill is five per level plus whatever defense rating buys, and the core truncates
         * the rating half before using it anywhere: once as the number the sheet prints, and again
         * as the 0.04 percent of avoidance each point past the level cap is worth. Truncating once,
         * here, is what keeps those two agreeing.
         */
        const fromRating = Math.trunc(from(RATING.defense, worn.defense));
        const fromDefense = fromRating * 0.04;

        const resist = gear.resistances || {};

        const sheet = {
            race,
            class: cls,
            level,
            baseHealth: base.baseHealth,
            baseMana: base.baseMana,
            stats,

            health: base.baseHealth + Character.healthFromStamina(stats.sta),
            armor: (gear.armor || 0) + stats.agi * 2,

            attackPower: Character.attackPower(cls, level, stats.str, stats.agi) + (worn.ap || 0),

            /* Plain attack power off gear counts on both: `_ApplyItemMods` sends
               ITEM_MOD_ATTACK_POWER to UNIT_MOD_ATTACK_POWER *and* to
               UNIT_MOD_ATTACK_POWER_RANGED, while ITEM_MOD_RANGED_ATTACK_POWER reaches the ranged
               one alone. So a hunter's bracer of attack power moves this number too. */
            rangedPower: Character.rangedAttackPower(cls, level, stats.agi)
                + (worn.ap || 0) + (worn.rangedAp || 0),

            /* Not a line on the panel, and on the sheet anyway: it is what the ranged swing is
               timed by, and putting it here lets a racial or a talent reach it through the same
               door every other number is reached through. */
            rangedHaste: from(RATING.rangedHaste, worn.haste),

            meleeCrit: this.meleeCritFromAgility(cls, level, stats.agi)
                + from(RATING.meleeCrit, worn.crit),
            meleeHit: from(RATING.meleeHit, worn.hit),
            meleeHaste: from(RATING.meleeHaste, worn.haste),
            expertise: Math.trunc(from(RATING.expertise, worn.expertise)),
            armorPen: from(RATING.armorPen, worn.arp),

            spellPower: worn.spellPower || 0,
            spellCrit: this.spellCritFromIntellect(cls, level, stats.int)
                + from(RATING.spellCrit, worn.crit),
            spellHit: from(RATING.spellHit, worn.hit),
            spellHaste: from(RATING.spellHaste, worn.haste),

            defense: level * 5 + fromRating,
            dodge: Math.max(0, this.dodgeFromAgility(cls, level, stats.agi)
                + fromDefense + from(RATING.dodge, worn.dodge)),
            parry: PARRIES.has(cls)
                ? Math.max(0, 5 + fromDefense + from(RATING.parry, worn.parry))
                : 0,
            block: BLOCKS.has(cls)
                ? Math.max(0, 5 + fromDefense + from(RATING.block, worn.blockRating))
                : 0,
            blockValue: BLOCKS.has(cls)
                ? Math.max(0, stats.str * 0.5 - 10 + (worn.blockValue || 0))
                : 0,
            resilience: from(RATING.resilience, worn.resilience),

            resistances: {
                arcane: resist.arcane || 0,
                fire: resist.fire || 0,
                frost: resist.frost || 0,
                nature: resist.nature || 0,
                shadow: resist.shadow || 0
            },

            ratings: this.ratingTable(cls, level)
        };

        /*
         * What the auras are worth to everything that was just derived.
         *
         * Separate from the stat step above because these are not stats: five expertise from Axe
         * Specialization is not five strength, and a dodge percent is not agility. They land on
         * the finished number, flat first and then any multiplier, which is the order the core
         * applies its own modifiers in.
         *
         * Resistances go through the same door - a racial that grants shadow resistance moves the
         * school it names and nothing else.
         */
        for (const [name, value] of Object.entries(auras.flat))
        {
            if (sheet.resistances[name] !== undefined)
            {
                sheet.resistances[name] += value;
            }
            else if (typeof sheet[name] === 'number')
            {
                sheet[name] += value;
            }
        }

        for (const [name, value] of Object.entries(auras.percent))
        {
            if (sheet.resistances[name] !== undefined)
            {
                sheet.resistances[name] = Math.floor(sheet.resistances[name] * (1 + value / 100));
            }
            else if (typeof sheet[name] === 'number')
            {
                sheet[name] = Math.floor(sheet[name] * (1 + value / 100));
            }
        }

        /* Expertise is whole points on the sheet however it was arrived at. */
        sheet.expertise = Math.trunc(sheet.expertise);

        /*
         * The weapons last, because they are read off the finished attack power and the finished
         * haste rather than off the parts those were built from. An orc's axe expertise and a
         * warrior's Anticipation have both landed by here, and so has any percentage a racial put
         * on attack power, which the swing quotes in full.
         *
         * An empty main hand still answers; an empty off hand and an empty ranged slot answer with
         * nothing, and the panel draws those as the dashes it draws every stat it cannot know.
         */
        const hands = gear.hands || {};

        sheet.mainHand = Character.weaponDamage(
            hands.main || BARE_HAND, sheet.attackPower, sheet.meleeHaste);

        sheet.offHand = hands.off
            ? Character.weaponDamage(hands.off, sheet.attackPower, sheet.meleeHaste, true)
            : null;

        sheet.ranged = hands.ranged
            ? Character.weaponDamage(hands.ranged, sheet.rangedPower, sheet.rangedHaste)
            : null;

        /*
         * A warrior has no mana bar, so the sheet leaves those numbers out rather than answering
         * zero - an empty cell says "not a thing for this class" and a zero does not.
         *
         * The two regen numbers are the five-second rule. Outside it spirit counts in full; inside
         * it only the fraction a talent lets through, which with no talents is none of it. What mp5
         * gear adds ticks either way, so it is in both.
         */
        if (base.baseMana)
        {
            sheet.mana = base.baseMana + Character.manaFromIntellect(stats.int);
            sheet.manaRegen = this.manaRegenPer5(cls, level, stats.spi, stats.int) + (worn.mp5 || 0);
            sheet.manaRegenCasting = worn.mp5 || 0;
        }

        return sheet;
    }

    /**
     * The classes, the races, which classes each race can be, and the three specs per class.
     *
     * Everything here is the client's, so a picker cannot offer a combination the game does not
     * have. Parsed once and kept, since none of it changes while the program runs.
     */
    setup()
    {
        if (this.setupCache)
        {
            return this.setupCache;
        }

        const named = (file, layout) =>
        {
            const raw = this.assets.readEntry(`DBFilesClient\\${file}.dbc`);

            if (!raw)
            {
                throw new Error(`${file}.dbc is not in the client archives`);
            }

            const table = new Dbc(raw, `${file}.dbc`);
            const out = [];

            for (let row = 0; row < table.recordCount; row++)
            {
                out.push({ id: table.int(row, layout.ID), name: table.string(row, layout.Name) });
            }

            return out;
        };

        const classes = named('ChrClasses', CHR_CLASS);
        const races = named('ChrRaces', CHR_RACE);

        /*
         * CharBaseInfo is the one table the shared reader will not touch, and rightly: its records
         * are two bytes, a race and a class, not a row of 4-byte fields. Sixty-two of them, which
         * is every playable pairing in Wrath. Read here rather than hand-written so a client with
         * custom combinations says so itself.
         */
        const raw = this.assets.readEntry('DBFilesClient\\CharBaseInfo.dbc');

        if (!raw || raw.slice(0, 4).toString() !== 'WDBC')
        {
            throw new Error('CharBaseInfo.dbc is not in the client archives');
        }

        const count = raw.readUInt32LE(4);
        const size = raw.readUInt32LE(12);
        const allowed = new Map();

        for (let i = 0; i < count; i++)
        {
            const at = 20 + i * size;
            const race = raw.readUInt8(at);

            if (!allowed.has(race))
            {
                allowed.set(race, []);
            }

            allowed.get(race).push(raw.readUInt8(at + 1));
        }

        /* TalentTab carries the three pet trees as well, and those have no class on them. */
        const tabRaw = this.assets.readEntry('DBFilesClient\\TalentTab.dbc');

        if (!tabRaw)
        {
            throw new Error('TalentTab.dbc is not in the client archives');
        }

        const tabs = new Dbc(tabRaw, 'TalentTab.dbc');
        const specs = [];

        for (let row = 0; row < tabs.recordCount; row++)
        {
            const classMask = tabs.int(row, TALENT_TAB.ClassMask);

            if (!classMask)
            {
                continue;
            }

            specs.push({
                id: tabs.int(row, TALENT_TAB.ID),
                name: tabs.string(row, TALENT_TAB.Name),
                classMask,
                order: tabs.int(row, TALENT_TAB.Order)
            });
        }

        this.setupCache = {
            classes: classes
                .filter((c) => c.name)
                .map((c) => ({
                    ...c,
                    specs: specs
                        .filter((s) => s.classMask & (1 << (c.id - 1)))
                        .sort((a, b) => a.order - b.order)
                        .map((s) => ({ id: s.id, name: s.name }))
                }))
                .filter((c) => c.specs.length),
            races: races
                .filter((r) => allowed.has(r.id) && r.name)
                .map((r) => ({ ...r, classes: allowed.get(r.id).sort((a, b) => a - b) }))
        };

        return this.setupCache;
    }

    /**
     * The three talent trees of one class, as the calculator draws them.
     *
     * `info` answers a spell id with its name, icon and filled description - one per rank, because
     * the rank the pointer is on is the text that should be showing rather than always rank one's.
     *
     * Everything here is the client's. The trees, the tiers, the columns, which talent needs which
     * and how many ranks each has are all Talent.dbc; the art and the words are the spells behind
     * each rank; and the background name is what the game's own talent frame tiles its art from.
     */
    talents(cls, info)
    {
        const tabs = this.talentTabs(cls);
        const table = this.talentTable();
        const byTab = new Map(tabs.map((tab) => [tab.id, []]));

        for (const row of table)
        {
            const into = byTab.get(row.tab);

            if (into)
            {
                into.push(row);
            }
        }

        for (const tab of tabs)
        {
            const rows = byTab.get(tab.id).sort((a, b) => a.tier - b.tier || a.col - b.col);

            tab.talents = rows.map((row) =>
            {
                const first = info ? info(row.ranks[0]) : null;

                return {
                    id: row.id,
                    tier: row.tier,
                    col: row.col,
                    name: first ? first.name : `Talent ${row.id}`,
                    icon: first ? first.icon : '',
                    ranks: row.ranks.map((spell) =>
                    {
                        const one = info ? info(spell) : null;

                        return { spell, description: one ? one.description : '' };
                    }),
                    requires: row.prereq || 0,
                    requiresRank: row.prereq ? row.prereqRank + 1 : 0
                };
            });

            /* The deepest tier decides how tall the tree is drawn, and it is not always six: a
               tree is as tall as its last talent rather than a fixed frame. */
            tab.tiers = rows.reduce((most, row) => Math.max(most, row.tier + 1), 0);
        }

        return tabs;
    }


    /**
     * One race's racials, derived rather than listed.
     *
     * Every race has a skill line of its own in category 9 - "Orc Racial", "Racial - Human" - and
     * `SkillLineAbility.dbc` names every spell on it. So the list comes out of the client, and a
     * client with a race this program has never heard of still answers.
     *
     * Deduped by spell name, because a racial appears once per rank and per variant: Command is on
     * the orc line five times over. The first row wins, which is rank one, which is what a level 80
     * character has anyway - none of these have ranks that matter.
     *
     * Each one is classified rather than filtered: what the sheet can read comes back with its
     * stats, and Blood Fury, Shadowmeld, War Stomp and the rest come back marked as changing
     * nothing. A racial panel that silently dropped half the list would look broken.
     */
    racials(race, info, byId)
    {
        const lineId = RACIAL_LINES[race];

        if (!lineId)
        {
            return [];
        }

        const raw = this.assets.readEntry('DBFilesClient\\SkillLineAbility.dbc');

        if (!raw)
        {
            throw new Error('SkillLineAbility.dbc is not in the client archives');
        }

        const table = new Dbc(raw, 'SkillLineAbility.dbc');
        const mask = 1 << (race - 1);
        const seen = new Map();

        for (let row = 0; row < table.recordCount; row++)
        {
            if (table.int(row, SKILL_ABILITY.SkillLine) !== lineId)
            {
                continue;
            }

            /*
             * A line can carry spells for more than one race - the blood elf and draenei lines both
             * do - and a zero mask means every race on that line.
             */
            const races = table.int(row, SKILL_ABILITY.RaceMask);

            if (races && !(races & mask))
            {
                continue;
            }

            const id = table.int(row, SKILL_ABILITY.Spell);
            const spell = info ? info(id) : null;

            if (!spell || !spell.name || seen.has(spell.name))
            {
                continue;
            }

            const full = byId ? byId.get(id) : null;

            seen.set(spell.name, {
                id,
                name: spell.name,
                icon: spell.icon,
                description: spell.description,
                stats: full ? auraStats(full) : []
            });
        }

        return [...seen.values()];
    }

    /**
     * What a talent build is worth, as aura contributions.
     *
     * `build` is talent id to points spent. Only the rank actually reached is read: a talent's
     * ranks are separate spells with their own base points, so rank three is spell three and not
     * three times spell one.
     */
    talentAuras(cls, build, byId)
    {
        const out = [];

        if (!build || !byId)
        {
            return out;
        }

        for (const row of this.talentTable())
        {
            const rank = Number(build[row.id]) || 0;

            if (!rank || !row.ranks.length)
            {
                continue;
            }

            const spell = byId.get(row.ranks[Math.min(rank, row.ranks.length) - 1]);

            if (spell)
            {
                out.push(...auraStats(spell));
            }
        }

        return out;
    }
    /** Talent.dbc, parsed once. */
    talentTable()
    {
        if (this.talentCache)
        {
            return this.talentCache;
        }

        const raw = this.assets.readEntry('DBFilesClient\\Talent.dbc');

        if (!raw)
        {
            throw new Error('Talent.dbc is not in the client archives');
        }

        const table = new Dbc(raw, 'Talent.dbc');
        const rows = [];

        for (let row = 0; row < table.recordCount; row++)
        {
            rows.push({
                id: table.int(row, TALENT.ID),
                tab: table.int(row, TALENT.TabID),
                tier: table.int(row, TALENT.Tier),
                col: table.int(row, TALENT.Column),
                ranks: TALENT.Ranks.map((f) => table.int(row, f)).filter(Boolean),
                prereq: table.int(row, TALENT.Prereq),
                prereqRank: table.int(row, TALENT.PrereqRank)
            });
        }

        this.talentCache = rows;

        return rows;
    }

    /** The tabs one class has, in the order the game lays them out left to right. */
    talentTabs(cls)
    {
        const raw = this.assets.readEntry('DBFilesClient\\TalentTab.dbc');

        if (!raw)
        {
            throw new Error('TalentTab.dbc is not in the client archives');
        }

        const table = new Dbc(raw, 'TalentTab.dbc');
        const wanted = 1 << (cls - 1);
        const tabs = [];

        for (let row = 0; row < table.recordCount; row++)
        {
            const mask = table.int(row, TALENT_TAB.ClassMask);

            /* The three pet trees carry no class at all, so the mask filters them out on its own. */
            if (!mask || !(mask & wanted))
            {
                continue;
            }

            tabs.push({
                id: table.int(row, TALENT_TAB.ID),
                name: table.string(row, TALENT_TAB.Name),
                order: table.int(row, TALENT_TAB.Order),
                background: table.string(row, TALENT_TAB.Background)
            });
        }

        return tabs.sort((a, b) => a.order - b.order);
    }

    /** Whether the client tables are readable, for a status line rather than a thrown error. */
    status()
    {
        try
        {
            this.load();

            return { ok: true, tables: Object.keys(TABLES).length };
        }
        catch (err)
        {
            return { ok: false, reason: err.message };
        }
    }
}

module.exports = { Character, RATING, MAX_LEVEL };
