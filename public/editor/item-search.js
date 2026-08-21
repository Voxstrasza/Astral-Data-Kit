'use strict';

/*
 * Item search against the world database, and the loot browser behind it.
 *
 * Deliberately parallel to the NPC finder: same place on screen, same debounce, same result rows.
 * Two ways in, as the NPC window has: type a name, or walk expansion -> instance -> boss and take
 * what that boss drops. The second is the one that makes a raid's rewards browsable — a boss's
 * loot is where a custom item should start from, because it is already tuned for the fight.
 */

import { $ } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';
import { status, update } from './preview.js';
import { syncForm } from './form.js';
import { renderLists } from './lists.js';
import { setIcon, iconUrl } from './icons.js';
import { M } from './wow.js';
import { syncTier } from './item-wizard.js';

/* Quality -> the colour the game paints an item name in. Same table the tooltip renderer uses. */
const QUALITY_COLOR = (quality) => M.qualityColor(quality);

/**
 * Loads a database item into the item editor.
 *
 * Only the item window's fields are written, so a loaded item cannot disturb the spell or target
 * frame in the next tab — the same contract resetKind() keeps.
 */
function applyItem(item)
{
    const fields = [
        'name', 'quality', 'heroic', 'binding', 'slot', 'itemType', 'hasWeapon', 'dmgMin',
        'dmgMax', 'speed', 'armor', 'block', 'durability', 'reqLevel', 'itemLevel', 'stats',
        'resistances', 'effects', 'sockets', 'socketBonus', 'flavor', 'sellGold', 'sellSilver',
        'sellCopper'
    ];

    for (const field of fields)
    {
        if (item[field] !== undefined)
        {
            state[field] = item[field];
        }
    }

    if (item.icon)
    {
        state.icon = item.icon;
    }

    syncForm();
    renderLists();
    setIcon(state.icon);
    update();

    /* The wizard follows the item in, so pricing and generating act on the tier it came from. */
    syncTier();

    status(`Loaded ${item.name} — item ${item.entry}, ilvl ${item.itemLevel}`);
}

async function loadItem(entry)
{
    try
    {
        const result = await api(`api/item/get?entry=${encodeURIComponent(entry)}`);

        if (result.item)
        {
            applyItem(result.item);
        }
        else
        {
            status(`Could not load item ${entry}: ${result.error || 'not found'}`);
        }
    }
    catch (err)
    {
        status(`Could not load item ${entry}: ${err.message}`);
    }
}

/**
 * One result row: icon, name in its quality colour, then what it is.
 *
 * The icon is worth the request here in a way it is not for a creature — an item is recognised by
 * its icon long before its name is read, and the icon is already cached by the picker.
 */
function itemRow(item, extra)
{
    const row = document.createElement('button');
    row.type = 'button';
    row.className = 'npc-row item-row';

    if (item.icon)
    {
        const img = document.createElement('img');
        img.className = 'item-row-icon';
        img.src = iconUrl(item.icon);
        img.alt = '';
        row.appendChild(img);
    }

    const text = document.createElement('span');
    text.className = 'item-row-text';

    const name = document.createElement('span');
    name.className = 'npc-name';
    name.textContent = item.name;
    name.style.color = QUALITY_COLOR(item.quality);

    const meta = document.createElement('span');
    meta.className = 'npc-meta';
    meta.textContent = [
        item.itemLevel ? `ilvl ${item.itemLevel}` : '',
        item.slot,
        item.type,
        extra,
        `#${item.entry}`
    ].filter(Boolean).join(' · ');

    text.append(name, meta);
    row.appendChild(text);

    row.addEventListener('click', () =>
    {
        loadItem(item.entry);

        /* Picked out of the loot dialog: get out of the way so the tooltip is visible. */
        const dialog = $('#instance-dialog');

        if (dialog && dialog.open)
        {
            dialog.close();
        }
    });

    return row;
}

function renderItemResults(results, host = '#item-results')
{
    const target = $(host);
    target.textContent = '';

    for (const item of results)
    {
        const drop = item.drop && item.drop.chance ? `${item.drop.chance}%` : '';
        target.appendChild(itemRow(item, drop));
    }
}

function bindItemSearch()
{
    const input = $('#item-search');

    if (!input)
    {
        return;
    }

    let timer = null;

    input.addEventListener('input', (e) =>
    {
        const query = e.target.value.trim();
        clearTimeout(timer);

        if (query.length < 2)
        {
            renderItemResults([]);
            return;
        }

        /* Debounced as the other finders are: item_template is 40,000 rows to scan. */
        timer = setTimeout(async () =>
        {
            try
            {
                const result = await api(`api/item/search?q=${encodeURIComponent(query)}`);

                if (result.error === 'not-connected')
                {
                    $('#item-hint').textContent = 'Connect your world database in Settings to search items.';
                }

                renderItemResults(result.results || []);
            }
            catch
            {
                renderItemResults([]);
            }
        }, 250);
    });
}

