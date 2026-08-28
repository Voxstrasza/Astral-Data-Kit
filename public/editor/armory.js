'use strict';

/*
 * The Armory: a character sheet with no character drawn in it.
 *
 * You pick a race, a class and a level, fill the nineteen slots, and read out the stat block that
 * character would really have. Clicking a slot opens a picker over two sources: the database,
 * filtered so a search from the boots slot cannot answer with a helm, and the pieces you invented
 * yourself, filtered the same way by the slot a saved item already carries.
 *
 * The numbers are not computed here. `sheet()` in lib/character.js does that, over the gear
 * `equipped()` adds up, and this posts what is worn and draws what comes back.
 *
 * The base of it reads the client rather than a database, so a character with nothing on it works
 * with no database configured; only the database half of the picker needs one. See TODO.md for the
 * phases and what each one adds.
 */

import { $, el } from './dom.js';
import { api, postJson } from './api.js';
import { state, effectText } from './state.js';
import { iconUrl } from './icons.js';
import { M, R } from './wow.js';
import { openTalents, talentSummary, clearTalents } from './talents.js';

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
 * `key` is what the API answers with, looked for among the five primaries, the five schools and
 * then the sheet itself. A cell whose key the sheet does not carry draws as a dash rather than a
 * zero, which is how a warrior's mana reads when every stat is shown.
 */
const SHEET = [
    { label: 'Health', key: 'health', tag: 'core' },
    { label: 'Mana', key: 'mana', tag: 'mana' },
    { label: 'Strength', key: 'str', tag: 'core' },
    { label: 'Agility', key: 'agi', tag: 'core' },
    { label: 'Stamina', key: 'sta', tag: 'core' },
    { label: 'Intellect', key: 'int', tag: 'mana' },
    { label: 'Spirit', key: 'spi', tag: 'mana' },
    { label: 'Armor', key: 'armor', tag: 'core' },

    { label: 'Attack power', key: 'attackPower', tag: 'melee' },
    { label: 'Melee crit', key: 'meleeCrit', suffix: '%', places: 2, tag: 'melee' },
    { label: 'Melee hit', key: 'meleeHit', suffix: '%', places: 2, tag: 'melee' },
    { label: 'Melee haste', key: 'meleeHaste', suffix: '%', places: 2, tag: 'melee' },
    { label: 'Expertise', key: 'expertise', tag: 'melee' },
    { label: 'Armor pen', key: 'armorPen', suffix: '%', places: 2, tag: 'melee' },

    { label: 'Ranged power', key: 'rangedPower', tag: 'ranged' },

    { label: 'Spell power', key: 'spellPower', tag: 'spell' },
    { label: 'Spell crit', key: 'spellCrit', suffix: '%', places: 2, tag: 'spell' },
    { label: 'Spell hit', key: 'spellHit', suffix: '%', places: 2, tag: 'spell' },
    { label: 'Spell haste', key: 'spellHaste', suffix: '%', places: 2, tag: 'spell' },
    { label: 'Mana regen', key: 'manaRegen', suffix: ' /5s', places: 1, tag: 'mana' },
    { label: 'While casting', key: 'manaRegenCasting', suffix: ' /5s', places: 1, tag: 'mana' },

    { label: 'Dodge', key: 'dodge', suffix: '%', places: 2, tag: 'defense' },
    { label: 'Parry', key: 'parry', suffix: '%', places: 2, tag: 'defense' },
    { label: 'Block', key: 'block', suffix: '%', places: 2, tag: 'defense' },
    { label: 'Block value', key: 'blockValue', tag: 'defense' },
    { label: 'Defense', key: 'defense', tag: 'defense' },
    { label: 'Resilience', key: 'resilience', suffix: '%', places: 2, tag: 'defense' },

    { label: 'Arcane', key: 'arcane', tag: 'resist' }, { label: 'Fire', key: 'fire', tag: 'resist' },
    { label: 'Frost', key: 'frost', tag: 'resist' }, { label: 'Nature', key: 'nature', tag: 'resist' },
    { label: 'Shadow', key: 'shadow', tag: 'resist' }
];

