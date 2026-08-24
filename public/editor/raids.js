'use strict';

/*
 * The raid wizard: raids as documents, filled from the windows that already build the pieces.
 *
 * Two views in one panel. The **list** is every raid you have, each a card with its logo, its name
 * and how many bosses are in it. Opening one swaps to the **roster**: the bosses in the order the
 * raid is run, each showing the frame it was added with.
 *
 * Everything is saved the moment it changes. There is no Save button because there is nothing a
 * Save button would protect you from — every other window keeps its state in the address bar
 * without being asked, and a raid should not be the one place work can be lost by closing a tab.
 */

import { $, button } from './dom.js';
import { api, postJson } from './api.js';
import { state, fieldsOf } from './state.js';
import { status } from './preview.js';
import { iconUrl, renderIconGrid } from './icons.js';
import { renderBoss, DIFFICULTIES } from './raid-boss.js';
import { exportBossSheet, exportRaidSheet } from './raid-sheet.js';

/** Which raid is open, or null on the list. */
let openRaid = null;

/** Which boss inside it is open, or null on the roster. */
let openBossId = null;

/** The raid list, as the server last reported it. */
let raidList = [];

/*
 * Where a chosen icon should go.
 *
 * The picker is shared with the item, spell and achievement windows, which each write their own
 * state field. A raid's logo is not a field on the editor state — it belongs to a document on
 * disk — so the wizard borrows the dialog and takes the answer back through here instead.
 */
let iconTarget = null;

function setIconTarget(target)
{
    iconTarget = target;
}

/** Called by the icon picker when a raid is what asked for an icon. */
function takeIcon(name)
{
    if (!iconTarget)
    {
        return false;
    }

    const target = iconTarget;
    iconTarget = null;

    target(name);

    return true;
}

function wantsIcon()
{
    return !!iconTarget;
}

/* ------------------------------------------------------------------ the list */

async function refresh()
{
    try
    {
        const result = await api('api/raids');
        raidList = result.raids || [];
    }
    catch (err)
    {
        status(`Could not read your raids: ${err.message}`);
        raidList = [];
    }

    render();
}

function raidCard(raid)
{
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'raid-card';

    const icon = document.createElement('img');
    icon.className = 'raid-card-icon';
    icon.src = iconUrl(raid.icon || 'inv_misc_questionmark');
    icon.alt = '';

    const text = document.createElement('span');
    text.className = 'raid-card-text';

    const name = document.createElement('span');
    name.className = 'raid-card-name';
    name.textContent = raid.name;

    const meta = document.createElement('span');
    meta.className = 'raid-card-meta';
    meta.textContent = `${raid.bosses} boss${raid.bosses === 1 ? '' : 'es'}`;

    text.append(name, meta);
    card.append(icon, text);
    card.addEventListener('click', () => open(raid.id));

    /*
     * Delete sits on the card but is not part of the card's own click, and it arms first: a raid
     * is work that took a while and there is no undo behind this.
     */
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'raid-mini raid-delete';
    remove.textContent = '×';
    remove.title = `Delete ${raid.name}`;

    remove.addEventListener('click', async (event) =>
    {
        event.stopPropagation();

        if (remove.dataset.armed !== 'yes')
        {
            remove.dataset.armed = 'yes';
            remove.textContent = 'Delete?';
            remove.title = 'Press again to delete this raid for good';

            setTimeout(() =>
            {
                remove.dataset.armed = '';
                remove.textContent = '×';
                remove.title = `Delete ${raid.name}`;
            }, 4000);

            return;
        }

        await postJson('api/raids/delete', { id: raid.id });
        status(`Deleted ${raid.name}`);
        refresh();
    });

    const row = document.createElement('div');
    row.className = 'raid-card-row';
    row.append(card, remove);

    return row;
}

/* ---------------------------------------------------------------- the roster */

/**
 * One boss in the roster.
 *
 * The frame is stored with the boss, so it shows the health it was added with rather than a name
 * and a guess. Nothing here asks the database for it a second time, which is what lets a raid
 * still read correctly on a machine with no database configured.
 */
