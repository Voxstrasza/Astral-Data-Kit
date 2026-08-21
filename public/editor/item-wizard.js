'use strict';

/*
 * The item wizard: the tier maths, pointed at whatever the Item window is showing.
 *
 * Two directions, which are the two halves of the same question.
 *
 *   Generate — pick a tier and a role, and get the stat block an item of that tier is allowed to
 *   have, laid out in the proportions real gear of that role uses.
 *
 *   Price — take what is in the editor already and say what item level it really is. This is the
 *   honest half: the Item level field is a claim anyone can type, and the budget the stats cost is
 *   the fact. Loading a real drop out of the finder and pricing it should land on the tier it came
 *   from, which is also how the maths was checked.
 *
 * The slot and the socket count are read from the editor rather than asked for twice — sockets are
 * paid for out of the same budget, so what is on screen is what gets priced.
 */

import { $ } from './dom.js';
import { api, postJson } from './api.js';
import { state } from './state.js';
import { status, update } from './preview.js';
import { syncForm } from './form.js';
import { renderLists } from './lists.js';

let described = null;

/** The tier list and role list, read once from the client's own budget table. */
async function describe()
{
    if (described)
    {
        return described;
    }

    described = await api('api/budget/describe');

    return described;
}

function setNote(text, tone)
{
    const note = $('#wizard-note');

    if (!note)
    {
        return;
    }

    note.textContent = text || '';
    note.className = `hint wizard-note${tone ? ` ${tone}` : ''}`;
}

/** The roles that hold a caster weapon, which is what decides its damage curve. */
const CASTER_ROLES = ['caster-dps', 'healer'];

/** Everything the two calls need from the editor as it stands. */
function context()
{
    return {
        slot: state.slot || 'Chest',
        sockets: (state.sockets || []).length,
        quality: Number(state.quality) || 4
    };
}

/** Which secondaries are ticked, if any. */
function chosenSecondaries()
{
    return [...document.querySelectorAll('#wizard-secondaries input[type="checkbox"]')]
        .filter((box) => box.checked)
        .map((box) => box.dataset.secondary);
}

/**
 * The weapon half of the request, or nothing for armour.
 *
 * A weapon spends part of its allowance on damage, so generating one without saying so hands it
 * an armour-sized stat block on top of a weapon's damage — which is what the first version did.
 * Whether it is a caster weapon comes from the role, since that is the same choice: a staff for a
 * mage carries a third of the damage and three times the stats of one for a warrior.
 */
function weaponQuery(role)
{
    if (!state.hasWeapon)
    {
        return '';
    }

    const type = (state.itemType || '').toLowerCase();

    return '&weapon=1'
        + `&caster=${CASTER_ROLES.includes(role) ? 1 : 0}`
        + `&wand=${type === 'wand' ? 1 : 0}`
        + `&thrown=${type === 'thrown' ? 1 : 0}`
        + `&speed=${Number(state.speed) || 2.6}`;
}

async function generate()
{
    const { slot, sockets, quality } = context();
    const ilvl = Number($('#wizard-tier').value);
    const role = $('#wizard-role').value;
    const secondaries = chosenSecondaries();

    try
    {
        const made = await api(
            `api/budget/generate?ilvl=${ilvl}&slot=${encodeURIComponent(slot)}&role=${encodeURIComponent(role)}`
            + `&sockets=${sockets}&quality=${quality}`
            + (secondaries.length ? `&secondaries=${secondaries.join(',')}` : '')
            + weaponQuery(role));

        if (made.error)
        {
            setNote(`Could not generate: ${made.error}`, 'bad');
            return;
        }

        /*
         * Only the stat block is replaced.
         *
         * Everything that makes the item that item — its name, icon, slot, sockets, binding,
         * flavour — is left exactly as it is, so generating over a loaded drop retunes it rather
         * than emptying it.
         */
        state.stats = made.editor.stats;
        state.effects = made.editor.effects;
        state.itemLevel = made.ilvl;

        /*
         * A weapon's damage is part of what the budget just decided, so it is written too — but
         * only its level, not its shape. An item that already has a damage range keeps how wide
         * that range is: two weapons of the same dps can swing 895-1344 or 784-1455, and which one
         * an item is has nothing to do with its budget.
         */
        if (made.weapon)
        {
            const low = Number(state.dmgMin) || 0;
            const high = Number(state.dmgMax) || 0;
            const mid = (low + high) / 2;
            const spread = mid > 0 ? (high - low) / (2 * mid) : 0.3;

            const mean = made.weapon.dps * made.weapon.speed;

            state.dmgMin = Math.round(mean * (1 - spread));
            state.dmgMax = Math.round(mean * (1 + spread));
            state.speed = made.weapon.speed;
        }

        syncForm();
        renderLists();
        update();

        const socketLine = made.sockets
            ? `, less ${made.socketCost} for ${made.sockets} socket${made.sockets === 1 ? '' : 's'}`
            : '';

        const damageLine = made.damagePoints
            ? `, plus ${made.damagePoints} for carrying ${made.weapon.dps} dps rather than a melee weapon's`
            : '';

        setNote(
            `${made.points} random-property points x ${made.multiplier}${damageLine}${socketLine} `
            + `= ${made.budget} points, spent as a ${made.roleName.toLowerCase()} ${made.slot.toLowerCase()}.`);

        status(`Generated ilvl ${made.ilvl} ${made.slot} — ${made.budget} points of ${made.roleName}`);
    }
    catch (err)
    {
        setNote(`Could not generate: ${err.message}`, 'bad');
    }
}