/**
 * Loads one boss's drop list into the loot panel, for one difficulty.
 *
 * The difficulty is the whole point: loot lives on the difficulty creature, not the encounter, so
 * Marrowgar 10-normal and Marrowgar 25-heroic are different rows with different lists — ilvl 251
 * against 277. Asking for the base entry alone shows a quarter of what the encounter drops.
 */
async function showLoot(boss, instance, tier, difficultyLabel, onBack)
{
    const host = $('#boss-list');
    host.textContent = '';

    const entry = (tier && tier.entry) || boss.entry || 0;

    /*
     * Two extra sources beside the boss's own corpse.
     *
     * `also` is the rest of a multi-creature fight — the Twin Val'kyr keep half their table on
     * Fjola and half on Eydis, so asking only the encounter's creature loses half the drops.
     * `chests` is the gameobject a scripted fight leaves instead of a corpse.
     */
    const also = (boss.members || [])
        .map((member) => (member.difficulties || []).find((d) => !tier || d.difficulty === tier.difficulty))
        .map((found) => found && found.entry)
        .filter((id) => id && id !== entry);

    const chest = (boss.chests || []).find((c) => !tier || c.difficulty === tier.difficulty);
    const chests = chest ? chest.gameobjects : [];

    /*
     * A way back to the roster.
     *
     * The drop list replaces the boss list in the same column, so without this the difficulty
     * buttons are gone the moment one of them is used and the only route to 25-heroic is to
     * reopen the instance.
     */
    if (onBack)
    {
        const back = document.createElement('button');
        back.type = 'button';
        back.className = 'loot-back';
        back.textContent = '← All bosses';
        back.addEventListener('click', onBack);
        host.appendChild(back);
    }

    const heading = document.createElement('h4');
    heading.textContent = `${boss.name} — ${instance ? instance.name : ''}`
        + (difficultyLabel ? `, ${difficultyLabel}` : '');
    host.appendChild(heading);

    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Loading drops…';
    host.appendChild(note);

    try
    {
        const query = [
            entry ? `creature=${encodeURIComponent(entry)}` : '',
            also.length ? `also=${also.join(',')}` : '',
            chests.length ? `chests=${chests.join(',')}` : ''
        ].filter(Boolean).join('&');

        const result = await api(`api/item/loot?${query}`);

        note.remove();

        if (result.error === 'not-connected')
        {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = 'Connect your world database in Settings to read loot tables.';
            host.appendChild(hint);
            return;
        }

        const results = result.results || [];

        if (!results.length)
        {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = 'No loot recorded for this one.';
            host.appendChild(hint);
            return;
        }

        for (const item of results)
        {
            host.appendChild(itemRow(item, item.drop && item.drop.viaReference ? 'reference' : ''));
        }
    }
    catch (err)
    {
        note.textContent = `Could not read loot: ${err.message}`;
    }
}

/**
 * The Misc lists: an expansion's currency, or its mount drops.
 *
 * Neither belongs under a boss. Every boss in a tier hands out the same emblem, and a mount is
 * the one drop people go looking for by name rather than by fight, so both are listed once for
 * the expansion instead of repeated down the roster.
 */
async function showMisc(kind, expansion, label)
{
    const host = $('#boss-list');
    host.textContent = '';

    const heading = document.createElement('h4');
    heading.textContent = `${label} — ${expansion.name}`;
    host.appendChild(heading);

    const note = document.createElement('p');
    note.className = 'hint';
    note.textContent = 'Loading…';
    host.appendChild(note);

    try
    {
        const result = await api(`api/item/misc?kind=${encodeURIComponent(kind)}&xpac=${expansion.id}`);

        note.remove();

        const results = result.results || [];

        if (!results.length)
        {
            const hint = document.createElement('p');
            hint.className = 'hint';
            hint.textContent = result.error === 'not-connected'
                ? 'Connect your world database in Settings to read loot tables.'
                : 'Nothing of this kind drops in this expansion.';
            host.appendChild(hint);
            return;
        }

        for (const item of results)
        {
            host.appendChild(itemRow(item));
        }
    }
    catch (err)
    {
        note.textContent = `Could not read the list: ${err.message}`;
    }
}

export { bindItemSearch, applyItem, loadItem, showLoot, showMisc, itemRow, renderItemResults };
