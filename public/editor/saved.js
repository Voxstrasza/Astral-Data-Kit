'use strict';

/*
 * Saved work, and the sheet you can draw from it.
 *
 * A window builds one thing; a set is what the work is usually about — a tier set, a boss's drops,
 * the achievements for a wing. Saving keeps what a window is showing, and the saved ones can be
 * drawn as a single picture instead of exported one at a time and arranged by hand.
 *
 * One panel serves every kind that can be saved. An item and an achievement differ only in which
 * window they came from and how they are drawn, and both of those are already known elsewhere —
 * FIELDS_BY_KIND says what to keep, and the renderers say how to draw it.
 */

import { $, el, button } from './dom.js';
import { api, postJson } from './api.js';
import { state, fieldsOf } from './state.js';
import { status, update } from './preview.js';
import { syncForm } from './form.js';
import { renderLists } from './lists.js';
import { iconUrl, setIcon } from './icons.js';
import { exportSetSheet, exportMixedSheet } from './raid-sheet.js';

/** What each kind is called on screen, and which field holds its name. */
const KINDS = {
    item: { title: 'items', name: 'name', icon: 'icon', sheet: 'Items' },
    spell: { title: 'spells', name: 'spellName', icon: 'spellIcon', sheet: 'Spells' },
    unit: { title: 'target frames', name: 'unitName', icon: 'icon', sheet: 'Target frames' },
    achievement: { title: 'achievements', name: 'achTitle', icon: 'achIcon', sheet: 'Achievements' }
};

/*
 * What is ticked, by kind.
 *
 * Selection spans the windows on purpose: the sheet worth building is usually a mixture — the
 * frames for a fight, the spells it casts and the gear it drops — and that means ticking things in
 * three windows and drawing them together.
 */
const selection = new Map();

/** The title the mixed sheet is drawn under. Shared, since the sheet is. */
let sheetTitle = '';

function selectedOf(kind)
{
    if (!selection.has(kind))
    {
        selection.set(kind, new Set());
    }

    return selection.get(kind);
}

/** Everything ticked, as the sheet builder wants it. */
function selectionForSheet()
{
    const out = {};
    let total = 0;

    for (const kind of Object.keys(KINDS))
    {
        const ticked = selectedOf(kind);
        const entries = (cache.get(kind) || []).filter((entry) => ticked.has(entry.id));

        if (entries.length)
        {
            out[kind] = entries;
            total += entries.length;
        }
    }

    return { selection: out, total };
}

/** What is saved, per kind, as the server last reported it. */
const cache = new Map();

/** The entry the window is currently editing, so saving again corrects it rather than copying it. */
const editing = new Map();

/**
 * The Armory piece a save would land on: the one already under this name, if there is one.
 *
 * There is deliberately no remembered id here. Holding on to the last piece saved meant the button
 * quietly became an overwrite: build a helm, save it, build a ring in the same window, press again
 * and the ring was written over the helm. Nothing on screen said so, and the helm was gone.
 *
 * The name is the identity instead, which is what the Armory already sorts and searches by, and
 * what is in front of you while you press the button. A ring is not called what the helm was
 * called, so it cannot land on it; the same piece saved twice corrects itself rather than
 * collecting duplicates; and renaming a piece and saving makes the new piece the name says it is.
 */
async function armoryEntryNamed(name)
{
    const wanted = name.trim().toLowerCase();

    try
    {
        const answer = await api('api/saved?kind=armory');

        return (answer.saved || []).find((one) => (one.name || '').trim().toLowerCase() === wanted)
            || null;
    }
    catch
    {
        /* Unreadable store: save as new rather than refuse. A duplicate can be deleted; a piece
           that would not save is work lost. */
        return null;
    }
}

async function refresh(kind)
{
    try
    {
        const result = await api(`api/saved?kind=${encodeURIComponent(kind)}`);

        cache.set(kind, result.saved || []);
    }
    catch (err)
    {
        status(`Could not read your saved ${KINDS[kind].title}: ${err.message}`);
        cache.set(kind, []);
    }

    render(kind);
}

/** Loads a saved entry back into its window. */
function load(kind, entry)
{
    for (const [field, value] of Object.entries(entry.fields || {}))
    {
        state[field] = value;
    }

    editing.set(kind, entry.id);

    syncForm();
    renderLists();
    setIcon(state[KINDS[kind].icon] || '');
    update();
    render(kind);

    status(`Loaded ${entry.name}`);
}