/*
 * What each class is actually read for.
 *
 * The game's own sheet shows every category to everyone, spell power on a warrior included. This
 * does not, because a sheet you are reading to judge a piece of gear is better without twelve
 * lines that will always be zero. Hybrids get both halves rather than a guess at which one they
 * are playing - a paladin can be any of three things and, until the talent calculator says which,
 * so can this. "Show all stats" is there for the case this gets wrong, which for a program about
 * inventing items is a case that will come up.
 */
const CLASS_STATS = {
    1: ['core', 'melee', 'defense', 'resist'],                          // Warrior
    2: ['core', 'mana', 'melee', 'spell', 'defense', 'resist'],         // Paladin
    3: ['core', 'mana', 'melee', 'ranged', 'defense', 'resist'],        // Hunter
    4: ['core', 'melee', 'defense', 'resist'],                          // Rogue
    5: ['core', 'mana', 'spell', 'resist'],                             // Priest
    6: ['core', 'melee', 'defense', 'resist'],                          // Death Knight
    7: ['core', 'mana', 'melee', 'spell', 'defense', 'resist'],         // Shaman
    8: ['core', 'mana', 'spell', 'resist'],                             // Mage
    9: ['core', 'mana', 'spell', 'resist'],                             // Warlock
    11: ['core', 'mana', 'melee', 'spell', 'defense', 'resist']         // Druid
};

/** Aura names as a racial should read them, rather than as the budget table spells them. */
const STAT_WORDS = {
    str: 'strength', agi: 'agility', sta: 'stamina', int: 'intellect', spi: 'spirit',
    meleeCrit: 'crit', spellCrit: 'spell crit', meleeHit: 'hit', spellHit: 'spell hit',
    meleeHaste: 'haste', attackPower: 'attack power', rangedPower: 'ranged attack power',
    blockValue: 'block value', spellPower: 'spell power', spellPen: 'spell penetration',
    manaRegen: 'mana per 5 sec', health: 'health', armor: 'armor'
};

/*
 * The editor's weapon labels back to the subclass the client numbers them by, for the racials that
 * wait on a weapon. `WEAPON_TYPES` in lib/items.js is the same table read the other way; a label
 * covers both the one and two-handed kind, and the first match is enough because every racial mask
 * that names a family names both.
 */
const WEAPON_SUBCLASS = {
    'Axe': 0, 'Bow': 2, 'Gun': 3, 'Mace': 4, 'Polearm': 6, 'Sword': 7, 'Staff': 10,
    'Fist Weapon': 13, 'Dagger': 15, 'Thrown': 16, 'Crossbow': 18, 'Wand': 19
};

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

/*
 * What is equipped, by slot name.
 *
 * Whole editor items rather than references, because half of what goes in here will not have an
 * entry to refer to - a piece invented in the Item window and never saved is the case the Armory
 * exists for. It is not part of `state` for the same reason a portrait is not: it is bulky, and
 * what it is for is being read out rather than being carried in a permalink.
 */
const worn = new Map();

/** The slot the picker was opened from, and which of its two sources is showing. */
let picking = '';
let source = 'database';
let searchTimer = 0;


/* ------------------------------------------------------------------- hover tooltips */

/*
 * The real tooltip, over the slot you are pointing at.
 *
 * Nothing new is drawn for this: `renderTooltip` is the same function the Item window previews
 * with and the exporter writes PNGs with, so what hangs off a slot is the tooltip that item has,
 * not a summary of it. It is asked for at 1.5x, which is large enough to read a stat line at a
 * glance without reaching for the mouse.
 */
const HOVER_SCALE = 1.5;

/** Icon images, kept because the same piece is hovered over and over while a set is compared. */
const iconCache = new Map();
let hoverNode = null;
let fontReady = null;

/**
 * The tooltip's own face, loaded once before the first draw.
 *
 * Canvas measures synchronously and never goes back over it, so a tooltip drawn while AstralGame
 * is still loading is laid out against the fallback's metrics and painted in the game's. The live
 * preview gets away with this by redrawing on every keystroke; a hover is drawn once.
 */
function ensureTooltipFont()
{
    if (!fontReady)
    {
        fontReady = document.fonts.load('16px AstralGame').catch(() => {});
    }

    return fontReady;
}