function bossRow(boss, index)
{
    const row = document.createElement('div');
    row.className = 'raid-boss';

    const head = document.createElement('div');
    head.className = 'raid-boss-head';

    const order = document.createElement('span');
    order.className = 'raid-boss-order';
    order.textContent = String(index + 1);

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'raid-boss-name';
    name.value = boss.name;
    name.addEventListener('change', () => saveBoss(boss.id, { name: name.value }));

    head.append(order, name);

    const buttons = document.createElement('div');
    buttons.className = 'raid-boss-buttons';

    /* The row's small buttons all look the same and differ only in what they say and do. */
    const mini = (label, title, onClick) => button(label, 'raid-mini', onClick, title);

    buttons.append(
        mini('Modify', 'Difficulties, phases, loot, achievements and lines',
            () => { openBossId = boss.id; render(); }),
        mini('↑', 'Earlier in the raid', () => moveBoss(boss.id, -1)),
        mini('↓', 'Later in the raid', () => moveBoss(boss.id, 1)),
        mini('×', 'Remove from the raid', () => removeBoss(boss.id, boss.name))
    );

    head.appendChild(buttons);
    row.appendChild(head);

    const frame = boss.frame || {};
    const facts = [];

    if (frame.unitLevel)
    {
        facts.push(frame.unitSkull ? 'Boss level' : `Level ${frame.unitLevel}`);
    }

    if (frame.unitClassification)
    {
        facts.push(frame.unitClassification);
    }

    if (frame.unitHealthMax)
    {
        facts.push(`${Number(frame.unitHealthMax).toLocaleString()} HP`);
    }

    if (frame.unitPower === 'mana' && frame.unitPowerMax)
    {
        facts.push(`${Number(frame.unitPowerMax).toLocaleString()} mana`);
    }

    const meta = document.createElement('p');
    meta.className = 'hint raid-boss-meta';
    meta.textContent = facts.join(' · ') || 'No frame stored with this one.';
    row.appendChild(meta);

    return row;
}

/* -------------------------------------------------------------------- render */

function render()
{
    const host = $('#raid-panel');

    if (!host)
    {
        return;
    }

    host.textContent = '';

    if (!openRaid)
    {
        host.appendChild(renderList());
        return;
    }

    const boss = openBossId && (openRaid.bosses || []).find((b) => b.id === openBossId);

    host.appendChild(boss ? renderOpenBoss(boss) : renderRoster());
}

function renderList()
{
    const wrap = document.createElement('div');

    const bar = document.createElement('div');
    bar.className = 'row raid-bar';

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'add';
    add.textContent = '+ New raid';
    add.addEventListener('click', createRaid);
    bar.appendChild(add);

    wrap.appendChild(bar);

    if (!raidList.length)
    {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'No raids yet. Make one, then fill it from the dungeon browser.';
        wrap.appendChild(hint);

        return wrap;
    }

    const list = document.createElement('div');
    list.className = 'raid-list';
    raidList.forEach((raid) => list.appendChild(raidCard(raid)));
    wrap.appendChild(list);

    return wrap;
}

/**
 * One boss, opened out of the roster.
 *
 * raid-boss.js draws it; everything it changes comes back through here, because this module is
 * the one that owns the open raid and knows how to write it.
 */
function renderOpenBoss(boss)
{
    return renderBoss(boss, {
        save: (patch) => saveBoss(boss.id, patch, true),
        onBack: () => { openBossId = null; render(); },
        redraw: () => render(),
        onExport: (which, difficulty, mode) => exportBossSheet(openRaid, which, difficulty, mode)
    });
}

