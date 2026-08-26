'use strict';

/*
 * The Armory: a character sheet with no character drawn in it.
 *
 * What is here is phase 1 and the shape of the page. The numbers it fills in are the ones that
 * need no gear - the five base stats, what agility and intellect buy in crit, and mana regen from
 * spirit - and every other cell on the sheet is drawn empty so the finished thing is visible
 * before it is finished. The nineteen slots are drawn and do not take an item yet.
 *
 * Everything it reads is the client's own, through /api/character, so it works with no database
 * configured. See TODO.md for the phases and what each one adds.
 */

import { $, el } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';

/*
 * The paper doll's own arrangement. Taking the model out is what lets the two columns sit beside
 * each other instead of down either side of it.
 */
const LEFT = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Shirt', 'Tabard', 'Wrist'];
const RIGHT = ['Hands', 'Waist', 'Legs', 'Feet', 'Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2'];
const WEAPONS = ['Main hand', 'Off hand', 'Ranged'];

/*
 * The sheet, six to a row, grouped the way the game groups them.
 *
 * `key` is what the API answers with; a cell without one is a stat that needs the gear pipeline
 * and draws as a dash until phase 2 builds it.
 */
const SHEET = [
    { label: 'Health' }, { label: 'Mana' },
    { label: 'Strength', key: 'str' }, { label: 'Agility', key: 'agi' },
    { label: 'Stamina', key: 'sta' }, { label: 'Intellect', key: 'int' },

    { label: 'Spirit', key: 'spi' }, { label: 'Armor' },
    { label: 'Attack power' }, { label: 'Ranged power' },
    { label: 'Spell power' }, { label: 'Mana regen', key: 'manaRegen', suffix: ' /5s', places: 1 },

    { label: 'Melee crit', key: 'meleeCrit', suffix: '%', places: 2 },
    { label: 'Spell crit', key: 'spellCrit', suffix: '%', places: 2 },
    { label: 'Melee hit' }, { label: 'Spell hit' },
    { label: 'Melee haste' }, { label: 'Spell haste' },

    { label: 'Expertise' }, { label: 'Armor pen' }, { label: 'Dodge' },
    { label: 'Parry' }, { label: 'Block' }, { label: 'Defense' },

    { label: 'Resilience' }, { label: 'Arcane' }, { label: 'Fire' },
    { label: 'Frost' }, { label: 'Nature' }, { label: 'Shadow' }
];

let setup = null;
let bound = false;

/** An option element. The shared select() builder wires its own handler, so this is by hand. */
function option(value, label, selected)
{
    const node = el('option', '', label);

    node.value = String(value);
    node.selected = selected;

    return node;
}

/** One empty slot: a box that will take an item, drawn with the name of what belongs in it. */
function slotBox(name)
{
    const box = el('button', 'slot');

    box.type = 'button';
    box.disabled = true;
    box.title = `${name} - slots take an item in a later phase`;
    box.append(el('span', 'slot-icon'), el('span', 'slot-name', name));

    return box;
}

function drawSlots()
{
    for (const [id, names] of [['left', LEFT], ['right', RIGHT], ['weapon', WEAPONS]])
    {
        const host = $(`#armory-slots-${id}`);

        host.replaceChildren(...names.map(slotBox));
    }
}

/** The race list, and the classes that race can be, both straight out of the client. */
function fillPickers()
{
    const raceSelect = $('#armory-race');
    const classSelect = $('#armory-class');

    raceSelect.replaceChildren(...setup.races.map(
        (r) => option(r.id, r.name, r.id === state.armoryRace)));

    const race = setup.races.find((r) => r.id === state.armoryRace) || setup.races[0];

    state.armoryRace = race.id;
    raceSelect.value = String(race.id);

    /* A race cannot be a class the client does not pair it with, so the list is filtered rather
       than validated after the fact. */
    const allowed = setup.classes.filter((c) => race.classes.includes(c.id));

    if (!allowed.some((c) => c.id === state.armoryClass))
    {
        state.armoryClass = allowed[0].id;
    }

    classSelect.replaceChildren(...allowed.map(
        (c) => option(c.id, c.name, c.id === state.armoryClass)));

    classSelect.value = String(state.armoryClass);

    showWho();
    clampLevel();
}

