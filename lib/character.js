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
 * Phase 1 of the Armory is this file and the baked stats beside it: the conversions, with no
 * character assembled out of them yet. The pipeline that adds gear, racials and talents on top
 * comes next and lands here too.
 */

const { Dbc } = require('./wow/dbc');
const { baseStats, MAX_LEVEL } = require('./character-stats');

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

/* TalentTab: id, the localized name, then icon, race mask, class mask, pet mask, order. */
const TALENT_TAB = { ID: 0, Name: 1, ClassMask: 1 + 17 + 2, Order: 1 + 17 + 4 };

class Character
{
    constructor(assets)
    {
        this.assets = assets;
        this.cache = null;
        this.setupCache = null;
    }

    /** Drops the parsed tables so the next read picks up a newly configured client. */
    reset()
    {
        this.cache = null;
        this.setupCache = null;
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
     * Everything phase 1 can say about one character, in one call.
     *
     * Naked, because there is no gear pipeline yet: these are the numbers a character has before
     * anything is equipped, plus the conversion table the sheet will need once there is.
     */
    sheet(race, cls, level)
    {
        const base = this.base(race, cls, level);

        if (!base)
        {
            return null;
        }

        const sheet = {
            race,
            class: cls,
            level,
            baseHealth: base.baseHealth,
            baseMana: base.baseMana,
            stats: { str: base.str, agi: base.agi, sta: base.sta, int: base.int, spi: base.spi },
            meleeCrit: this.meleeCritFromAgility(cls, level, base.agi),
            spellCrit: this.spellCritFromIntellect(cls, level, base.int),
            ratings: this.ratingTable(cls, level)
        };

        /* A warrior has no mana bar to regenerate, so the sheet leaves the number out rather than
           answering zero - an empty cell says "not a thing for this class" and a zero does not. */
        if (base.baseMana)
        {
            sheet.manaRegen = this.manaRegenPer5(cls, level, base.spi, base.int);
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
