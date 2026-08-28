'use strict';

/*
 * What an aura is worth on a character sheet.
 *
 * A racial and a talent are the same thing to the client: a passive spell whose effects apply
 * auras. Reading either means asking, for each of a spell's three effects, "is this an aura, which
 * one, and what does it act on" — so one map serves both, and the Armory needs no hand-written
 * list of what Endurance or Anticipation happens to do.
 *
 * The ids are AzerothCore's own `AuraType`, read out of SpellAuraDefines.h rather than remembered.
 * About twenty-five of the three hundred matter here, because the scope rule still applies: an
 * aura that moves nothing the character sheet displays is not worth naming. Everything else on a
 * racial line is an active - Blood Fury, Shadowmeld, War Stomp, Arcane Torrent - and belongs in
 * the list marked as changing nothing rather than in the maths.
 *
 * **Base points are one below the number the game shows.** Axe Specialization stores 4 and grants
 * 5 expertise; Gun Specialization stores 0 and grants 1% crit; Quickness stores -3 and reads as
 * 2%. A first pass that trusts the raw field is wrong by exactly one everywhere and still looks
 * plausible, which is the worst way for it to be wrong.
 */

/*
 * The two effects that carry an aura worth reading.
 *
 * 6 is APPLY_AURA and 35 is APPLY_AREA_AURA_PARTY. The second is here because of Heroic Presence,
 * whose 3.3.5a row is still the party version even though the draenei version by Wrath is the self
 * one - its description says "for you and all party members" and the effect agrees, and both are
 * out of date. Reading only effect 6 loses the draenei their one percent hit.
 */
const APPLY_AURA = 6;
const APPLY_AREA_AURA_PARTY = 35;

/** SPELL_ATTR0_PASSIVE, out of the core's SharedDefines.h. */
const PASSIVE = 0x40;

/** AuraType, the two dozen that reach the sheet. */
const AURA = {
    MOD_DAMAGE_DONE: 13,
    MOD_RESISTANCE: 22,
    MOD_STAT: 29,
    MOD_INCREASE_HEALTH: 34,
    MOD_PARRY_PERCENT: 47,
    MOD_DODGE_PERCENT: 49,
    MOD_BLOCK_PERCENT: 51,
    MOD_WEAPON_CRIT_PERCENT: 52,
    MOD_HIT_CHANCE: 54,
    MOD_SPELL_HIT_CHANCE: 55,
    MOD_SPELL_CRIT_CHANCE: 57,
    MOD_POWER_REGEN: 85,
    MOD_ATTACK_POWER: 99,
    MOD_RESISTANCE_PCT: 101,
    MOD_TARGET_RESISTANCE: 123,
    MOD_RANGED_ATTACK_POWER: 124,
    MOD_TOTAL_STAT_PERCENTAGE: 137,
    MOD_MELEE_HASTE: 138,
    MOD_BASE_RESISTANCE_PCT: 142,
    MOD_SHIELD_BLOCKVALUE: 158,
    MOD_ATTACK_POWER_PCT: 166,
    MOD_RATING: 189,
    MOD_EXPERTISE: 240,
    MOD_BASE_HEALTH_PCT: 282
};

/** MiscValue for the stat auras: -1 is every stat at once. */
const STAT_BY_INDEX = ['str', 'agi', 'sta', 'int', 'spi'];

/*
 * MiscValue for the school auras is a mask over SpellSchools: normal, holy, fire, nature, frost,
 * shadow, arcane. Bit 0 is physical, which on a character sheet is armor rather than a school, and
 * holy is nameless here because players have no holy resistance and the paper doll has no line for
 * it - the same call lib/items.js makes about the sixth column of item_template.
 */
const SCHOOL_BY_BIT = [null, null, 'fire', 'nature', 'frost', 'shadow', 'arcane'];

/*
 * SPELL_AURA_MOD_RATING's MiscValue is a mask of CombatRating indices rather than one of them, so
 * a single effect can grant several ratings at once. Only the ones the sheet reads are named.
 */
const RATING_BY_BIT = {
    1: 'defense', 2: 'dodge', 3: 'parry', 4: 'blockRating',
    5: 'hit', 6: 'hit', 7: 'hit',
    8: 'crit', 9: 'crit', 10: 'crit',
    14: 'resilience',
    17: 'haste', 18: 'haste', 19: 'haste',
    23: 'expertise', 24: 'arp'
};

/** Each set bit of a mask, as its bit number. */
function bits(mask)
{
    const out = [];

    for (let bit = 0; bit < 32; bit++)
    {
        if (mask & (1 << bit))
        {
            out.push(bit);
        }
    }

    return out;
}

/**
 * One spell's effects, as a list of what they are worth.
 *
 * Each entry is `{ to, value, percent }` - the name of the thing it moves, by how much, and
 * whether that is a multiplier rather than an addition. `condition` carries the weapon the effect
 * waits for, when it waits for one.
 *
 * `rank` scales nothing here: a talent's ranks are separate spells with their own base points, so
 * the caller passes the spell of the rank that is actually spent.
 */
