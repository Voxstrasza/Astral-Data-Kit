'use strict';

/*
 * Spell lookup, read from the client's own Spell.dbc.
 *
 * Spells are client data in a way creatures are not: the world database stores which spells exist
 * and what they do mechanically, but the name, rank, description, cast time, range and icon that
 * a tooltip shows all live in the DBCs. So this needs no database at all — a configured client is
 * enough.
 *
 * Spell.dbc is 234 fields wide and about 49,000 rows, which is large enough that the field
 * offsets have to be right rather than roughly right. They come from the column order of an
 * AzerothCore world database's `spell_dbc` table, the same trick that gave Map.dbc its layout,
 * and the total is asserted against the field count in the file's own header.
 */

const { Dbc, LOCALE_FIELDS } = require('./wow/dbc');

const SPELL = (() =>
{
    const f = {
        ID: 0,
        CastingTimeIndex: 28,
        RecoveryTime: 29,
        CategoryRecoveryTime: 30,
        DurationIndex: 40,
        PowerType: 41,
        ManaCost: 42,
        RangeIndex: 46,
        EffectDieSides: [74, 75, 76],
        EffectBasePoints: [80, 81, 82],
        SpellIconID: 133,
        Name: 136
    };

    f.NameSubtext = f.Name + LOCALE_FIELDS;          // 153 — the rank line
    f.Description = f.NameSubtext + LOCALE_FIELDS;   // 170
    f.AuraDescription = f.Description + LOCALE_FIELDS; // 187
    f.COUNT = f.AuraDescription + LOCALE_FIELDS;     // 204 ... plus the trailing block
    return f;
})();

/* SpellCastTimes.dbc: ID, Base, PerLevel, Minimum. */
const CAST_TIME = { ID: 0, Base: 1, COUNT: 4 };

/* SpellDuration.dbc: ID, Duration, DurationPerLevel, MaxDuration. */
const DURATION = { ID: 0, Duration: 1, COUNT: 4 };

/* SpellRange.dbc: ID, min/max pairs, flags, then two localised names. */
const RANGE = (() =>
{
    const f = { ID: 0, RangeMin0: 1, RangeMin1: 2, RangeMax0: 3, RangeMax1: 4, Flags: 5, DisplayName: 6 };
    f.DisplayNameShort = f.DisplayName + LOCALE_FIELDS;
    f.COUNT = f.DisplayNameShort + LOCALE_FIELDS;
    return f;
})();

/* SpellIcon.dbc: ID, TextureFilename. */
const ICON = { ID: 0, TextureFilename: 1, COUNT: 2 };

/* Spell.dbc PowerType -> the label a tooltip uses. */
const POWER_LABEL = {
    0: 'Mana', 1: 'Rage', 2: 'Focus', 3: 'Energy', 4: 'Happiness',
    5: 'Runes', 6: 'Runic Power'
};

/** "1.5 sec", "Instant", or "" when the spell has no cast bar at all. */
function castLabel(ms)
{
    if (!ms)
    {
        return 'Instant';
    }

    const seconds = ms / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} sec cast`;
}

function cooldownLabel(ms)
{
    if (!ms)
    {
        return '';
    }

    const seconds = ms / 1000;

    if (seconds >= 3600) { return `${Math.round(seconds / 3600)} hr cooldown`; }
    if (seconds >= 60) { return `${Math.round(seconds / 60)} min cooldown`; }

    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} sec cooldown`;
}