function iconImage(name)
{
    if (!name)
    {
        return Promise.resolve(null);
    }

    if (!iconCache.has(name))
    {
        iconCache.set(name, new Promise((resolve) =>
        {
            const img = new Image();

            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = iconUrl(name);
        }));
    }

    return iconCache.get(name);
}

/** The floating host, made once and moved around rather than built per hover. */
function hoverHost()
{
    if (!hoverNode)
    {
        hoverNode = el('div', 'armory-hover');
        hoverNode.hidden = true;
        document.body.append(hoverNode);
    }

    return hoverNode;
}

function hideHover()
{
    hoverHost().hidden = true;
}

/**
 * Draw one item's tooltip and park it beside its slot.
 *
 * Placed to the right of the slot where there is room and to the left where there is not, and
 * lifted off the bottom of the window the same way, so a boots slot at the foot of the page does
 * not put its tooltip somewhere unreadable.
 */
async function showHover(slotNode, item)
{
    await ensureTooltipFont();

    const host = hoverHost();

    /* The pointer may have moved on while the font and the icon were loading. */
    if (!slotNode.matches(':hover'))
    {
        return;
    }

    const prepared = {
        ...item,
        kind: 'item',
        effects: (item.effects || []).map((e) => ({ kind: e.kind, text: effectText(e) })),

        /*
         * What the tooltip cannot work out for itself: how many of this set are on, and which of
         * its named pieces they are. Without these it reads "0/5" with everything grey, which is
         * right for a piece in a bag and wrong for one being worn.
         */
        ...setContext(item)
    };

    const canvas = R.renderTooltip(M.buildLines(prepared), {
        icon: await iconImage(item.icon),
        iconPlacement: 'outside',
        maxWidth: 300,
        transparent: false,
        borderColor: M.qualityColor(item.quality)
    }, HOVER_SCALE);

    host.replaceChildren(canvas);
    host.hidden = false;

    const slot = slotNode.getBoundingClientRect();
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const room = window.innerWidth - slot.right;

    const left = room > width + 20 ? slot.right + 10 : Math.max(8, slot.left - width - 10);
    const top = Math.max(8, Math.min(slot.top, window.innerHeight - height - 8));

    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
}
/** One slot: an item's icon and name when it holds one, the name of the slot when it does not. */
function slotBox(name)
{
    const box = el('button', 'slot');
    const item = worn.get(name);

    box.type = 'button';
    box.dataset.slot = name;

    /* No `title`. The browser's own tooltip would open a second, smaller box on top of the item's
       real one; how a slot works is said once at the head of the panel instead. */

    const icon = el('span', 'slot-icon');

    if (item && item.icon)
    {
        icon.style.backgroundImage = `url("${iconUrl(item.icon)}")`;
        icon.classList.add('has-item');
    }

    const label = el('span', 'slot-name', item ? item.name : name);

    if (item)
    {
        box.classList.add('filled');
        label.style.color = M.qualityColor(item.quality);
    }

    box.append(icon, label);

    box.addEventListener('click', () => openPicker(name));

    if (item)
    {
        box.addEventListener('mouseenter', () => showHover(box, item));
        box.addEventListener('mouseleave', hideHover);
    }

    /* Right click empties it. A slot with no item in it has nothing to take out, so the menu is
       only suppressed when there is something to do. */
    box.addEventListener('contextmenu', (e) =>
    {
        if (!worn.has(name))
        {
            return;
        }

        e.preventDefault();
        worn.delete(name);
        drawSlots();
        refresh();
    });

    return box;
}

function drawSlots()
{
    /*
     * Every redraw throws away the node the pointer is over, and a node that no longer exists
     * cannot fire `mouseleave` - so a tooltip opened over a slot that is then emptied would hang
     * there with nothing left to close it. Hiding here covers every redraw rather than the one
     * that was noticed.
     */
    hideHover();

    for (const [id, names] of [['left', LEFT], ['right', RIGHT], ['weapon', WEAPONS]])
    {
        const host = $(`#armory-slots-${id}`);

        host.replaceChildren(...names.map(slotBox));
    }
}

