'use strict';

/*
 * Start-up and control wiring.
 *
 * These files are ES modules, which is load-bearing rather than a matter of taste. In a classic
 * script a top-level `const $` creates a global lexical binding that shadows `window.$` — that
 * silently replaced jQuery for the 3D model viewer loaded later and broke it with
 * "$.ajaxSetup is not a function". Module scope keeps the name local, so the real jQuery stays
 * visible without the whole file having to sit inside an IIFE.
 */

import { $, $$ } from './dom.js';
import { state, setState, runtime, view, resetKind, defaultState, decodeState } from './state.js';
import { api } from './api.js';
import { renderLists, LIST_DEFAULTS } from './lists.js';
import { populateSelects, bindInputs, syncForm } from './form.js';
import { setIcon, currentIconName, renderIconGrid, loadIcons, loadAssets, loadGameFonts, bindCustomIcons } from './icons.js';
import { update, status, exportCanvas, exportParts, fileName } from './preview.js';
import { refreshStatus, applyClientPath, applyDbSettings } from './settings.js';
import { renderNpcResults } from './npc.js';
import { autoPortrait } from './model-viewer.js';
import { bindBrowser } from './instances.js';
import { bindTheme } from './theme.js';
import { bindSpellSearch } from './spell-search.js';
import { bindItemSearch } from './item-search.js';
import { bindItemWizard } from './item-wizard.js';
import { showRaids, releaseIcon } from './raids.js';
import { bindSaved } from './saved.js';
import { bindAchievementSearch, loadAchievementCategories } from './achievement.js';
import { seedExample } from './example.js';
import { M } from './wow.js';