function renderRoster()
{
    const wrap = document.createElement('div');

    const bar = document.createElement('div');
    bar.className = 'row raid-bar';

    const back = document.createElement('button');
    back.type = 'button';
    back.className = 'loot-back';
    back.textContent = '← All raids';
    back.addEventListener('click', () => { openRaid = null; openBossId = null; refresh(); });
    bar.appendChild(back);

    wrap.appendChild(bar);

    /* The raid's own identity: its logo and its name, both editable in place. */
    const head = document.createElement('div');
    head.className = 'raid-head';

    const logo = document.createElement('button');
    logo.type = 'button';
    logo.className = 'icon-btn raid-logo';
    logo.title = 'Choose a logo';

    const image = document.createElement('img');
    image.src = iconUrl(openRaid.icon || 'inv_misc_questionmark');
    image.alt = '';
    logo.appendChild(image);
    logo.addEventListener('click', () => pickIcon((name) => saveRaid({ icon: name })));

    const name = document.createElement('input');
    name.type = 'text';
    name.className = 'raid-name';
    name.value = openRaid.name;
    name.addEventListener('change', () => saveRaid({ name: name.value }));

    head.append(logo, name);
    wrap.appendChild(head);

    /* What this raid is. Optional, and drawn on a boss sheet in the game's flavor style. */
    const note = document.createElement('textarea');
    note.className = 'raid-note';
    note.rows = 2;
    note.value = openRaid.note || '';
    note.placeholder = 'Describe the raid - drawn as flavor text on the sheets';
    note.addEventListener('change', () => saveRaid({ note: note.value }));
    wrap.appendChild(note);

    /* The two ways in. */
    wrap.appendChild(addBar());

    /*
     * The raid's own picture: its logo, name, description and roster. The place its description
     * belongs, rather than repeated at the top of every boss sheet.
     */
    const sheetBar = document.createElement('div');
    sheetBar.className = 'row raid-bar';
    sheetBar.appendChild(button('Copy the raid as a PNG', 'add',
        () => exportRaidSheet(openRaid),
        'The logo, the description and the roster on one sheet'));
    wrap.appendChild(sheetBar);

    const bosses = openRaid.bosses || [];

    if (!bosses.length)
    {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'No bosses yet - browse for one, or take what the NPC window is showing.';
        wrap.appendChild(hint);

        return wrap;
    }

    const list = document.createElement('div');
    list.className = 'raid-bosses';
    bosses.forEach((boss, index) => list.appendChild(bossRow(boss, index)));
    wrap.appendChild(list);

    return wrap;
}

/**
 * The two ways a boss gets into a raid.
 *
 * Neither is a paste. Every window already has a Copy image button, so a second Copy meaning
 * something else entirely was a trap — and copying to paste made you visit two windows to do one
 * thing when the browser that picks a boss already exists. So the roster opens that browser
 * itself, and the NPC window's current frame can be taken as it stands for a boss built by hand.
 */
function addBar()
{
    const bar = document.createElement('div');
    bar.className = 'row raid-paste';

    const browse = document.createElement('button');
    browse.type = 'button';
    browse.className = 'add';
    browse.textContent = 'Browse dungeons & raids →';
    browse.addEventListener('click', async () =>
    {
        /*
         * Imported at the moment of use rather than at the top of the file: the browser imports
         * this module back, and loading each from the other's top level is a cycle.
         */
        const { openBrowser } = await import('./instances.js');

        openBrowser('raid');
    });

    /*
     * The second route is only available when there is something to take, and a disabled button
     * with a generic label reads as broken rather than as waiting — so it says whose frame it
     * would add, and when there is none it says what to do about it.
     */
    const fromEditor = document.createElement('button');
    fromEditor.type = 'button';
    fromEditor.className = 'add';
    fromEditor.textContent = state.unitName
        ? `Add ${state.unitName} from the NPC window`
        : 'Nothing in the NPC window yet';
    fromEditor.disabled = !state.unitName;
    fromEditor.title = state.unitName
        ? 'Adds the target frame exactly as the NPC window has it'
        : 'Build or load a creature in the NPC window, then come back - it will appear here by name';
    fromEditor.addEventListener('click', () => addBossFrame(fieldsOf('unit')));

    const blank = button('+ Add a boss', 'add', async () =>
    {
        if (!openRaid)
        {
            return;
        }

        const result = await postJson('api/raids/boss/add', { id: openRaid.id, name: 'New boss' });

        if (result.raid)
        {
            openRaid = result.raid;
            render();
        }
    }, 'A boss with a name and nothing else - fill it in from the Modify panel');

    bar.append(browse, fromEditor, blank);

    return bar;
}