/**
 * Who the character is, which is for the exported picture rather than for the numbers.
 *
 * The guild line is off by default and its field only appears when it is wanted, the same way the
 * target frame keeps its second bar hidden until a creature has one.
 */
function showWho()
{
    $('#armory-name').value = state.armoryName || '';
    $('#armory-guild').value = state.armoryGuild || '';
    $('#armory-guild-on').checked = !!state.armoryGuildShow;
    $('#armory-guild').hidden = !state.armoryGuildShow;
}

/** Death knights start at 55, so the level field says so rather than answering with an error. */
function clampLevel()
{
    const floor = state.armoryClass === 6 ? 55 : 1;
    const input = $('#armory-level');

    input.min = String(floor);
    state.armoryLevel = Math.min(80, Math.max(floor, Number(state.armoryLevel) || 80));
    input.value = String(state.armoryLevel);
}

function cell(entry, sheet)
{
    const value = entry.key
        ? (sheet.stats[entry.key] !== undefined ? sheet.stats[entry.key] : sheet[entry.key])
        : undefined;

    const box = el('div', value === undefined ? 'stat pending' : 'stat');

    box.append(el('span', 'stat-label', entry.label));
    box.append(el('span', 'stat-value', value === undefined
        ? '-'
        : `${entry.places ? value.toFixed(entry.places) : Math.round(value)}${entry.suffix || ''}`));

    return box;
}

async function refresh()
{
    if (!setup)
    {
        return;
    }

    const sheet = await api(
        `/api/character/sheet?race=${state.armoryRace}&class=${state.armoryClass}&level=${state.armoryLevel}`);

    if (sheet.error)
    {
        $('#armory-stat-note').textContent = sheet.error;
        return;
    }

    $('#armory-stat-grid').replaceChildren(...SHEET.map((entry) => cell(entry, sheet)));

    /*
     * Base health is not health: what stamina adds to it is part of the pipeline that does not
     * exist yet. Saying so beats printing 8121 into a Health box and being wrong by a thousand.
     */
    $('#armory-stat-note').textContent =
        `Base health ${sheet.baseHealth.toLocaleString()}`
        + (sheet.baseMana ? `, base mana ${sheet.baseMana.toLocaleString()}` : '')
        + '. The dashed values, and what stamina and intellect add to the pools, arrive with the'
        + ' gear pipeline.';
}

function empty()
{
    const note = el('td', 'hint', 'Nothing equipped. Slots take an item in a later phase.');
    const line = el('tr');

    note.colSpan = 4;
    line.append(note);
    $('#armory-equipped').replaceChildren(line);
}

/**
 * Called at start-up, and again whenever the client folder changes underneath us.
 *
 * The pickers are rebuilt every time; the handlers are bound once, since binding them twice would
 * run every change through the whole refresh two deep.
 */
async function initArmory()
{
    drawSlots();
    empty();

    try
    {
        setup = await api('/api/character/setup');
    }
    catch
    {
        setup = null;
    }

    if (!setup || setup.error)
    {
        $('#armory-stat-note').textContent = setup && setup.error
            ? setup.error
            : 'Point Astral at your 3.3.5a folder in Settings to fill this in.';
        setup = null;
        return;
    }

    fillPickers();
    await refresh();

    if (bound)
    {
        return;
    }

    bound = true;

    $('#armory-race').addEventListener('change', (e) =>
    {
        state.armoryRace = Number(e.target.value);
        fillPickers();
        refresh();
    });

    $('#armory-class').addEventListener('change', (e) =>
    {
        state.armoryClass = Number(e.target.value);
        showWho();
        clampLevel();
        refresh();
    });

    $('#armory-name').addEventListener('input', (e) =>
    {
        state.armoryName = e.target.value;
    });

    $('#armory-guild').addEventListener('input', (e) =>
    {
        state.armoryGuild = e.target.value;
    });

    $('#armory-guild-on').addEventListener('change', (e) =>
    {
        state.armoryGuildShow = e.target.checked;
        $('#armory-guild').hidden = !e.target.checked;
    });

    $('#armory-level').addEventListener('change', (e) =>
    {
        state.armoryLevel = Number(e.target.value);
        clampLevel();
        refresh();
    });
}

export { initArmory };
