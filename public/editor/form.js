'use strict';

/* Two-way wiring between the [data-bind] form controls and the state object. */

import { $, $$ } from './dom.js';
import { state, view, CANVAS_KINDS } from './state.js';
import { update } from './preview.js';
import { setIcon, currentIconName } from './icons.js';
import { M } from './wow.js';

function populateSelects()
{
    const quality = $('[data-bind="quality"]');
    M.QUALITY.forEach((q) =>
    {
        const opt = document.createElement('option');
        opt.value = q.id;
        opt.textContent = q.name;
        opt.style.color = q.color;
        quality.appendChild(opt);
    });

    const fill = (sel, values) => values.forEach((v) =>
    {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v || '—';
        sel.appendChild(opt);
    });

    fill($('[data-bind="slot"]'), M.SLOTS);
    // The Type options depend on the slot, so syncItemTypes owns that select rather than this.

    const fillPairs = (sel, entries) => entries.forEach((entry) =>
    {
        const opt = document.createElement('option');
        opt.value = entry.value;
        opt.textContent = entry.label;
        sel.appendChild(opt);
    });

    fillPairs($('[data-bind="unitClassification"]'), M.UNIT_CLASSIFICATIONS);
    fillPairs($('[data-bind="unitReaction"]'), M.UNIT_REACTIONS);
    fillPairs($('[data-bind="unitPower"]'), M.POWER_TYPES);
    fillPairs($('[data-bind="achPoints"]'), M.ACHIEVEMENT_POINTS);
}

function bindInputs()
{
    for (const el of $$('[data-bind]'))
    {
        const key = el.dataset.bind;
        const isCheck = el.type === 'checkbox';
        const isNumber = el.type === 'number' || el.hasAttribute('data-number');

        el.addEventListener(isCheck || el.tagName === 'SELECT' ? 'change' : 'input', () =>
        {
            state[key] = isCheck ? el.checked : (isNumber ? Number(el.value) : el.value);
            syncConditionals();
            syncHealthSlider();
            update();
        });
    }
}

function syncForm()
{
    // A wholesale refresh may have changed the slot underneath us, so rebuild Type regardless.
    builtForSlot = null;

    for (const el of $$('[data-bind]'))
    {
        const value = state[el.dataset.bind];

        if (el.type === 'checkbox')
        {
            el.checked = !!value;
        }
        else
        {
            el.value = value === undefined || value === null ? '' : value;
        }
    }

    // These are per mode, so a switch reloads them rather than carrying them across.
    const v = view();

    $('#max-width').value = v.maxWidth;
    $('#opt-icon-placement').value = v.iconPlacement;
    $('#opt-transparent').checked = v.transparent;
    $('#opt-quality-border').checked = v.qualityBorder;
    $('#opt-checker').checked = v.checker;
    $('#preview-zoom').value = v.zoom;
    $('#export-scale').value = v.exportScale;
    $('#stage').classList.toggle('checker', v.checker);

    $$('.kind-switch button').forEach((b) => b.classList.toggle('active', b.dataset.kind === state.kind));

    // Every panel, not a fixed three — Home and the placeholders are panels too.
    for (const panel of $$('[data-panel]'))
    {
        panel.hidden = panel.dataset.panel !== state.kind;
    }

    /*
     * The preview column belongs to the three editors. On Home there is nothing to preview and
     * nothing to export, so it folds away and the page becomes one column.
     */
    const drawing = CANVAS_KINDS.includes(state.kind);

    // A class, not the hidden attribute: .preview sets display:flex, which would override it.
    $('main').classList.toggle('no-preview', !drawing);

    // Home alone gets the throne behind it; the two placeholders are plain.
    $('main').classList.toggle('home', state.kind === 'home');

    syncHealthSlider();

    syncConditionals();
    setIcon(currentIconName(), false);
}

/** Keeps the health percentage slider and its readout in step with the current/max numbers. */
function syncHealthSlider()
{
    const slider = $('#health-slider');

    if (!slider)
    {
        return;
    }

    const max = Math.max(1, Number(state.unitHealthMax) || 1);
    const pct = Math.round((Number(state.unitHealth) || 0) / max * 100);

    slider.value = Math.max(0, Math.min(100, pct));
    $('#health-pct').textContent = `${slider.value}%`;
}

/*
 * The last slot the Type select was built for.
 *
 * Rebuilding the options on every keystroke would be wasteful and would fight the user, so the
 * select is only repopulated when the slot itself changes.
 */
let builtForSlot = null;

/**
 * Rebuilds the Type select for the chosen slot, and renames the field to match.
 *
 * A slot that shows no subclass in game hides the field entirely rather than offering an empty
 * dropdown. A type that the new slot cannot take is dropped — switching a sword to Head should
 * not leave "Sword" sitting in an armour field.
 */
function syncItemTypes(force = false)
{
    const field = $('#type-field');
    const select = $('[data-bind="itemType"]');

    if (!field || !select || (!force && builtForSlot === state.slot))
    {
        return;
    }

    builtForSlot = state.slot;

    const { label, options } = M.typesForSlot(state.slot);

    // style.display, not the hidden attribute: the stylesheet's display:block on label beats it.
    field.style.display = options.length ? '' : 'none';

    if (!options.length)
    {
        state.itemType = '';
        return;
    }

    // The label sits as a bare text node in front of the select.
    field.firstChild.nodeValue = label;

    if (state.itemType && !options.includes(state.itemType))
    {
        state.itemType = '';
    }

    select.textContent = '';

    for (const value of ['', ...options])
    {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value || '—';
        select.appendChild(option);
    }

    select.value = state.itemType || '';
}

/** Fields that only make sense in some configurations (weapon damage, unique count). */
function syncConditionals()
{
    for (const el of $$('[data-when]'))
    {
        el.style.display = state[el.dataset.when] ? '' : 'none';
    }

    /*
     * Controls that belong to particular modes: the quality border is item-only, icon placement
     * covers items and spells but means nothing on a unit frame, which has no icon to place.
     */
    for (const el of $$('[data-kind-only]'))
    {
        const kinds = el.dataset.kindOnly.split(/\s+/);
        el.style.display = kinds.includes(state.kind) ? '' : 'none';
    }

    // Rage, energy, focus and runic power are fixed hundred-point pools; only mana scales.
    const powerScale = $('#power-scale-field');

    if (powerScale)
    {
        powerScale.style.display = state.unitPower === 'mana' ? '' : 'none';
    }

    const uniqueCount = $('[data-bind="uniqueN"]');

    if (uniqueCount)
    {
        uniqueCount.closest('label').style.display = state.unique === 'unique-n' ? '' : 'none';
    }

    syncItemTypes();
}

export { populateSelects, bindInputs, syncForm, syncHealthSlider, syncConditionals };