async function init()
{
    populateSelects();
    bindInputs();

    await refreshStatus();
    await Promise.all([loadIcons(), loadAssets(), loadGameFonts(), loadAchievementCategories()]);

    if (location.hash.length > 1)
    {
        try
        {
            setState({ ...defaultState(), ...decodeState(location.hash.slice(1)) });
        }
        catch
        {
            status('That link could not be read - starting from a fresh tooltip.');
        }
    }
    else
    {
        seedExample();
    }

    // Fall back gracefully if the seeded icon is missing from this icon set.
    for (const field of ['icon', 'spellIcon'])
    {
        if (state[field] && runtime.iconNames.length && !runtime.iconNames.includes(state[field]))
        {
            state[field] = '';
        }
    }

    syncForm();
    renderLists();
    update();

    /* controls */

    $$('.kind-switch button').forEach((btn) => btn.addEventListener('click', () =>
    {
        state.kind = btn.dataset.kind;
        syncForm();

        if (state.kind === 'raid')
        {
            showRaids();
        }
        // Each mode has its own icon, so reload the image for the one now showing.
        setIcon(currentIconName());
        update();
    }));

    $$('[data-add]').forEach((btn) => btn.addEventListener('click', () =>
    {
        const name = btn.dataset.add;
        state[name] = state[name] || [];
        state[name].push(LIST_DEFAULTS[name]());
        renderLists();
        update();
    }));

    $$('[data-socket]').forEach((btn) => btn.addEventListener('click', () =>
    {
        state.sockets.push(btn.dataset.socket);
        renderLists();
        update();
    }));

    $('#health-slider').addEventListener('input', (e) =>
    {
        const max = Math.max(1, Number(state.unitHealthMax) || 1);
        state.unitHealth = Math.round(max * (Number(e.target.value) / 100));
        $('[data-bind="unitHealth"]').value = state.unitHealth;
        $('#health-pct').textContent = `${e.target.value}%`;
        update();
    });

    for (const id of ['icon-btn', 'icon-btn-spell', 'icon-btn-ach'])
    {
        $(`#${id}`).addEventListener('click', () =>
        {
            $('#icon-dialog').showModal();
            $('#icon-search').focus();
            renderIconGrid($('#icon-search').value);
        });
    }

    $('#icon-search').addEventListener('input', (e) => renderIconGrid(e.target.value));

    /*
     * The picker is one dialog serving several askers, so closing it ends whoever asked. Without
     * this, a raid logo pick abandoned with Close or Escape stayed armed and ate the next icon
     * chosen in any window.
     */
    $('#icon-dialog').addEventListener('close', releaseIcon);

    bindRoadmap();
    bindItemSearch();
    bindItemWizard();
    bindSaved();

    /*
     * These all write into the current mode's own view settings, so ticking transparent while
     * building a target frame leaves the item exporter alone.
     */
    $('#max-width').addEventListener('input', (e) =>
    {
        view().maxWidth = Number(e.target.value);
        update();
    });

    $('#opt-transparent').addEventListener('change', (e) =>
    {
        view().transparent = e.target.checked;
        update();
    });

    $('#opt-quality-border').addEventListener('change', (e) =>
    {
        view().qualityBorder = e.target.checked;
        update();
    });

    $('#opt-icon-placement').addEventListener('change', (e) =>
    {
        view().iconPlacement = e.target.value;
        update();
    });

    $('#preview-zoom').addEventListener('change', (e) =>
    {
        view().zoom = Number(e.target.value);
        update();
    });

    $('#export-scale').addEventListener('change', (e) =>
    {
        view().exportScale = Number(e.target.value);
    });

    $('#opt-checker').addEventListener('change', (e) =>
    {
        view().checker = e.target.checked;
        $('#stage').classList.toggle('checker', e.target.checked);
    });

    /*
     * A spell with an aura saves two files rather than one tall one.
     *
     * They are two tooltips in the game and two things to use afterwards — the spell for the
     * ability, the aura for what it leaves behind — so stitching them into a single image made
     * both of them harder to use than either alone.
     */
    $('#btn-png').addEventListener('click', () =>
    {
        const parts = exportParts();

        for (const part of parts)
        {
            const link = document.createElement('a');
            link.download = part.name;
            link.href = part.canvas.toDataURL('image/png');
            link.click();
        }

        status(parts.length > 1
            ? `Saved ${parts.map((p) => p.name).join(' and ')}`
            : `Saved ${parts[0].name}`);
    });

    /* Copy still hands over one image: the clipboard holds one thing at a time. */
    $('#btn-copy').addEventListener('click', () =>
    {
        exportCanvas().toBlob(async (blob) =>
        {
            try
            {
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                status('Image copied to the clipboard.');
            }
            catch
            {
                status('Your browser blocked the clipboard - use Download PNG instead.');
            }
        });
    });

    /*
     * Clears the window you are looking at, and only that one.
     *
     * The global Reset it replaces emptied all three editors and dropped you back on Item, so
     * resetting a target frame moved you to a different tab as well as clearing it.
     */
    $('#btn-reset-window').addEventListener('click', () =>
    {
        resetKind(state.kind);

        if (state.kind === 'unit')
        {
            runtime.portraitImage = null;
        }
        else
        {
            runtime.iconImage = null;
        }

        syncForm();
        setIcon(currentIconName());
        renderLists();
        update();
        status('Cleared this window.');
    });

    /* settings */

    $('#btn-settings').addEventListener('click', () =>
    {
        $('#settings-dialog').showModal();
        refreshStatus();
    });

    $('#btn-apply-client').addEventListener('click', () => applyClientPath($('#client-path').value.trim()));
    $('#btn-apply-db').addEventListener('click', applyDbSettings);

    // The native folder picker only exists in the desktop shell.
    if (window.astral && window.astral.isDesktop)
    {
        $('#btn-browse').addEventListener('click', async () =>
        {
            const result = await window.astral.chooseClientFolder();

            if (result.canceled)
            {
                return;
            }

            $('#client-path').value = result.path;
            $('#client-status').textContent = result.ok
                ? `Ready - ${(result.icons || 0).toLocaleString()} icons available.`
                : `Could not use that folder: ${result.reason}`;

            await refreshStatus();

            if (result.ok)
            {
                await Promise.all([loadIcons(), loadGameFonts(), loadAssets()]);
                update();
            }
        });
    }
    else
    {
        $('#btn-browse').hidden = true;
    }

    /* NPC search */

    let npcTimer = null;

    $('#npc-search').addEventListener('input', (e) =>
    {
        const query = e.target.value.trim();
        clearTimeout(npcTimer);

        if (query.length < 2)
        {
            renderNpcResults([]);
            return;
        }

        // Debounced so typing a name does not fire a query per keystroke.
        npcTimer = setTimeout(async () =>
        {
            try
            {
                const result = await api(`api/npc/search?q=${encodeURIComponent(query)}`);
                renderNpcResults(result.results || []);
            }
            catch
            {
                renderNpcResults([]);
            }
        }, 250);
    });

    /* 3D model portrait */

    /*
     * Choosing a power type refills its bar to that type's own pool.
     *
     * Registered after bindInputs, so state.unitPower already holds the new value by the time
     * this runs and it only has to supply the numbers.
     */
    $('[data-bind="unitPower"]').addEventListener('change', () =>
    {
        const preset = M.POWER_DEFAULTS[state.unitPower];

        if (preset)
        {
            state.unitPowerCur = preset.cur;
            state.unitPowerMax = preset.max;

            // A fresh pool, so whatever was scaled onto the old one no longer applies.
            state.unitPowerScalePct = 0;
            state.unitPowerScaleBase = null;

            syncForm();
            update();
            paintPowerScaling();
        }
    });

    bindTheme();
    bindCustomIcons();
    bindSpellSearch();
    bindAchievementSearch();
    bindHealthStep();
    bindHealthScaling();
    bindPowerScaling();

    bindBrowser();

    $('#btn-auto-portrait').addEventListener('click', () => autoPortrait(state.unitDisplayId));
}