/**
 * Adds a boss from a frame, wherever it came from.
 *
 * The browser hands over a difficulty tier — a creature with its own entry, health and mana — and
 * the NPC window hands over its editor fields. Both are turned into the same stored frame here, so
 * a raid cannot tell which route a boss took.
 */
/** The dungeon browser numbers difficulties 0-3; the model names them. */
function difficultyKeyOf(tier)
{
    return DIFFICULTIES[Number(tier.difficulty)]?.id || DIFFICULTIES[0].id;
}

async function addBossFrame(source)
{
    if (!openRaid || !source)
    {
        return;
    }

    const frame = source.unitName !== undefined
        ? source
        : {
            unitName: source.name,
            unitLevel: source.level,
            unitSkull: false,
            unitClassification: source.classification,
            unitReaction: 'hostile',
            unitHealth: source.health,
            unitHealthMax: source.health,
            unitShowHealthText: true,
            unitPower: source.power === 'mana' && source.mana > 0 ? 'mana' : 'none',
            unitPowerCur: source.mana || 0,
            unitPowerMax: source.mana || 0,
            unitDisplayId: source.displayId || 0
        };

    try
    {
        /*
         * The boss is named from the frame, and nothing else is carried over. A label like
         * "Festergut — Icecrown Citadel, 25 Heroic" is not a description: the note is the user's
         * own flavor text and starts empty, and what difficulty a frame came from is already
         * recorded by which difficulty it was filed under.
         */
        const result = await postJson('api/raids/boss/add', {
            id: openRaid.id,
            name: frame.unitName,
            difficulty: source.difficulty !== undefined ? difficultyKeyOf(source) : '10n',
            frame
        });

        if (result.raid)
        {
            openRaid = result.raid;
            render();
            status(`Added ${frame.unitName} to ${openRaid.name}`);
        }
    }
    catch (err)
    {
        status(`Could not add that boss: ${err.message}`);
    }
}

/* ------------------------------------------------------------------ actions */

/** Opens the icon dialog on the wizard's behalf. */
function pickIcon(onChosen)
{
    setIconTarget(onChosen);
    $('#icon-dialog').showModal();
    $('#icon-search').focus();
    renderIconGrid($('#icon-search').value);
}

async function createRaid()
{
    try
    {
        const result = await postJson('api/raids/create', { name: 'New raid' });

        openRaid = result.raid;
        render();
        status(`Created ${result.raid.name}`);
    }
    catch (err)
    {
        status(`Could not create the raid: ${err.message}`);
    }
}

async function open(id)
{
    try
    {
        const result = await api(`api/raids/get?id=${encodeURIComponent(id)}`);

        if (result.raid)
        {
            openRaid = result.raid;
            render();
        }
    }
    catch (err)
    {
        status(`Could not open that raid: ${err.message}`);
    }
}

async function saveRaid(patch)
{
    if (!openRaid)
    {
        return;
    }

    try
    {
        const result = await postJson('api/raids/update', { id: openRaid.id, patch });

        if (result.raid)
        {
            openRaid = result.raid;
            render();
        }
    }
    catch (err)
    {
        status(`Could not save: ${err.message}`);
    }
}

async function saveBoss(bossId, patch, redraw = false)
{
    try
    {
        const result = await postJson('api/raids/boss/update', { id: openRaid.id, bossId, patch });

        if (result.raid)
        {
            openRaid = result.raid;

            if (redraw)
            {
                render();
            }
        }
    }
    catch (err)
    {
        status(`Could not save that boss: ${err.message}`);
    }
}

async function moveBoss(bossId, delta)
{
    const result = await postJson('api/raids/boss/move', { id: openRaid.id, bossId, delta });

    if (result.raid)
    {
        openRaid = result.raid;
        render();
    }
}

async function removeBoss(bossId, name)
{
    const result = await postJson('api/raids/boss/delete', { id: openRaid.id, bossId });

    if (result.raid)
    {
        openRaid = result.raid;
        render();
        status(`Removed ${name}`);
    }
}

/** Draws the panel when the window is opened, and whenever a raid might have changed. */
function showRaids()
{
    if (openRaid)
    {
        open(openRaid.id);
    }
    else
    {
        refresh();
    }
}

export { showRaids, takeIcon, wantsIcon, addBossFrame };