/**
 * Equipping, with the game's own rule about hands.
 *
 * A two-hander occupies both weapon slots, so putting one in a main hand empties the off hand and
 * putting anything in an off hand that is being held by a two-hander empties the main. The panel
 * is where this belongs: `equipped()` adds up whatever it is given and would happily total a
 * two-hander and a shield at once.
 */
function equip(slot, item)
{
    worn.set(slot, item);

    if (slot === 'Main hand' && item.slot === 'Two-Hand')
    {
        worn.delete('Off hand');
    }

    if (slot === 'Off hand')
    {
        const main = worn.get('Main hand');

        if (main && main.slot === 'Two-Hand')
        {
            worn.delete('Main hand');
        }
    }

    drawSlots();
    drawRacials();
    refresh();
}

/** One row in the picker: the icon, the name in its quality color, and what it is. */
function pickerRow(item, onPick)
{
    const row = el('button', 'npc-row item-row');

    row.type = 'button';

    if (item.icon)
    {
        const img = el('img', 'item-row-icon');

        img.src = iconUrl(item.icon);
        img.alt = '';
        row.append(img);
    }

    const text = el('span', 'item-row-text');
    const name = el('span', 'npc-name', item.name || '(no name)');

    name.style.color = M.qualityColor(item.quality);

    const meta = el('span', 'npc-meta', [
        item.itemLevel ? `ilvl ${item.itemLevel}` : '',
        item.slot,
        item.type || item.itemType,
        item.entry ? `#${item.entry}` : 'custom'
    ].filter(Boolean).join(' · '));

    text.append(name, meta);
    row.append(text);
    row.addEventListener('click', onPick);

    return row;
}

function pickerStatus(text)
{
    $('#armory-picker-status').textContent = text;
}

/**
 * The saved side: everything in the saved store whose own slot fits the one being filled.
 *
 * Nothing is stored twice for this. A saved item already carries the slot it was built for, so
 * the filter is read at open time and cannot go stale the way a folder chosen at save time would.
 */
async function showCustom()
{
    const fits = (setup.slots && setup.slots[picking]) || [];
    const query = $('#armory-picker-search').value.trim().toLowerCase();
    const results = $('#armory-picker-results');

    /* A saved entry is a wrapper - id, name, icon, then the window's own fields underneath. The
       item is `fields`, and everything from the slot to the stat rows is in there. */
    const answer = await api('/api/saved?kind=item');
    const forSlot = (answer.saved || [])
        .map((entry) => entry.fields || {})
        .filter((item) => fits.includes(item.slot));

    /*
     * Searched like the database side, and listed unsearched when the box is empty. This store is
     * yours and small, so the useful default is to show it; the database is millions of rows and
     * has to be asked a question first.
     */
    const mine = query
        ? forSlot.filter((item) => (item.name || '').toLowerCase().includes(query))
        : forSlot;

    pickerStatus(forSlot.length ? `${mine.length} of ${forSlot.length} saved` : '');

    if (!mine.length)
    {
        results.replaceChildren(el('p', 'hint', forSlot.length
            ? `No saved ${picking} slot items match "${query}".`
            : `No ${picking} slot items saved yet. Build one in the Item window and use Save for`
                + ' Armory, and it will be here. Hand-written stat lines are not read - pick the'
                + ' presets.'));
        return;
    }

    results.replaceChildren(...mine.map((item) => pickerRow(item, () =>
    {
        equip(picking, item);
        $('#armory-picker').close();
    })));
}

/** The database side, filtered to what the slot takes so a boots search cannot answer with a helm. */
async function showDatabase()
{
    const query = $('#armory-picker-search').value.trim();
    const results = $('#armory-picker-results');

    if (query.length < 2)
    {
        /* No search, so no count. Leaving the last one up would have it describe a list that is
           not on screen, and on a freshly opened slot a list from a different slot entirely. */
        pickerStatus('');
        results.replaceChildren(el('p', 'hint',
            `Type a name or an entry to search for ${picking} slot items.`));
        return;
    }

    pickerStatus('searching...');

    const answer = await api(
        `/api/item/search?q=${encodeURIComponent(query)}&slot=${encodeURIComponent(picking)}`);

    if (answer.error)
    {
        pickerStatus(answer.error === 'not-connected'
            ? 'No database configured. Custom gear still works.'
            : answer.error);
        results.replaceChildren();
        return;
    }

    pickerStatus(`${answer.results.length} found`);

    if (!answer.results.length)
    {
        results.replaceChildren(el('p', 'hint',
            `No ${picking} slot items match "${query}".`));
        return;
    }

    results.replaceChildren(...answer.results.map((row) => pickerRow(row, async () =>
    {
        /* The search answers with a summary; the sheet needs the whole item, so it is fetched on
           the way in rather than for every row of a list that is mostly not going to be picked. */
        const full = await api(`/api/item/get?entry=${row.entry}`);

        if (full.item)
        {
            equip(picking, full.item);
            $('#armory-picker').close();
        }
        else
        {
            pickerStatus(full.error || 'could not load that item');
        }
    })));
}

