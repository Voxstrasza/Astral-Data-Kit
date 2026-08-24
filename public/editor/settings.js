'use strict';

/* The settings dialog: the client folder and the optional world-database connection. */

import { $ } from './dom.js';
import { state, runtime } from './state.js';
import { api, postJson } from './api.js';
import { status, update } from './preview.js';
import { setIcon, loadIcons, loadGameFonts, loadAssets } from './icons.js';

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

        $('#client-path').value = info.settings.clientPath || '';
        $('#db-enabled').checked = !!info.settings.db.enabled;
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
            ? `Ready - ${client.icons.toLocaleString()} icons available.`
            : `Could not use that folder: ${client.reason || 'unknown error'}`;

        await refreshStatus();

        if (client.ok)
        {
            await Promise.all([loadIcons(), loadGameFonts(), loadAssets()]);
            setIcon(state.icon);
            update();
        }
    }
    catch (err)
    {
        $('#client-status').textContent = `Failed: ${err.message}`;
    }
}

async function applyDbSettings()
{
    $('#db-status').textContent = 'Connecting…';

    const db = {
        enabled: $('#db-enabled').checked,
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

    try
    {
        const result = await postJson('api/settings', { db });
        const outcome = result.db || {};

        $('#db-status').textContent = outcome.ok
            ? `Connected - ${outcome.creatures.toLocaleString()} creatures.`
            : `Not connected: ${outcome.reason || 'unknown error'}`;

        await refreshStatus();
    }
    catch (err)
    {
        $('#db-status').textContent = `Failed: ${err.message}`;
    }
}

export { paintBadges, refreshStatus, applyClientPath, applyDbSettings };