/*
 * The arrow-key increment for the health fields.
 *
 * A raid boss has millions of health, so stepping by one is useless — the base is 1,000 and these
 * multiply it. The multiplier is deliberately not part of the saved state: it is how you are
 * editing right now, not part of the frame you are building.
 */
function bindHealthStep()
{
    const host = $('#health-step');

    if (!host)
    {
        return;
    }

    const BASE = 1000;

    for (const button of $$('#health-step button'))
    {
        button.addEventListener('click', () =>
        {
            const step = BASE * Number(button.dataset.step);

            for (const field of $$('[data-bind="unitHealth"], [data-bind="unitHealthMax"]'))
            {
                field.step = step;
            }

            $$('#health-step button').forEach((b) => b.classList.toggle('active', b === button));
            $('#health-step-out').textContent = step.toLocaleString();
        });
    }
}

/*
 * Custom difficulty scaling — roadmap item 6.
 *
 * Item 5 picks a harder version of a boss that really exists; this invents one. Each press
 * multiplies the current pool, so the presses compound the way a percentage increase does rather
 * than adding to a running total: +5% twice is +10.25%, not +10%.
 */
function paintScaling()
{
    const out = $('#scale-out');

    if (!out)
    {
        return;
    }

    const pct = Number(state.unitScalePct) || 0;

    out.textContent = pct
        ? `+${pct.toFixed(2).replace(/\.?0+$/, '')}% - ${(Number(state.unitHealthMax) || 0).toLocaleString()} HP`
        : 'none';

    const reset = $('#btn-scale-reset');

    if (reset)
    {
        reset.disabled = !pct;
    }
}

function applyScaling(pct)
{
    const factor = 1 + pct / 100;

    // Remember the pool before the first press, so Reset is exact rather than approximate.
    if (!state.unitScaleBase)
    {
        state.unitScaleBase = {
            health: state.unitHealth,
            healthMax: state.unitHealthMax
        };
    }

    state.unitHealth = Math.round((Number(state.unitHealth) || 0) * factor);
    state.unitHealthMax = Math.round((Number(state.unitHealthMax) || 1) * factor);

    const applied = (1 + (Number(state.unitScalePct) || 0) / 100) * factor;
    state.unitScalePct = Math.round((applied - 1) * 10000) / 100;

    syncForm();
    update();
    paintScaling();
}