function showSource()
{
    for (const button of document.querySelectorAll('.picker-source'))
    {
        button.classList.toggle('is-on', button.dataset.source === source);
    }

    /* One box, two haystacks, so it says which one it is about to search. */
    $('#armory-picker-search').placeholder = source === 'custom'
        ? 'Search your saved items by name'
        : 'Search the database by name or entry';

    if (source === 'custom')
    {
        showCustom();
    }
    else
    {
        showDatabase();
    }
}

function openPicker(slot)
{
    /* A modal draws in the top layer, above anything a z-index can reach, so a tooltip left up
       would sit under the backdrop rather than closing itself. */
    hideHover();

    picking = slot;
    source = 'database';

    $('#armory-picker-title').textContent = slot;
    $('#armory-picker-search').value = '';
    pickerStatus('');
    $('#armory-picker').showModal();
    showSource();
    $('#armory-picker-search').focus();
}


/* ------------------------------------------------------------------------ racials */

/*
 * The racials of whichever race is picked, with their real icons and their real tooltips.
 *
 * Every one is listed, including the ones that change no number. Blood Fury, Shadowmeld and War
 * Stomp are as much a part of being an orc, a night elf or a tauren as the passives are, and a
 * panel that quietly dropped half of them would look broken rather than principled. The ones that
 * do nothing to the sheet say so instead.
 */
let racials = [];

async function loadRacials()
{
    const answer = await api(`/api/character/racials?race=${state.armoryRace}`);

    racials = answer.racials || [];
    drawRacials();
}

/** What an aura contribution reads as under the icon: "+5 expertise", "+5% intellect". */
function auraLine(one)
{
    const sign = one.value < 0 ? '' : '+';
    const name = STAT_WORDS[one.to] || one.to;

    return `${sign}${one.value}${one.percent ? '%' : ''} ${name}`;
}

function drawRacials()
{
    const host = $('#armory-racials');

    /*
     * Only the ones that move a number.
     *
     * Blood Fury, Shadowmeld, War Stomp and Arcane Torrent are abilities you press, and Hardiness
     * and Command are passives about things this sheet does not show - stun duration and pet
     * damage. Listing them made the panel longer without making it say more. What stays is what
     * the stat block is actually reading, and a weapon racial stays even when it is doing nothing,
     * greyed, because "you would have five expertise with an axe" is worth knowing.
     */
    const shown = racials.filter((racial) => racial.stats.length);

    if (!shown.length)
    {
        host.replaceChildren(el('p', 'hint', racials.length
            ? 'No stat changing racials.'
            : 'Point Astral at your client to read these.'));
        return;
    }

    host.replaceChildren(...shown.map((racial) =>
    {
        const row = el('div', 'racial');
        const icon = el('span', 'racial-icon');

        if (racial.icon)
        {
            icon.style.backgroundImage = `url("${iconUrl(racial.icon)}")`;
        }

        const text = el('span', 'racial-text');

        text.append(el('span', 'racial-name', racial.name));

        /*
         * Lit or grayed by whether it is doing anything. A weapon racial with no weapon in hand is
         * the case this is for: the orc's expertise is there, and it is worth nothing right now.
         */
        const live = racial.stats.filter((one) => conditionHolds(one));

        text.append(el('span', 'racial-effect', racial.stats.map(auraLine).join(', ')));

        if (!live.length)
        {
            row.classList.add('is-off');
        }

        row.append(icon, text);
        row.addEventListener('mouseenter', () => showRacialTooltip(row, racial));
        row.addEventListener('mouseleave', hideHover);

        return row;
    }));
}

