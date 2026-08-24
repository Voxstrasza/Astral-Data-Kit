'use strict';

/* Creature search against the world database, and filling the unit frame from a result. */

import { $ } from './dom.js';
import { state } from './state.js';
import { status, update } from './preview.js';
import { syncForm } from './form.js';

function applyNpc(npc)
{
    state.unitName = npc.name;
    state.unitLevel = npc.level;
    state.unitClassification = npc.classification;
    state.unitDisplayId = npc.displayId;
    state.unitSkull = false;

    // A fresh pool from the database, so any custom scaling starts over with it.
    state.unitScalePct = 0;
    state.unitScaleBase = null;
    state.unitPowerScalePct = 0;
    state.unitPowerScaleBase = null;

    // Real pools from the database, full by default.
    if (npc.health > 0)
    {
        state.unitHealthMax = npc.health;
        state.unitHealth = npc.health;
    }

    /*
     * A power bar only when the creature really has a pool to show.
     *
     * Taking npc.power at face value put a full rage bar on every warrior-classed boss — the
     * Lich King came through reading 20000/20000 rage, which was simply the leftover default,
     * since rage and energy creatures carry no stored pool to replace it with.
     */
    if (npc.power === 'mana' && npc.mana > 0)
    {
        state.unitPower = 'mana';
        state.unitPowerMax = npc.mana;
        state.unitPowerCur = npc.mana;
    }
    else
    {
        state.unitPower = 'none';
    }

    syncForm();
    update();

    const pool = npc.health > 0 ? ` - ${npc.health.toLocaleString()} HP` : '';
    status(`Loaded ${npc.name} (entry ${npc.entry})${pool}`);
}

function renderNpcResults(results)
{
    const host = $('#npc-results');
    host.textContent = '';

    if (!results.length)
    {
        return;
    }

    for (const npc of results)
    {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'npc-row';

        const name = document.createElement('span');
        name.className = 'npc-name';
        name.textContent = npc.name + (npc.subname ? ` <${npc.subname}>` : '');

        const meta = document.createElement('span');
        meta.className = 'npc-meta';
        meta.textContent = `lvl ${npc.level} · ${npc.classification} · #${npc.entry}`;

        row.append(name, meta);
        row.addEventListener('click', () => applyNpc(npc));
        host.appendChild(row);
    }
}

export { applyNpc, renderNpcResults };