function resetScaling()
{
    const base = state.unitScaleBase;

    if (base)
    {
        state.unitHealth = base.health;
        state.unitHealthMax = base.healthMax;
    }

    state.unitScalePct = 0;
    state.unitScaleBase = null;

    syncForm();
    update();
    paintScaling();
}

/*
 * The same three functions again for mana.
 *
 * Deliberately a parallel set rather than one generalised over both: pressing +5% under Health
 * used to move the mana bar too, which is not what a health check is asking for. Two pools, two
 * sets of buttons, two running totals.
 */
function paintPowerScaling()
{
    const out = $('#power-scale-out');

    if (!out)
    {
        return;
    }

    const pct = Number(state.unitPowerScalePct) || 0;

    out.textContent = pct
        ? `+${pct.toFixed(2).replace(/\.?0+$/, '')}% - ${(Number(state.unitPowerMax) || 0).toLocaleString()} mana`
        : 'none';

    const reset = $('#btn-power-scale-reset');

    if (reset)
    {
        reset.disabled = !pct;
    }
}

function applyPowerScaling(pct)
{
    // Nothing else has a pool that means anything to scale.
    if (!M.SCALES_WITH_DIFFICULTY.has(state.unitPower))
    {
        return;
    }

    const factor = 1 + pct / 100;

    if (!state.unitPowerScaleBase)
    {
        state.unitPowerScaleBase = { power: state.unitPowerCur, powerMax: state.unitPowerMax };
    }

    state.unitPowerCur = Math.round((Number(state.unitPowerCur) || 0) * factor);
    state.unitPowerMax = Math.round((Number(state.unitPowerMax) || 1) * factor);

    const applied = (1 + (Number(state.unitPowerScalePct) || 0) / 100) * factor;
    state.unitPowerScalePct = Math.round((applied - 1) * 10000) / 100;

    syncForm();
    update();
    paintPowerScaling();
}

function resetPowerScaling()
{
    const base = state.unitPowerScaleBase;

    if (base)
    {
        state.unitPowerCur = base.power;
        state.unitPowerMax = base.powerMax;
    }

    state.unitPowerScalePct = 0;
    state.unitPowerScaleBase = null;

    syncForm();
    update();
    paintPowerScaling();
}

function bindPowerScaling()
{
    if (!$('#power-scale'))
    {
        return;
    }

    for (const button of $$('#power-scale button[data-scale]'))
    {
        button.addEventListener('click', () => applyPowerScaling(Number(button.dataset.scale)));
    }

    $('#btn-power-scale-reset').addEventListener('click', resetPowerScaling);
    paintPowerScaling();
}

function bindHealthScaling()
{
    const host = $('#health-scale');

    if (!host)
    {
        return;
    }

    for (const button of $$('#health-scale button[data-scale]'))
    {
        button.addEventListener('click', () => applyScaling(Number(button.dataset.scale)));
    }

    $('#btn-scale-reset').addEventListener('click', resetScaling);
    paintScaling();
}

/*
 * The roadmap picture on the Home page: fitted to the column, or given its real 3200px width
 * inside a box that scrolls. The button is the only way back out, so it reports its state.
 */
function bindRoadmap()
{
    const button = $('#btn-roadmap-zoom');

    if (!button)
    {
        return;
    }

    button.addEventListener('click', () =>
    {
        const zoomed = $('.roadmap-frame').classList.toggle('zoom');

        button.setAttribute('aria-pressed', zoomed ? 'true' : 'false');
        button.textContent = zoomed ? 'Fit to page ⤡' : 'Full size ⤢';
    });
}

init();