class Spells
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

    read(name, fields)
    {
        const raw = this.assets.readEntry(`DBFilesClient\\${name}`);

        if (!raw)
        {
            throw new Error(`${name} is not in the client archives`);
        }

        const table = new Dbc(raw, name);

        if (fields && fields.COUNT && table.fieldCount < fields.COUNT)
        {
            throw new Error(
                `${name}: expected at least ${fields.COUNT} fields, client has ${table.fieldCount}`);
        }

        return table;
    }

    /**
     * Parses every spell once.
     *
     * Only the handful of fields a tooltip needs are kept — holding 49,000 rows of 234 fields
     * would be tens of megabytes for no purpose.
     */
    load()
    {
        if (this.cache)
        {
            return this.cache;
        }

        const spellTable = this.read('Spell.dbc', SPELL);
        const castTable = this.read('SpellCastTimes.dbc', CAST_TIME);
        const rangeTable = this.read('SpellRange.dbc', RANGE);
        const durationTable = this.read('SpellDuration.dbc', DURATION);
        const iconTable = this.read('SpellIcon.dbc', ICON);

        const castTimes = new Map(castTable.map((r) => [r.int(CAST_TIME.ID), r.int(CAST_TIME.Base)]));
        const durations = new Map(durationTable.map((r) => [r.int(DURATION.ID), r.int(DURATION.Duration)]));

        const ranges = new Map(rangeTable.map((r) => [r.int(RANGE.ID), {
            max: r.float(RANGE.RangeMax0),
            name: r.string(RANGE.DisplayName)
        }]));

        /*
         * SpellIcon.dbc stores a full texture path; the icon's own name is the last segment, which
         * is what the icon index and the picker use.
         */
        const icons = new Map(iconTable.map((r) =>
        {
            const file = r.string(ICON.TextureFilename).replace(/\\/g, '/');
            return [r.int(ICON.ID), file.split('/').pop().toLowerCase()];
        }));

        const spells = spellTable.map((r) =>
        {
            const name = r.string(SPELL.Name);

            // Thousands of rows are internal triggers with no name; they are not searchable.
            if (!name)
            {
                return null;
            }

            return {
                id: r.int(SPELL.ID),
                name,
                rank: r.string(SPELL.NameSubtext),
                description: r.string(SPELL.Description),
                icon: icons.get(r.int(SPELL.SpellIconID)) || '',
                castTime: castTimes.get(r.int(SPELL.CastingTimeIndex)) || 0,
                cooldown: r.int(SPELL.RecoveryTime) || r.int(SPELL.CategoryRecoveryTime) || 0,
                duration: durations.get(r.int(SPELL.DurationIndex)) || 0,
                range: ranges.get(r.int(SPELL.RangeIndex)) || null,
                powerType: r.int(SPELL.PowerType),
                manaCost: r.int(SPELL.ManaCost),
                basePoints: SPELL.EffectBasePoints.map((i) => r.int(i)),
                dieSides: SPELL.EffectDieSides.map((i) => r.int(i))
            };
        }).filter(Boolean);

        this.cache = { spells, byId: new Map(spells.map((s) => [s.id, s])) };
        return this.cache;
    }

    /**
     * Fills in a description's $ variables as far as the DBC allows.
     *
     * These are templates, not finished sentences: Fireball's reads "causes $s1 Fire damage and an
     * additional $o2 Fire damage over $d". The ones that can be answered from Spell.dbc alone are
     * the effect values and the duration, so those are substituted.
     *
     * Everything else is left standing on purpose. Half of WoW's grammar reaches outside this
     * table — `$AP` is your attack power, `$<mult>` a scaling coefficient, `$23885d` another
     * spell's duration — and the arithmetic wrapper `${$m2*$<mult>}` cannot be evaluated without
     * them. Blanking those was the first attempt and it turned Frostbolt into "causing  to  Frost
     * damage": the sentence survived, the numbers vanished, and nothing said they had. Left in
     * place they are visibly unfinished and can be typed over, which is what this editor is for.
     */
    static fillDescription(spell)
    {
        if (!spell.description)
        {
            return '';
        }

        // The stored base is one below the minimum, which is why every tooltip adds one.
        const min = (i) => (spell.basePoints[i] || 0) + 1;
        const max = (i) => (spell.basePoints[i] || 0) + (spell.dieSides[i] || 0);

        const range = (i) =>
        {
            const sides = spell.dieSides[i] || 0;
            return sides > 1 ? `${min(i)} to ${max(i)}` : String(Math.abs(min(i)));
        };

        const duration = () =>
        {
            const seconds = spell.duration / 1000;

            if (!seconds) { return '$d'; }
            if (seconds >= 60) { return `${Math.round(seconds / 60)} min`; }

            return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(1)} sec`;
        };

        return spell.description
            .replace(/\$s([123])\b/g, (m, n) => range(Number(n) - 1))
            .replace(/\$m([123])\b/g, (m, n) => String(min(Number(n) - 1)))
            .replace(/\$M([123])\b/g, (m, n) => String(max(Number(n) - 1)))
            .replace(/\$d\b/g, duration)
            .replace(/\r\n/g, '\n')
            .trim();
    }

    /** The shape the editor fills its spell fields from. */
    static toEditor(spell)
    {
        const cost = spell.manaCost
            ? `${spell.manaCost} ${POWER_LABEL[spell.powerType] || 'Mana'}`
            : '';

        const range = spell.range && spell.range.max
            ? `${Math.round(spell.range.max)} yd range`
            : '';

        return {
            id: spell.id,
            name: spell.name,
            // The editor field holds the bare number and the renderer adds the word, so a
            // subtext of "Rank 1" is trimmed to "1" rather than coming out as "Rank Rank 1".
            rank: String(spell.rank || '').replace(/^rank\s+/i, ''),
            icon: spell.icon,
            cost,
            range,
            castTime: castLabel(spell.castTime),
            cooldown: cooldownLabel(spell.cooldown),
            description: Spells.fillDescription(spell)
        };
    }

    search(query, limit = 40)
    {
        const text = String(query || '').trim().toLowerCase();

        if (text.length < 2)
        {
            return [];
        }

        const { spells, byId } = this.load();

        // A numeric query is a spell id, which should win outright when it matches.
        if (/^\d+$/.test(text) && byId.has(Number(text)))
        {
            return [Spells.toEditor(byId.get(Number(text)))];
        }

        const starts = [];
        const contains = [];

        for (const spell of spells)
        {
            const lower = spell.name.toLowerCase();

            if (lower.startsWith(text)) { starts.push(spell); }
            else if (lower.includes(text)) { contains.push(spell); }

            if (starts.length >= limit) { break; }
        }

        return [...starts, ...contains]
            .slice(0, limit)
            .map(Spells.toEditor);
    }
}

module.exports = { Spells, SPELL, POWER_LABEL };
