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
        Attributes: 4,
        ProcChance: 35,
        ProcCharges: 36,
        DurationIndex: 40,
        PowerType: 41,
        ManaCost: 42,
        RangeIndex: 46,
        StackAmount: 49,

        /*
         * What a spell actually does, which is what a racial or a talent has to be read for.
         *
         * Effect says which of the hundred-odd effect kinds it is, ApplyAuraName says which aura
         * when the effect is "apply aura", and MiscValue says what the aura acts on — a stat index
         * for MOD_STAT, a school mask for MOD_RESISTANCE, a rating mask for MOD_RATING.
         *
         * EquippedItemClass and its subclass mask are the condition: the orc's expertise is worth
         * nothing without an axe in hand, and the client says so in data rather than in prose.
         */
        EquippedItemClass: 68,
        EquippedItemSubClassMask: 69,
        Effect: [71, 72, 73],
        EffectDieSides: [74, 75, 76],
        EffectBasePoints: [80, 81, 82],
        EffectRadiusIndex: [92, 93, 94],
        EffectApplyAuraName: [95, 96, 97],
        EffectAmplitude: [98, 99, 100],
        EffectChainTarget: [104, 105, 106],
        EffectMiscValue: [110, 111, 112],
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

/* SpellRadius.dbc: ID, Radius, RadiusPerLevel, RadiusMax. */
const RADIUS = { ID: 0, Radius: 1, COUNT: 4 };

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

        const radiusTable = this.read('SpellRadius.dbc', RADIUS);
        const radii = new Map(radiusTable.map((r) => [r.int(RADIUS.ID), r.float(RADIUS.Radius)]));

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
                dieSides: SPELL.EffectDieSides.map((i) => r.int(i)),
                effect: SPELL.Effect.map((i) => r.int(i)),
                aura: SPELL.EffectApplyAuraName.map((i) => r.int(i)),
                miscValue: SPELL.EffectMiscValue.map((i) => r.int(i)),
                itemClass: r.int(SPELL.EquippedItemClass),
                itemSubclassMask: r.int(SPELL.EquippedItemSubClassMask),

                /* The rest of a description's vocabulary: how often it ticks, how many it hits,
                   how high it stacks and how often it fires. */
                amplitude: SPELL.EffectAmplitude.map((i) => r.int(i)),
                chainTarget: SPELL.EffectChainTarget.map((i) => r.int(i)),
                radius: SPELL.EffectRadiusIndex.map((i) => radii.get(r.int(i)) || 0),
                stacks: r.int(SPELL.StackAmount),
                procChance: r.int(SPELL.ProcChance),
                procCharges: r.int(SPELL.ProcCharges),
                attributes: r.int(SPELL.Attributes)
            };
        }).filter(Boolean);

        this.cache = { spells, byId: new Map(spells.map((s) => [s.id, s])) };
        return this.cache;
    }

    /**
     * Fills in a description's $ variables as far as the DBC allows.
     *
     * These are templates, not finished sentences: Fireball's reads "causes $s1 Fire damage and an
     * additional $o2 Fire damage over $d". Everything the client answers from the spell tables is
     * substituted here; what it answers from the character at cast time is left standing.
     *
     * The grammar, worked out by counting what the 2,243 talent rank descriptions actually use:
     *
     *   $s1 $m1 $M1   the effect's value, its minimum, its maximum
     *   $o1           the whole of a periodic effect: the tick times how many ticks fit the duration
     *   $d $t1        the duration, and how often it ticks
     *   $a1 $n $u $h  radius, chain targets, stack size, proc chance
     *   $12721d       any of the above belonging to another spell, named by id
     *   $/10;s1       the next variable divided by a number
     *   ${...}        arithmetic over the above
     *   $lsec:secs;   the singular or plural form, chosen by the number just printed
     *
     * Left alone on purpose: `$AP`, `$SP`, `$RAP`, `$SPH` and `$<mult>` are the character's own
     * numbers and script coefficients, which no table here holds. Blanking those was tried and it
     * turned Frostbolt into "causing  to  Frost damage" — the sentence survived, the numbers
     * vanished, and nothing said they had. Left in place they are visibly unfinished.
     */
    static fillDescription(spell, byId)
    {
        if (!spell.description)
        {
            return '';
        }

        const find = (id) => (id ? (byId ? byId.get(Number(id)) : null) : spell);

        /* The stored base is one below the minimum, which is why every tooltip adds one. */
        const min = (s, i) => (s.basePoints[i] || 0) + 1;
        const max = (s, i) => (s.basePoints[i] || 0) + (s.dieSides[i] || 0);

        const seconds = (ms) =>
        {
            const value = ms / 1000;

            return Number.isInteger(value) ? String(value) : value.toFixed(1);
        };

        /**
         * One variable's value as a number, or null when this table cannot answer it.
         *
         * `index` is the effect it belongs to, one-based in the text and zero-based here.
         */
        const value = (s, letter, index) =>
        {
            const i = Math.max(0, (Number(index) || 1) - 1);

            if (!s)
            {
                return null;
            }

            switch (letter)
            {
                case 's':
                {
                    const sides = s.dieSides[i] || 0;

                    return sides > 1 ? null : Math.abs(min(s, i));
                }

                case 'm': return min(s, i);
                case 'M': return max(s, i);

                /* A periodic effect's whole: the per-tick value times the number of ticks. */
                case 'o':
                {
                    const tick = s.amplitude[i] || 0;

                    return tick ? Math.abs(min(s, i)) * Math.floor(s.duration / tick) : null;
                }

                case 'd': return s.duration ? Number(seconds(s.duration)) : null;
                case 't': return s.amplitude[i] ? Number(seconds(s.amplitude[i])) : null;
                case 'a': return s.radius[i] ? Math.round(s.radius[i]) : null;

                /*
                 * Chain targets where there are any, otherwise the charge count. "Your next $n
                 * melee attacks" is Sweeping Strikes, which chains nothing and carries its number
                 * as charges instead.
                 */
                case 'n': return s.chainTarget[i] || s.procCharges || null;

                case 'u': return s.stacks || null;
                case 'h': return s.procChance || null;
                default: return null;
            }
        };

        /* A range reads as "12 to 15" rather than a single number, and only $s prints one. */
        const spread = (s, i) =>
        {
            const sides = s.dieSides[i] || 0;

            return sides > 1 ? `${min(s, i)} to ${max(s, i)}` : null;
        };

        /**
         * One `$` token, resolved.
         *
         * The shapes are `$<id>?<letter><index>?`, optionally preceded by `/<divisor>;`. Returns a
         * string, or null to leave the token exactly as it was found.
         */
        const round = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10));

        const token = (text, units) =>
        {
            const m = text.match(/^\$(?:([/*])(\d+);)?(\d+)?([smMotdanuhSODTANUH])([123])?$/);

            if (!m)
            {
                return null;
            }

            const [, operator, operand, id, raw, index] = m;

            /*
             * The variable letter is case-insensitive - `$/1000;S1` and `$s1` are the same
             * variable - except for min and max, which the client distinguishes by case alone.
             */
            const letter = raw === 'M' ? 'M' : raw.toLowerCase();
            const s = find(id);

            if (!s)
            {
                return null;
            }

            if (letter === 's' && !operator)
            {
                const range = spread(s, Math.max(0, (Number(index) || 1) - 1));

                if (range)
                {
                    return range;
                }
            }

            const found = value(s, letter, index);

            if (found === null)
            {
                return null;
            }

            let out = found;

            if (operator === '/') { out = found / Number(operand); }
            if (operator === '*') { out = found * Number(operand); }

            /*
             * A time reads with its unit when it stands in a sentence and as a bare number when it
             * is inside arithmetic - "lasts 8 sec" against "${$d*2}".
             */
            if (units && (letter === 'd' || letter === 't'))
            {
                return out >= 60 && Number.isInteger(out / 60)
                    ? `${out / 60} min`
                    : `${round(out)} sec`;
            }

            return round(out);
        };

        const VARIABLE = /\$(?:[/*]\d+;)?\d*[smMotdanuhSODTANUH][123]?/g;

        let text = spell.description.replace(/\r\n/g, '\n');

        /*
         * Arithmetic first, and with bare numbers rather than units, so `${$d*2}` has something to
         * multiply. Only expressions that come out entirely numeric are evaluated - one still
         * holding `$AP` is left whole rather than half-finished.
         */
        text = text.replace(/\$\{([^{}]*)\}/g, (found, body) =>
        {
            const filled = body.replace(VARIABLE, (one) =>
            {
                const answer = token(one, false);

                return answer === null ? one : answer;
            });

            if (!/^[\d\s+\-*/().]+$/.test(filled))
            {
                return `\${${filled}}`;
            }

            try
            {
                /* eslint-disable-next-line no-new-func */
                const out = Function(`"use strict"; return (${filled});`)();

                return Number.isFinite(out) ? round(out) : `\${${filled}}`;
            }
            catch
            {
                return `\${${filled}}`;
            }
        });

        /* Then everything standing on its own, which is where a time wants its unit. */
        text = text.replace(VARIABLE, (found) =>
        {
            const answer = token(found, true);

            return answer === null ? found : answer;
        });

        /*
         * Last, the singular and plural pairs: `$lsecond:seconds;` prints one or the other, decided
         * by the number immediately before it, which by now is a real number.
         */
        text = text.replace(/(\d+(?:\.\d+)?)([^$]*)\$l([^:;]*):([^;]*);/g,
            (found, number, between, one, many) =>
                `${number}${between}${Number(number) === 1 ? one : many}`);

        return text.trim();
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
            description: Spells.fillDescription(spell, this.load().byId)
        };
    }

    /**
     * One spell's description, filled in, or an empty string.
     *
     * The item window needs this: an item's Equip and Use lines are the description of the
     * spell hanging off it, and nothing but Spell.dbc has that text.
     */
    describe(id)
    {
        const spell = this.load().byId.get(Number(id));

        const { byId } = this.load();

        return spell ? Spells.fillDescription(spell, byId) : '';
    }

    /**
     * What a talent needs to draw itself: the name over the icon and the text under it.
     *
     * A talent is a spell per rank, so this is asked for each of them - the rank the pointer is on
     * is the description that should be showing, not always rank one's.
     */
    info(id)
    {
        const spell = this.load().byId.get(Number(id));

        if (!spell)
        {
            return null;
        }

        return {
            id: spell.id,
            name: spell.name,
            rank: spell.rank,
            icon: spell.icon,
            description: Spells.fillDescription(spell, this.load().byId)
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
