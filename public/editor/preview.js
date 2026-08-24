'use strict';

/* Turns state into a canvas — the on-screen preview and the exported PNG are this same code. */

import { $ } from './dom.js';
import { state, runtime, view, CANVAS_KINDS, effectText, encodeState } from './state.js';
import { M, R } from './wow.js';

function renderOptions()
{
    return {
        // The unit frame shows only a captured 3D portrait; it has no icon fallback, since a
        // spell or item icon in a creature portrait ring never looks right.
        icon: state.kind === 'unit' ? runtime.portraitImage : runtime.iconImage,
        iconPlacement: view().iconPlacement,
        maxWidth: Number(view().maxWidth) || 300,
        transparent: view().transparent,
        borderColor: view().qualityBorder && state.kind === 'item'
            ? M.qualityColor(state.quality)
            : '#4a4a4a'
    };
}

function currentLines()
{
    // Derive each green line's sentence from its preset before handing the state to the compiler.
    const prepared = {
        ...state,
        effects: (state.effects || []).map((e) => ({ kind: e.kind, text: effectText(e) }))
    };

    return M.buildLines(prepared);
}

/*
 * The one place that picks a renderer, so the preview and the export cannot disagree about which
 * one a mode uses — they chose separately before, with the same ternary written out twice.
 */
/**
 * What this state draws, as one or more labeled images.
 *
 * A spell with an aura is two windows, not one: the game tooltips them separately — hover the
 * spell and you get one, hover the buff it leaves on you and you get another — and they are two
 * different things to save. So they come back as two canvases with a label each rather than
 * stitched together, and the caller decides whether to show them side by side or export both.
 */
function drawParts(scale)
{
    if (state.kind === 'unit')
    {
        return [{ label: '', canvas: R.renderUnitFrame(state, renderOptions(), scale) }];
    }

    if (state.kind === 'achievement')
    {
        return [{ label: '', canvas: R.renderAchievement(state, renderOptions(), scale) }];
    }

    if (state.kind === 'text')
    {
        return [{ label: '', canvas: R.renderChat(M.buildChatLines(state), renderOptions(), scale) }];
    }

    const parts = [{ label: '', canvas: R.renderTooltip(currentLines(), renderOptions(), scale) }];

    if (state.kind === 'spell' && state.buffShow)
    {
        parts[0].label = 'Spell';
        parts[0].suffix = '';

        // The buff window has no icon of its own: in game the icon is the button being hovered.
        parts.push({
            label: 'Aura',
            suffix: '-aura',
            canvas: R.renderTooltip(M.buildBuffLines(state), { ...renderOptions(), icon: null }, scale)
        });
    }

    return parts;
}

/** The single image an export means when nothing asks for the parts separately. */
function draw(scale)
{
    const parts = drawParts(scale);

    return parts.length === 1 ? parts[0].canvas : stack(parts[0].canvas, parts[1].canvas, scale);
}

/** Two tooltips, one under the other, with the gap the game leaves between two open windows. */
function stack(top, bottom, scale)
{
    const gap = Math.round(8 * scale);

    const canvas = document.createElement('canvas');
    canvas.width = Math.max(top.width, bottom.width);
    canvas.height = top.height + gap + bottom.height;

    const ctx = canvas.getContext('2d');

    // The gap belongs to the background, so an opaque export has no hole between the windows.
    if (!view().transparent)
    {
        ctx.fillStyle = 'rgba(6,6,12,0.96)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    ctx.drawImage(top, 0, 0);
    ctx.drawImage(bottom, 0, top.height + gap);

    return canvas;
}

function update()
{
    const host = $('#canvas-host');

    // Home and the two placeholders draw nothing; there is no state to render for them.
    if (!CANVAS_KINDS.includes(state.kind))
    {
        host.textContent = '';
        history.replaceState(null, '', `#${encodeState(state)}`);
        return;
    }

    const zoom = Number(view().zoom) || 1.5;

    // Render at twice the display zoom, then show at the zoom size: the extra resolution keeps
    // the preview sharp on HiDPI screens and when zoomed in to inspect detail.
    const parts = drawParts(zoom * 2);

    host.textContent = '';

    for (const part of parts)
    {
        const { canvas, label } = part;

        canvas.style.width = `${canvas.width / 2}px`;
        canvas.style.height = `${canvas.height / 2}px`;

        /*
         * The caption is the app talking, not part of the picture — it names which window is
         * which the way a database page labels its Aura block, and it is not in what gets saved.
         */
        if (label)
        {
            const group = document.createElement('div');
            group.className = 'preview-part';

            const caption = document.createElement('span');
            caption.className = 'preview-label';
            caption.textContent = label;

            group.append(caption, canvas);
            host.appendChild(group);
        }
        else
        {
            host.appendChild(canvas);
        }
    }

    const out = $('#max-width-out');

    if (out)
    {
        out.textContent = `${view().maxWidth}px`;
    }

    history.replaceState(null, '', `#${encodeState(state)}`);
}

function status(message)
{
    $('#status').textContent = message;

    if (message)
    {
        setTimeout(() =>
        {
            if ($('#status').textContent === message)
            {
                $('#status').textContent = '';
            }
        }, 4000);
    }
}

function exportCanvas()
{
    return draw(Number(view().exportScale) || 2);
}

/** Every image this state makes, each with the file name it should be saved under. */
function exportParts()
{
    const scale = Number(view().exportScale) || 2;

    return drawParts(scale).map((part) => ({
        ...part,
        name: fileName(part.suffix || '')
    }));
}

function fileName(suffix)
{
    const base = (state.kind === 'spell' ? state.spellName
        : state.kind === 'unit' ? state.unitName
        : state.kind === 'achievement' ? state.achTitle
        : state.name) || 'tooltip';
    const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'tooltip';

    return `${slug}${suffix || ''}.png`;
}

export { renderOptions, currentLines, update, status, exportCanvas, exportParts, fileName };