/** Whether a weapon condition is met by what is in the weapon slots right now. */
function conditionHolds(one)
{
    if (!one.condition)
    {
        return true;
    }

    for (const slot of ['Main hand', 'Off hand', 'Ranged'])
    {
        const item = worn.get(slot);

        if (item && WEAPON_SUBCLASS[item.itemType] !== undefined
            && one.condition.itemClass === 2
            && (one.condition.subclassMask & (1 << WEAPON_SUBCLASS[item.itemType])))
        {
            return true;
        }
    }

    return false;
}

async function showRacialTooltip(node, racial)
{
    await ensureTooltipFont();

    if (!node.matches(':hover'))
    {
        return;
    }

    const lines = [
        { l: racial.name, lc: M.C.white, r: '', rc: M.C.gray, kind: 'title' },
        { l: '', kind: 'gap' },
        { l: racial.description || 'No description in the client.', lc: M.C.gold, r: '', rc: M.C.white, kind: 'body' }
    ];

    if (racial.stats.length && !racial.stats.every(conditionHolds))
    {
        lines.push({ l: '', kind: 'gap' });
        lines.push({ l: 'Requires appropriate weapon equipped.', lc: M.C.red, r: '', rc: M.C.white, kind: 'body' });
    }

    const canvas = R.renderTooltip(lines, {
        icon: null, iconPlacement: 'none', maxWidth: 300, transparent: false, borderColor: '#4a4a4a'
    }, 1);

    const host = hoverHost();

    host.replaceChildren(canvas);
    host.hidden = false;

    const box = node.getBoundingClientRect();
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    host.style.left = `${Math.round(Math.min(box.right + 10, window.innerWidth - width - 8))}px`;
    host.style.top = `${Math.round(Math.max(8, Math.min(box.top, window.innerHeight - height - 8)))}px`;
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
    $('#armory-all-stats').checked = !!state.armoryAllStats;
}

/**
 * The line over the slots that says what this character is.
 *
 * A readout rather than a picker: in Wrath the spec is whichever tree holds the most points, so
 * there is nothing to choose here and nothing that could disagree with the build.
 */