function auraStats(spell)
{
    /*
     * Passive spells only, which is the line between a racial that is always on and one you press.
     *
     * Blood Fury carries two attack power auras and is worth nothing on a character sheet: it is a
     * two-minute cooldown, and reading its auras put six attack power on an orc who was not using
     * it. `SPELL_ATTR0_PASSIVE` is how the core tells them apart, so it is how this does.
     */
    if (!spell || !(spell.attributes & PASSIVE))
    {
        return [];
    }

    const out = [];
    const condition = spell.itemClass > 0
        ? { itemClass: spell.itemClass, subclassMask: spell.itemSubclassMask }
        : null;

    const add = (to, value, percent) =>
    {
        if (to && value)
        {
            out.push({ to, value, percent: !!percent, condition });
        }
    };

    for (let i = 0; i < 3; i++)
    {
        if (spell.effect[i] !== APPLY_AURA && spell.effect[i] !== APPLY_AREA_AURA_PARTY)
        {
            continue;
        }

        const aura = spell.aura[i];
        const misc = spell.miscValue[i];

        /* The stored base is one below what the game shows, everywhere. */
        const value = (spell.basePoints[i] || 0) + 1;

        switch (aura)
        {
            case AURA.MOD_STAT:
            case AURA.MOD_TOTAL_STAT_PERCENTAGE:
            {
                const percent = aura === AURA.MOD_TOTAL_STAT_PERCENTAGE;
                const names = misc < 0 ? STAT_BY_INDEX : [STAT_BY_INDEX[misc]];

                for (const name of names)
                {
                    add(name, value, percent);
                }

                break;
            }

            case AURA.MOD_RESISTANCE:
            case AURA.MOD_RESISTANCE_PCT:
            case AURA.MOD_BASE_RESISTANCE_PCT:
            {
                const percent = aura !== AURA.MOD_RESISTANCE;

                for (const bit of bits(misc))
                {
                    /* Bit 0 is physical, and physical resistance is armor. */
                    add(bit === 0 ? 'armor' : SCHOOL_BY_BIT[bit], value, percent);
                }

                break;
            }

            case AURA.MOD_RATING:
                for (const bit of bits(misc))
                {
                    add(RATING_BY_BIT[bit], value, false);
                }

                break;

            /*
             * Spell power is a damage-done aura with a school mask. Only its size is read, not
             * which schools: the sheet has one spell power line, the way Wrath's does since 3.0
             * folded the per-school ones together.
             */
            case AURA.MOD_DAMAGE_DONE:
                add('spellPower', value, false);
                break;

            case AURA.MOD_INCREASE_HEALTH: add('health', value, false); break;
            case AURA.MOD_BASE_HEALTH_PCT: add('health', value, true); break;
            case AURA.MOD_PARRY_PERCENT: add('parry', value, false); break;
            case AURA.MOD_DODGE_PERCENT: add('dodge', value, false); break;
            case AURA.MOD_BLOCK_PERCENT: add('block', value, false); break;
            case AURA.MOD_SHIELD_BLOCKVALUE: add('blockValue', value, false); break;

            /* One aura for melee and ranged crit, which is how the game grants it. */
            case AURA.MOD_WEAPON_CRIT_PERCENT: add('meleeCrit', value, false); break;
            case AURA.MOD_SPELL_CRIT_CHANCE: add('spellCrit', value, false); break;
            case AURA.MOD_HIT_CHANCE: add('meleeHit', value, false); break;
            case AURA.MOD_SPELL_HIT_CHANCE: add('spellHit', value, false); break;
            case AURA.MOD_MELEE_HASTE: add('meleeHaste', value, false); break;
            case AURA.MOD_ATTACK_POWER: add('attackPower', value, false); break;
            case AURA.MOD_ATTACK_POWER_PCT: add('attackPower', value, true); break;
            case AURA.MOD_RANGED_ATTACK_POWER: add('rangedPower', value, false); break;
            case AURA.MOD_EXPERTISE: add('expertise', value, false); break;

            /* Mana regen only. The other power types have no line on this sheet. */
            case AURA.MOD_POWER_REGEN:
                if (misc === 0)
                {
                    add('manaRegen', value, false);
                }

                break;

            /* Spell penetration is stored as the reduction it makes to the target. */
            case AURA.MOD_TARGET_RESISTANCE:
                if (value < 0)
                {
                    add('spellPen', -value, false);
                }

                break;

            default:
                break;
        }
    }

    return out;
}

/** Whether a weapon condition is satisfied by what is equipped. */
function conditionMet(condition, weapons)
{
    if (!condition)
    {
        return true;
    }

    return (weapons || []).some((w) =>
        w.itemClass === condition.itemClass && (condition.subclassMask & (1 << w.subclass)));
}

module.exports = { auraStats, conditionMet, AURA, APPLY_AURA };