/**
 * Opens an Armory piece in the Item window, sent over by Modify in the gear picker.
 *
 * The reverse of Save for Armory. Nothing is remembered about where it came from: Save for Armory
 * finds it again by its name, so putting it back is the same act as saving it in the first place,
 * and leaving the name alone is what keeps it one piece. Renaming it and saving makes a second
 * piece under the new name, which is the honest reading of having renamed it.
 *
 * The saved-items list is deliberately left out of it — this piece is not in that store, and
 * pressing Save this item would be a different act entirely, so the entry that list was editing is
 * dropped rather than silently inherited by a piece from somewhere else.
 */
function modifyArmoryEntry(entry)
{
    for (const [field, value] of Object.entries(entry.fields || {}))
    {
        state[field] = value;
    }

    editing.delete('item');

    syncForm();
    renderLists();
    setIcon(state.icon || '');
    update();
    render('item');

    status(`Editing ${entry.name} from the Armory - Save for Armory puts it back.`);
}

async function saveCurrent(kind)
{
    const fields = fieldsOf(kind);
    const name = (fields[KINDS[kind].name] || '').trim();

    if (!name)
    {
        status(`Give it a name first - a saved ${kind} is found by its name.`);
        return;
    }

    try
    {
        const result = await postJson('api/saved/save', {
            kind,
            /* Saving again updates the entry being edited rather than making a second copy. */
            id: editing.get(kind) || '',
            fields
        });

        if (result.entry)
        {
            editing.set(kind, result.entry.id);
            status(`Saved ${result.entry.name}`);
            refresh(kind);

            return result.entry;
        }
    }
    catch (err)
    {
        status(`Could not save: ${err.message}`);
    }

    return null;
}

/**
 * Keep this item where the Armory can find it.
 *
 * It saves and stops there. Equipping it is the Armory's business, and a button that jumped you
 * into another window would be deciding for you that this piece is the one you want on right now,
 * which is rarely true while a set is being built.
 *
 * The store is the Armory's own folder, not the saved-items list this panel draws underneath. That
 * list is the one you tick and build a sheet from; a piece kept so a character can wear it is not
 * work waiting to be drawn, and putting it there padded the count with things nobody was going to
 * export. Deleting it lives with the Armory picker now, beside the piece it removes.
 *
 * One store rather than one per slot, though. A saved piece already carries the slot it was built
 * for, so the picker filters on that and cannot go stale; a per-slot folder would be chosen at save
 * time and wrong the moment the slot is edited.
 */
async function saveForArmory()
{
    const fields = fieldsOf('item');
    const name = (fields.name || '').trim();

    if (!name)
    {
        status('Give it a name first - the Armory finds a piece by its name.');
        return;
    }

    /* Only a piece already going by this name is corrected. Anything else is a new piece. */
    const already = await armoryEntryNamed(name);
    let entry = null;

    try
    {
        const result = await postJson('api/saved/save',
            { kind: 'armory', id: already ? already.id : '', fields });

        entry = result.entry;
    }
    catch (err)
    {
        status(`Could not save: ${err.message}`);
        return;
    }

    if (!entry)
    {
        return;
    }

    /* The saved entry is a wrapper; the item itself is `fields`. */
    const item = entry.fields || {};

    /*
     * The warning is the point of saying anything at all here. Only the editor's preset lines are
     * priced and read; a stat written as its own sentence is prose to the program, and a piece full
     * of them reads on the character sheet as a piece with no stats, with nothing to say why.
     */
    const written = (item.effects || []).filter((e) => e.preset === 'custom' && e.text).length;
    const where = item.slot
        ? `under Custom gear in the ${item.slot} slot`
        : 'under Custom gear, though with no slot set nothing will offer it';

    status(`${already ? 'Updated' : 'Saved'} ${entry.name} ${where}.`
        + (written
            ? ` ${written} hand-written line${written === 1 ? '' : 's'} will not be read`
                + ' - only the preset ones move the sheet.'
            : ''));
}

async function remove(kind, entry)
{
    await postJson('api/saved/delete', { kind, id: entry.id });

    if (editing.get(kind) === entry.id)
    {
        editing.delete(kind);
    }

    status(`Removed ${entry.name}`);
    refresh(kind);
}

/** Draws every saved entry of a kind as one sheet. */
async function exportSet(kind)
{
    const entries = cache.get(kind) || [];

    if (!entries.length)
    {
        status(`Nothing saved yet - save a few ${KINDS[kind].title} first.`);
        return;
    }

    await exportSetSheet(kind, entries, sheetTitle.trim() || KINDS[kind].sheet);
}