function showSpec()
{
    const talents = talentSummary();

    /* The three counts already say how many points are spent, so the total said it twice. How many
       are left is on the calculator's own header, which is where you are when it matters. */
    $('#armory-spec').textContent = talents.spent ? talents.spec : 'no talents spent';
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

/** Where a stat lives: among the five primaries, among the five schools, or on the sheet itself. */
function lookup(sheet, key)
{
    if (sheet.stats[key] !== undefined)
    {
        return sheet.stats[key];
    }

    if (sheet.resistances[key] !== undefined)
    {
        return sheet.resistances[key];
    }

    return sheet[key];
}

/** One line, the way the game writes it: the stat, a colon, the number. */
function cell(entry, sheet)
{
    const value = lookup(sheet, entry.key);

    const line = el('div', value === undefined ? 'stat pending' : 'stat');

    line.append(el('span', 'stat-label', `${entry.label}:`));
    line.append(el('span', 'stat-value', value === undefined
        ? '-'
        : `${entry.places ? value.toFixed(entry.places) : Math.round(value)}${entry.suffix || ''}`));

    return line;
}

/** The lines this class is read for, or all of them when the box below the sheet is ticked. */
function linesFor(cls)
{
    if (state.armoryAllStats)
    {
        return SHEET;
    }

    const tags = CLASS_STATS[cls] || Object.keys(CLASS_STATS);

    return SHEET.filter((entry) => tags.includes(entry.tag));
}

async function refresh()
{
    if (!setup)
    {
        return;
    }

    /* Equipped items travel whole. Half of what can be worn here has no entry to refer to - an
       invented piece that was never saved is the case this exists for. */
    const sheet = await postJson('/api/character/sheet', {
        race: state.armoryRace,
        class: state.armoryClass,
        level: state.armoryLevel,
        items: [...worn.values()],
        talents: state.armoryTalents || {}
    });

    if (sheet.error)
    {
        $('#armory-stat-note').textContent = sheet.error;
        return;
    }

    /*
     * The five schools sit under the sheet rather than flowing into its columns. They are one
     * thought and they are short, so a row of five reads as the resistance line the game has,
     * where six wide columns would put Fire beside Resilience and carry Frost onto the next row.
     * Same box, same lines, one break.
     */
    const lines = linesFor(state.armoryClass);

    $('#armory-stat-grid').replaceChildren(
        ...lines.filter((entry) => entry.tag !== 'resist').map((entry) => cell(entry, sheet)));

    $('#armory-resist-grid').replaceChildren(
        ...lines.filter((entry) => entry.tag === 'resist').map((entry) => cell(entry, sheet)));

    drawEquipped();
    drawSets();

    /* The line under the sheet is for what went wrong, and nothing did. */
    $('#armory-stat-note').textContent = '';
}

/**
 * What is on, slot by slot.
 *
 * Its own item level per row and no average anywhere: an average needs rules the client never had,
 * about which slots count and what an empty off hand is worth, and inventing them would put a
 * number on the panel that nothing can check. The item's own field needs inventing nothing.
 */

/* --------------------------------------------------------------------------- sets */

/*
 * The set block, counted from what is on rather than from what one piece claims.
 *
 * A single item's tooltip can only ever say "(0/5)", because an item does not know what else is
 * worn. Here everything is, so the count is real and a bonus lights up at its threshold the way the
 * game lights it.
 *
 * Grouped by set *name*, which is what makes a custom tier work: a piece you invented with the same
 * set name as another joins it and counts toward it, whether the others are yours or the
 * database's. Real sets get their name from `ItemSet.dbc`, so two tiers that look alike - the
 * Ymirjar Lord's Battlegear and the Ymirjar Lord's Plate - stay apart on their own names rather
 * than being merged by a family resemblance.
 */
function wornSets()
{
    const sets = new Map();

    for (const item of worn.values())
    {
        const name = (item.setName || '').trim();

        if (!name)
        {
            continue;
        }

        if (!sets.has(name))
        {
            sets.set(name, { name, worn: [], slots: [], pieces: [], roster: [], bonuses: [] });
        }

        const set = sets.get(name);

        set.worn.push(item.name || '(no name)');
        set.slots.push(item.slot || '');

        /*
         * The roster and the bonuses come off whichever piece carries them. A custom piece may
         * list neither, and then the set is as long as the pieces actually equipped.
         */
        if ((item.setPieces || []).length > set.pieces.length)
        {
            set.pieces = item.setPieces.filter(Boolean);
        }

        if ((item.setRoster || []).length > set.roster.length)
        {
            set.roster = item.setRoster;
        }

        if ((item.setBonuses || []).length > set.bonuses.length)
        {
            set.bonuses = item.setBonuses.filter((b) => b && b.text);
        }
    }

    return [...sets.values()];
}

/**
 * One set's roster as it should read, with each row lit or not.
 *
 * A row shows the piece you are *wearing* where you are wearing one, which is what the game does:
 * put a Sanctified Ymirjar Lord's Helmet on and the Ymirjar Lord's Helmet row becomes the
 * sanctified name. The slot is what joins them - the roster names the un-sanctified piece and the
 * heroic variants are in the set without being in its list, so names never match and slots always
 * do. A custom set has no slots on its roster, so there it falls back to names.
 */
function rosterFor(set)
{
    if (!set.roster.length)
    {
        const names = set.pieces.length ? set.pieces : set.worn;

        return names.map((name) => ({ name, on: set.worn.includes(name) }));
    }

    const mine = [...worn.values()].filter((item) => (item.setName || '').trim() === set.name);

    return set.roster.map((piece) =>
    {
        const item = mine.find((one) => one.slot === piece.slot);

        return { name: (item && item.name) || piece.name, on: !!item };
    });
}

/**
 * How much of one item's set is on, for its tooltip.
 *
 * The tooltip cannot work this out for itself - it is drawing one item and knows nothing of the
 * other eighteen slots - so the count and the roster are handed to it already resolved.
 */
function setContext(item)
{
    const name = (item.setName || '').trim();
    const set = name ? wornSets().find((one) => one.name === name) : null;

    if (!set)
    {
        return {};
    }

    const roster = rosterFor(set);

    return {
        setWorn: set.worn.length,
        setPieces: roster.map((piece) => piece.name),
        setOn: roster.filter((piece) => piece.on).map((piece) => piece.name)
    };
}

function drawSets()
{
    const host = $('#armory-sets');
    const sets = wornSets();

    if (!sets.length)
    {
        host.replaceChildren(el('p', 'hint',
            'Equip two or more pieces of a set and its bonuses show here.'));
        return;
    }

    host.replaceChildren(...sets.map((set) =>
    {
        const box = el('div', 'set');
        const total = Math.max(set.pieces.length, set.worn.length);

        box.append(el('div', 'set-name', `${set.name} (${set.worn.length}/${total})`));

        /*
         * The roster, with what is on lit and the rest grey - the game's own arrangement. A set
         * whose pieces are not named lists what is worn instead of an empty block.
         */
        const list = el('div', 'set-pieces');

        for (const piece of rosterFor(set))
        {
            const line = el('div', 'set-piece', piece.name);

            if (piece.on)
            {
                line.classList.add('is-on');
            }

            list.append(line);
        }

        box.append(list);

        if (set.bonuses.length)
        {
            const bonuses = el('div', 'set-bonuses');

            for (const bonus of set.bonuses)
            {
                const line = el('div', 'set-bonus', `(${bonus.count}) Set: ${bonus.text}`);

                if (set.worn.length >= Number(bonus.count))
                {
                    line.classList.add('is-on');
                }

                bonuses.append(line);
            }

            box.append(bonuses);
        }

        return box;
    }));
}

function drawEquipped()
{
    const rows = [...worn.entries()];

    if (!rows.length)
    {
        const note = el('td', 'hint', 'Nothing equipped. Click a slot to fill it.');
        const line = el('tr');

        note.colSpan = 4;
        line.append(note);
        $('#armory-equipped').replaceChildren(line);
        return;
    }

    $('#armory-equipped').replaceChildren(...rows.map(([slot, item]) =>
    {
        const line = el('tr');
        const name = el('td', '', item.name || '(no name)');

        name.style.color = M.qualityColor(item.quality);

        line.append(
            name,
            el('td', '', item.itemLevel ? String(item.itemLevel) : '-'),
            el('td', '', slot),
            el('td', 'hint', item.entry ? `#${item.entry}` : 'custom'));

        return line;
    }));
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
    drawEquipped();
    drawSets();

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
    showSpec();
    await loadRacials();
    await refresh();

    if (bound)
    {
        return;
    }

    bound = true;

    for (const button of document.querySelectorAll('.picker-source'))
    {
        button.addEventListener('click', () =>
        {
            source = button.dataset.source;
            showSource();
        });
    }

    /* Debounced the way the item and NPC searches are, so typing a name is one query rather than
       one per keystroke. */
    $('#armory-picker-search').addEventListener('input', () =>
    {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(showSource, 250);
    });

    $('#armory-race').addEventListener('change', (e) =>
    {
        state.armoryRace = Number(e.target.value);
        fillPickers();
        loadRacials();
        refresh();
    });

    $('#armory-class').addEventListener('change', (e) =>
    {
        state.armoryClass = Number(e.target.value);

        /* A build is a set of talent ids belonging to one class, so it does not survive a change
           of class - keeping it would leave points spent in trees that are no longer on screen. */
        clearTalents();
        showWho();
        clampLevel();
        showSpec();
        refresh();
    });

    $('#btn-talents').addEventListener('click', () => openTalents(state.armoryClass, showSpec));

    /*
     * The sheet is recomputed when the calculator closes rather than on every point.
     *
     * Spending a point is a click and the window sits over the sheet while it happens, so posting
     * a character per click would be twenty requests nobody is looking at. The spec line above the
     * slots does update live, because that is inside the window.
     */
    $('#talent-dialog').addEventListener('close', () =>
    {
        showSpec();
        refresh();
    });

    $('#armory-all-stats').addEventListener('change', (e) =>
    {
        state.armoryAllStats = e.target.checked;
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