/** The same weapon description as the query string, in the shape identify() takes. */
function weaponBody(role)
{
    if (!state.hasWeapon)
    {
        return null;
    }

    const type = (state.itemType || '').toLowerCase();
    const speed = Number(state.speed) || 2.6;
    const mid = ((Number(state.dmgMin) || 0) + (Number(state.dmgMax) || 0)) / 2;

    return {
        caster: CASTER_ROLES.includes(role),
        wand: type === 'wand',
        thrown: type === 'thrown',
        speed,
        /* Its real dps, since that is what decides how much of the budget went on damage. */
        dps: speed > 0 && mid > 0 ? mid / speed : 0
    };
}

async function price()
{
    const { slot, sockets, quality } = context();

    if (!(state.stats || []).length && !(state.effects || []).length)
    {
        setNote('Nothing to price yet — generate a block, or load an item from the finder.', 'bad');
        return;
    }

    try
    {
        const answer = await postJson('api/budget/identify', {
            stats: state.stats,
            effects: state.effects,
            slot,
            sockets,
            quality,
            weapon: weaponBody($('#wizard-role').value)
        });

        if (answer.error)
        {
            setNote(`Could not price it: ${answer.error}`, 'bad');
            return;
        }

        const tier = answer.tier ? `${answer.tier.tier ? `${answer.tier.tier}, ` : ''}${answer.tier.source}` : '';
        const typed = Number(state.itemLevel) || 0;

        /*
         * The interesting sentence is the disagreement, so it leads when there is one. A couple of
         * percent either way is ordinary — half of all real items sit inside 1.7% — so only a real
         * gap is worth calling out.
         */
        const drift = Math.abs(answer.offBy) < 2.5
            ? 'which is right on budget'
            : `${Math.abs(answer.offBy)}% ${answer.offBy > 0 ? 'over' : 'under'} that budget`;

        const mismatch = typed && typed !== answer.ilvl
            ? ` The Item level field says ${typed}.`
            : '';

        setNote(
            `${answer.cost} points of stats — that is item level ${answer.ilvl}, ${drift}.`
            + (tier ? ` ${tier}.` : '') + mismatch,
            typed && typed !== answer.ilvl ? 'warn' : ''
        );

        status(`Priced at ${answer.cost} points — ilvl ${answer.ilvl}`);
    }
    catch (err)
    {
        setNote(`Could not price it: ${err.message}`, 'bad');
    }
}

/**
 * Points the Tier picker at whatever the editor is holding.
 *
 * Loading a real ilvl 277 drop and pressing Generate used to hand back an ilvl 264 block, because
 * the picker kept whatever it was last set to and generate() writes the item level it generated
 * for. Following the item means Generate retunes what is on screen instead of quietly demoting it.
 */
function syncTier()
{
    const picker = $('#wizard-tier');
    const ilvl = Number(state.itemLevel);

    if (!picker || !ilvl)
    {
        return;
    }

    const levels = [...picker.options].map((option) => Number(option.value));
    const exact = levels.find((level) => level === ilvl);

    /* Not every item level is a tier — an ilvl 245 quest reward and a T9 drop share a row. */
    const nearest = exact || levels.filter((level) => level <= ilvl).pop() || levels[0];

    picker.value = String(nearest);
}

async function bindItemWizard()
{
    const tier = $('#wizard-tier');

    if (!tier)
    {
        return;
    }

    let info;

    try
    {
        info = await describe();
    }
    catch
    {
        setNote('Point at your 3.3.5a folder in Settings — the tier table is read from the client.', 'bad');
        return;
    }

    if (info.error)
    {
        setNote('Point at your 3.3.5a folder in Settings — the tier table is read from the client.', 'bad');
        return;
    }

    for (const entry of info.tiers)
    {
        const option = document.createElement('option');
        option.value = entry.ilvl;
        option.textContent = `${entry.ilvl}${entry.tier ? ` · ${entry.tier}` : ''} — ${entry.source}`;
        tier.appendChild(option);
    }

    /* T10 25-man is the tier most custom gear is built against, so it opens there. */
    tier.value = '264';

    const roles = $('#wizard-role');

    for (const role of info.roles)
    {
        const option = document.createElement('option');
        option.value = role.id;
        option.textContent = role.name;
        roles.appendChild(option);
    }

    $('#btn-wizard-generate').addEventListener('click', generate);
    $('#btn-wizard-price').addEventListener('click', price);
}

export { bindItemWizard, generate, price, syncTier };
