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
        }
    }
    catch (err)
    {
        status(`Could not save: ${err.message}`);
    }
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

export { bindSaved, refreshSaved };
