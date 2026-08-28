'use strict';

/* The settings dialog: the client folder and the optional world-database connection. */

import { $ } from './dom.js';
import { state, runtime } from './state.js';
import { api, postJson } from './api.js';
import { status, update } from './preview.js';
import { setIcon, currentIconName, loadIcons, loadGameFonts, loadAssets } from './icons.js';
import { initArmory } from './armory.js';

/*
 * The two badges in the top bar.
 *
 * Both read the same way — a name, then whether it is connected — so the pair can be taken in at
 * a glance rather than one saying "6,308 icons" and the other something else entirely. The icon
 * count and the database name move to the tooltip, where the detail belongs.
 */
function paintBadges(db)
{
    const client = $('#client-badge');
    const ready = runtime.clientStatus.ready;

    client.textContent = ready ? 'client: connected' : 'client: not connected';
    client.className = ready ? 'badge ok' : 'badge off';
    client.title = ready
        ? `${runtime.clientStatus.clientPath} - ${runtime.clientStatus.iconCount.toLocaleString()} icons`
        : 'Open Settings and point at your 3.3.5a folder';

    const badge = $('#db-badge');
    const connected = !!(db && db.connected);

    badge.textContent = connected ? 'database: connected' : 'database: not connected';
    badge.className = connected ? 'badge ok' : 'badge off';
    badge.title = connected
        ? 'World database connected - creature, item and loot search are available'
        : (db && db.error) || 'Connect your world database in Settings';
}

async function refreshStatus()
{
    try
    {
        const info = await api('api/status');
        runtime.clientStatus = info.client;

        /* The build, in the corner. It cannot change while the window is open, so this is the once. */
        const version = $('#app-version');

        if (version && info.version)
        {
            version.textContent = `v${info.version}`;
            version.title = `Astral ${info.version}`;
        }

        $('#client-path').value = info.settings.clientPath || '';
        $('#db-host').value = info.settings.db.host;
        $('#db-port').value = info.settings.db.port;
        $('#db-user').value = info.settings.db.user;
        $('#db-database').value = info.settings.db.database;

        const npcSearch = $('#npc-search');
        npcSearch.disabled = !info.db.connected;

        const itemSearch = $('#item-search');

        if (itemSearch)
        {
            itemSearch.disabled = !info.db.connected;
            $('#item-hint').textContent = info.db.connected
                ? 'Search items by name or entry id, or browse a boss\'s drops. Picking one loads it into the editor.'
                : 'Connect your world database in Settings to search items by name or entry id.';
        }
        $('#npc-hint').textContent = info.db.connected
            ? 'Search creatures by name or entry id. Picking one fills in name, level and classification.'
            : 'Connect your world database in Settings to search creatures by name or entry id.';

        paintBadges(info.db);
        return info;
    }
    catch (err)
    {
        status(`Could not read app status: ${err.message}`);
        return null;
    }
}

async function applyClientPath(pathValue)
{
    $('#client-status').textContent = 'Indexing archives…';

    try
    {
        const result = await postJson('api/settings', { clientPath: pathValue });
        const client = result.client || {};

        $('#client-status').textContent = client.ok
            ? readyLine(client)
            : `Could not use that folder: ${client.reason || 'unknown error'}`;

        await refreshStatus();

        if (client.ok)
        {
            await Promise.all([loadIcons(), loadGameFonts(), loadAssets(), initArmory()]);

            /*
             * Repaint whichever window is showing, not the item one.
             *
             * `setIcon` writes into the current mode's own icon field, so handing it `state.icon`
             * while the Spell window was open assigned the item's icon to the spell - importing a
             * client turned a question mark into a sword. `currentIconName()` is the same value for
             * the item window and the right one everywhere else.
             */
            setIcon(currentIconName());
            update();
        }
    }
    catch (err)
    {
        $('#client-status').textContent = `Failed: ${err.message}`;
    }
}

/**
 * What a freshly opened client came with.
 *
 * Both places that import one say it the same way, so the count cannot end up different depending
 * on whether the folder was typed or browsed for. The spell count is left off rather than printed
 * as zero when the table would not parse - a client with icons and no spells is still usable, and
 * "0 spells" reads like a failure when the icons plainly worked.
 */
function readyLine(client)
{
    const spells = Number(client.spells) || 0;

    return `Ready - ${(client.icons || 0).toLocaleString()} icons`
        + (spells ? `, ${spells.toLocaleString()} spells` : '')
        + ' available.';
}

/** What the form is showing, minus `enabled`, which each caller decides for itself. */
function currentDbForm()
{
    const db = {
        host: $('#db-host').value.trim(),
        port: Number($('#db-port').value) || 3306,
        user: $('#db-user').value.trim(),
        database: $('#db-database').value.trim()
    };

    // Only send a password when one was typed, so the stored value survives an edit.
    const typed = $('#db-password').value;

    if (typed)
    {
        db.password = typed;
    }

    return db;
}

async function applyDbSettings()
{
    $('#db-status').textContent = 'Connecting…';

    /*
     * Connecting is what asks for it, so there is no separate tick to say so. `enabled` is still
     * the flag the server reads at start-up to decide whether to open a pool; this button sets it
     * and Disconnect clears it.
     */
    const db = { ...currentDbForm(), enabled: true };

    try
    {
        const result = await postJson('api/settings', { db });
        const outcome = result.db || {};

        $('#db-status').textContent = outcome.ok
            ? `Connected - ${outcome.creatures.toLocaleString()} creatures,`
                + ` ${outcome.items.toLocaleString()} items.`
            : `Not connected: ${outcome.reason || 'unknown error'}`;

        await refreshStatus();
    }
    catch (err)
    {
        $('#db-status').textContent = `Failed: ${err.message}`;
    }
}

/**
 * Unhook the database without forgetting how to reach it.
 *
 * The host, user and database stay in the form and on disk, so reconnecting is one press rather
 * than typing it all again. Only `enabled` changes, which is what the server reads to decide
 * whether to hold a pool open at all.
 */
async function disconnectDb()
{
    $('#db-status').textContent = 'Disconnecting…';

    try
    {
        await postJson('api/settings', { db: { ...currentDbForm(), enabled: false } });

        $('#db-status').textContent = 'Disconnected. NPC and Item search are off until you connect'
            + ' again; everything that reads the client still works.';

        await refreshStatus();
    }
    catch (err)
    {
        $('#db-status').textContent = `Failed: ${err.message}`;
    }
}

export { paintBadges, refreshStatus, applyClientPath, applyDbSettings, disconnectDb, readyLine };
