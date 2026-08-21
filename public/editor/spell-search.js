'use strict';

/*
 * Spell search, reading the client's Spell.dbc through the data API.
 *
 * Deliberately parallel to the NPC finder: same place on screen, same debounce, same result list.
 * The difference is where the data comes from — a spell needs no world database, only a client,
 * because everything a spell tooltip shows is in the DBCs.
 */

import { $ } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';
import { status, update } from './preview.js';
import { syncForm } from './form.js';
import { setIcon } from './icons.js';
import { M } from './wow.js';

function applySpell(spell)
{
    state.spellName = spell.name;
    state.rank = spell.rank || '';
    state.cost = spell.cost || '';
    state.range = spell.range || '';
    state.castTime = spell.castTime || '';
    state.cooldown = spell.cooldown || '';
    state.description = spell.description || '';

    if (spell.icon)
    {
        state.spellIcon = spell.icon;
    }

    syncForm();

    // syncForm repaints the icon from state; this loads the image behind it.
    setIcon(state.spellIcon);
    update();

    status(`Loaded ${spell.name}${spell.rank ? ` (${spell.rank})` : ''} — spell ${spell.id}`);
}

function renderSpellResults(results)
{
    const host = $('#spell-results');
    host.textContent = '';

    if (!results.length)
    {
        return;
    }

    for (const spell of results)
    {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'npc-row';

        const name = document.createElement('span');
        name.className = 'npc-name';
        // The field takes the bare number; the list reads better with the word on it.
        name.textContent = spell.name + (spell.rank ? ` <${M.rankLabel(spell.rank)}>` : '');

        const meta = document.createElement('span');
        meta.className = 'npc-meta';
        meta.textContent = [spell.castTime, spell.range, `#${spell.id}`].filter(Boolean).join(' · ');

        row.append(name, meta);
        row.addEventListener('click', () => applySpell(spell));
        host.appendChild(row);
    }
}

function bindSpellSearch()
{
    const input = $('#spell-search');

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
            renderSpellResults([]);
            return;
        }

        // Debounced, as the NPC search is: Spell.dbc has 49,000 rows to scan.
        timer = setTimeout(async () =>
        {
            try
            {
                const result = await api(`api/spells/search?q=${encodeURIComponent(query)}`);

                if (result.error === 'no-client')
                {
                    $('#spell-hint').textContent = 'Point at your 3.3.5a folder in Settings to search spells.';
                }

                renderSpellResults(result.results || []);
            }
            catch
            {
                renderSpellResults([]);
            }
        }, 250);
    });
}

export { bindSpellSearch, applySpell };