function render(kind)
{
    const host = $(`#saved-${kind}`);

    if (!host)
    {
        return;
    }

    host.textContent = '';

    const entries = cache.get(kind) || [];
    const current = editing.get(kind);

    const bar = el('div', 'row');

    bar.appendChild(button(
        current ? 'Save changes' : `Save this ${kind}`,
        'add',
        () => saveCurrent(kind),
        current ? 'Updates the entry loaded from the list' : 'Keeps what this window is showing'
    ));

    if (current)
    {
        bar.appendChild(button('Save as new', 'add', () =>
        {
            editing.delete(kind);
            saveCurrent(kind);
        }, 'Keeps this as a second entry rather than replacing the one it came from'));
    }

    bar.appendChild(button(`Build a PNG of all ${entries.length}`, 'add',
        () => exportSet(kind),
        `Draws every saved ${kind} as one sheet, under the title below`));

    /*
     * Items only, and off on its own at the right: this is the one button here that is not about
     * the saved list, so it reads better apart from the three that are.
     */
    if (kind === 'item')
    {
        const armory = button('Save for Armory', 'add', saveForArmory,
            'Saves this item where the Armory can find it, under the slot it is built for. A piece'
            + ' already saved under this name is corrected; any other name is a new piece. Only the'
            + ' preset stat lines are read - a stat written as its own sentence will not move the'
            + ' sheet.');

        armory.classList.add('to-armory');
        bar.appendChild(armory);
    }

    host.appendChild(bar);

    /*
     * The title every sheet from this panel is drawn under. It sits above both buttons rather than
     * beside one of them, because it belongs to whichever of them is pressed.
     */
    if (entries.length)
    {
        const titleRow = el('div', 'row saved-sheet');
        const title = el('input', 'saved-title');

        title.type = 'text';
        title.value = sheetTitle;
        title.placeholder = 'Sheet title - Tier 10 set, Marrowgar, whatever it is';
        title.addEventListener('input', () => { sheetTitle = title.value; });

        titleRow.appendChild(title);
        host.appendChild(titleRow);
    }

    /*
     * The mixed sheet: whatever is ticked here and in the other windows, under a title of your
     * own. It only appears once something is ticked, so the panel stays quiet until it is wanted.
     */
    const picked = selectionForSheet();

    if (picked.total)
    {
        const mixed = el('div', 'row saved-mixed');

        const parts = Object.entries(picked.selection)
            .map(([which, list]) =>
            {
                const name = KINDS[which].title;

                /* One of a thing is not "1 items"; the plural is only right past one. */
                return `${list.length} ${list.length === 1 ? name.replace(/s$/, '') : name}`;
            })
            .join(', ');

        mixed.append(
            button(`Build a sheet of ${parts}`, 'primary',
                () => exportMixedSheet(picked.selection, sheetTitle || 'Saved work'),
                'Draws everything ticked, across every window'),
            button('Clear', 'add', () =>
            {
                selection.clear();
                render(kind);
            }, 'Unticks everything, in every window')
        );

        host.appendChild(mixed);
    }

    if (!entries.length)
    {
        host.appendChild(el('p', 'hint',
            `Nothing saved yet. Build one above and press Save - saved ${KINDS[kind].title} are kept `
            + 'in your own data folder and are still here next session.'));

        return;
    }

    const list = el('div', 'saved-list');

    for (const entry of entries)
    {
        const row = el('div', 'raid-attach');

        const tick = el('input', 'saved-tick');
        tick.type = 'checkbox';
        tick.checked = selectedOf(kind).has(entry.id);
        tick.title = 'Include this in a mixed sheet';
        tick.addEventListener('change', () =>
        {
            const ticked = selectedOf(kind);

            if (tick.checked)
            {
                ticked.add(entry.id);
            }
            else
            {
                ticked.delete(entry.id);
            }

            render(kind);
        });

        row.appendChild(tick);

        if (entry.icon)
        {
            const img = el('img', 'raid-attach-icon');
            img.src = iconUrl(entry.icon);
            img.alt = '';
            row.appendChild(img);
        }

        const open = button(entry.name, 'saved-name', () => load(kind, entry), 'Load this back in');

        open.classList.toggle('active', entry.id === current);
        row.appendChild(open);

        row.appendChild(button('×', 'raid-mini', () => remove(kind, entry), 'Remove from saved'));
        list.appendChild(row);
    }

    host.appendChild(list);
}

/** Draws the panels for the windows that have one, and keeps them in step. */
function bindSaved()
{
    for (const kind of Object.keys(KINDS))
    {
        if ($(`#saved-${kind}`))
        {
            refresh(kind);
        }
    }
}

/** Redraws a kind's panel — the Save button's label follows what is loaded. */
function refreshSaved(kind)
{
    if ($(`#saved-${kind}`))
    {
        render(kind);
    }
}

export { bindSaved, refreshSaved, modifyArmoryEntry };
