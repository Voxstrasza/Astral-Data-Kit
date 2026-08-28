'use strict';

/*
 * The talent calculator: three trees, seventy-one points, and the rules that decide where they go.
 *
 * Shaped like the game's own frame and like the calculators built on it - the three tabs side by
 * side, a four-wide grid per tree, a rank counter on every icon, left click to spend and right
 * click to take back. The class is not chosen here; it comes from the Armory's own dropdown, and
 * this window opens onto whichever class is already selected.
 *
 * Four rules, all of them the client's rather than remembered:
 *
 *   points     level - 9, which is 71 at 80. `Player::CalculateTalentsPoints`.
 *   tiers      five points in the tree per tier below the one being spent in.
 *   needs      a talent with a prerequisite waits for it to reach the rank Talent.dbc names,
 *              which in all 137 rows that have one is the prerequisite's maximum.
 *   taking back cannot orphan anything: a point comes out only if what is left still obeys the
 *              three rules above, which is checked by re-validating the tree rather than by
 *              reasoning about which talent was below which.
 */

import { $, el } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';
import { iconUrl } from './icons.js';
import { M, R } from './wow.js';

/** The game's own grid: four columns, and a tier is worth five points. */
const COLUMNS = 4;
const PER_TIER = 5;

let tabs = null;
let loadedFor = 0;
let bound = false;
let onClose = null;

/** talent id -> how many points are in it. Lives in state so a build survives the session. */
function build()
{
    if (!state.armoryTalents || typeof state.armoryTalents !== 'object')
    {
        state.armoryTalents = {};
    }

    return state.armoryTalents;
}

function rankOf(id)
{
    return Number(build()[id]) || 0;
}

/** What a level is worth. Below ten a character has none at all. */
function available()
{
    return Math.max(0, (Number(state.armoryLevel) || 80) - 9);
}

function spentIn(tab)
{
    return tab.talents.reduce((sum, talent) => sum + rankOf(talent.id), 0);
}

function spentTotal()
{
    return (tabs || []).reduce((sum, tab) => sum + spentIn(tab), 0);
}

/** The spec is whichever tree holds the most, which is what the game calls it too. */
function specName()
{
    if (!tabs || !spentTotal())
    {
        return 'no talents spent';
    }

    const best = [...tabs].sort((a, b) => spentIn(b) - spentIn(a))[0];

    return `${best.name} (${tabs.map(spentIn).join('/')})`;
}

/**
 * Is this tree's build legal on its own?
 *
 * Called with a hypothetical build when a point is being taken back, which is what makes the
 * orphan rule fall out rather than being written: if lifting a point leaves a talent whose tier is
 * no longer paid for, or whose prerequisite is no longer maxed, the tree does not validate and the
 * click is refused.
 */
function treeIsLegal(tab, ranks)
{
    const spent = tab.talents.reduce((sum, t) => sum + (ranks[t.id] || 0), 0);

    for (const talent of tab.talents)
    {
        const rank = ranks[talent.id] || 0;

        if (!rank)
        {
            continue;
        }

        if (spent < talent.tier * PER_TIER)
        {
            return false;
        }

        if (talent.requires && (ranks[talent.requires] || 0) < talent.requiresRank)
        {
            return false;
        }
    }

    return true;
}

/** Why a talent cannot take another point, or an empty string when it can. */
function blocked(tab, talent)
{
    if (rankOf(talent.id) >= talent.ranks.length)
    {
        return 'Already at its highest rank.';
    }

    if (spentTotal() >= available())
    {
        return `No points left - a level ${state.armoryLevel} character has ${available()}.`;
    }

    const need = talent.tier * PER_TIER;

    if (spentIn(tab) < need)
    {
        return `Needs ${need} points in ${tab.name} first.`;
    }

    if (talent.requires)
    {
        const parent = tab.talents.find((t) => t.id === talent.requires);

        if (rankOf(talent.requires) < talent.requiresRank)
        {
            return `Requires ${parent ? parent.name : 'the talent above'} at rank ${talent.requiresRank}.`;
        }
    }

    return '';
}

function spend(tab, talent)
{
    if (blocked(tab, talent))
    {
        return;
    }

    build()[talent.id] = rankOf(talent.id) + 1;
    draw();
}

function refund(tab, talent)
{
    const rank = rankOf(talent.id);

    if (!rank)
    {
        return;
    }

    const hypothetical = { ...build(), [talent.id]: rank - 1 };

    if (!treeIsLegal(tab, hypothetical))
    {
        status('That point is holding something else up.');
        return;
    }

    if (rank - 1 === 0)
    {
        delete build()[talent.id];
    }
    else
    {
        build()[talent.id] = rank - 1;
    }

    draw();
}

function status(text)
{
    $('#talent-status').textContent = text;
}

/* -------------------------------------------------------------------- the tooltip */

/*
 * The game's own tooltip, drawn by the same renderer every other tooltip in the program uses.
 *
 * The browser's `title` was the first attempt and it was wrong twice over: it wraps a long
 * description wherever it likes, and it looks nothing like the window the game shows. This builds
 * the same lines the game does - name, rank out of max, what this rank does, then what the next
 * one would do - and hands them to `renderTooltip`.
 */
let tipNode = null;
let tipFont = null;

function tooltipFont()
{
    if (!tipFont)
    {
        tipFont = document.fonts.load('16px AstralGame').catch(() => {});
    }

    return tipFont;
}

/*
 * The host hangs inside the dialog, not off the body.
 *
 * A modal draws in the top layer, which is above everything a z-index can reach, so a tooltip
 * parented to the body is painted behind the window it belongs to - present in the DOM, correct in
 * every measurement, and invisible. Inside the dialog it shares that layer.
 */
function tooltipHost()
{
    if (!tipNode)
    {
        tipNode = el('div', 'armory-hover');
        tipNode.hidden = true;
    }

    const dialog = $('#talent-dialog');

    if (tipNode.parentNode !== dialog)
    {
        dialog.append(tipNode);
    }

    return tipNode;
}

function hideTooltip()
{
    tooltipHost().hidden = true;
}

async function showTooltip(node, tab, talent)
{
    await tooltipFont();

    if (!node.matches(':hover'))
    {
        return;
    }

    const rank = rankOf(talent.id);
    const max = talent.ranks.length;
    const C = M.C;
    const lines = [];

    lines.push({ l: talent.name, lc: C.white, r: `Rank ${Math.max(rank, 1)}/${max}`, rc: C.gray, kind: 'title' });

    /* The rank you are standing on, or the first one when nothing is spent yet. */
    lines.push({ l: '', kind: 'gap' });
    lines.push({
        l: talent.ranks[Math.max(0, rank - 1)].description,
        lc: C.gold, r: '', rc: C.white, kind: 'body'
    });

    /* And what the next point would buy, which is the half of the game's tooltip that decides
       whether to spend it. */
    if (rank && rank < max)
    {
        lines.push({ l: '', kind: 'gap' });
        lines.push({ l: 'Next rank:', lc: C.white, r: '', rc: C.white, kind: 'body' });
        lines.push({ l: talent.ranks[rank].description, lc: C.gold, r: '', rc: C.white, kind: 'body' });
    }

    const why = blocked(tab, talent);

    if (why && rank < max)
    {
        lines.push({ l: '', kind: 'gap' });
        lines.push({ l: why, lc: C.red, r: '', rc: C.white, kind: 'body' });
    }

    const host = tooltipHost();
    const canvas = R.renderTooltip(lines, {
        icon: null,
        iconPlacement: 'none',
        maxWidth: 320,
        transparent: false,
        borderColor: '#4a4a4a'
    }, 1);

    host.replaceChildren(canvas);
    host.hidden = false;

    const box = node.getBoundingClientRect();
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const right = window.innerWidth - box.right;

    host.style.left = `${Math.round(right > width + 20 ? box.right + 10 : Math.max(8, box.left - width - 10))}px`;
    host.style.top = `${Math.round(Math.max(8, Math.min(box.top, window.innerHeight - height - 8)))}px`;
}

/** One talent: its icon, its rank, and the tooltip that explains it. */
function cell(tab, talent)
{
    const rank = rankOf(talent.id);
    const max = talent.ranks.length;
    const box = el('button', 'talent');
    const why = blocked(tab, talent);

    box.type = 'button';
    box.style.gridRow = String(talent.tier + 1);
    box.style.gridColumn = String(talent.col + 1);

    if (rank >= max)
    {
        box.classList.add('maxed');
    }
    else if (rank)
    {
        box.classList.add('partial');
    }
    else if (why)
    {
        box.classList.add('locked');
    }

    const art = el('span', 'talent-icon');

    if (talent.icon)
    {
        art.style.backgroundImage = `url("${iconUrl(talent.icon)}")`;
    }

    box.append(art, el('span', 'talent-rank', `${rank}/${max}`));

    box.addEventListener('mouseenter', () => showTooltip(box, tab, talent));
    box.addEventListener('mouseleave', hideTooltip);

    box.addEventListener('click', () =>
    {
        const stop = blocked(tab, talent);

        status(stop || '');
        spend(tab, talent);
    });

    box.addEventListener('contextmenu', (e) =>
    {
        e.preventDefault();
        refund(tab, talent);
    });

    return box;
}

/**
 * The line from a talent to the one it needs.
 *
 * Straight only, because the trees are: a prerequisite is either directly above its dependent or
 * directly beside it, never a dogleg. Anything that is neither gets no line rather than a wrong
 * one, and the tooltip still names what it is waiting for.
 */
function arrow(tab, talent)
{
    const parent = tab.talents.find((t) => t.id === talent.requires);

    if (!parent)
    {
        return null;
    }

    const sameColumn = parent.col === talent.col;
    const sameTier = parent.tier === talent.tier;

    if (!sameColumn && !sameTier)
    {
        return null;
    }

    const line = el('span', 'talent-arrow');

    if (rankOf(parent.id) >= talent.requiresRank)
    {
        line.classList.add('is-met');
    }

    if (sameColumn)
    {
        line.classList.add('down');
        line.style.gridColumn = String(talent.col + 1);
        line.style.gridRow = `${Math.min(parent.tier, talent.tier) + 1} / ${Math.max(parent.tier, talent.tier) + 1}`;
    }
    else
    {
        line.classList.add('across');
        line.style.gridRow = String(talent.tier + 1);
        line.style.gridColumn = `${Math.min(parent.col, talent.col) + 1} / ${Math.max(parent.col, talent.col) + 1}`;
    }

    return line;
}

function drawTree(tab)
{
    const column = el('div', 'talent-tree');
    const head = el('div', 'talent-tree-head');

    head.append(
        el('strong', '', tab.name),
        el('span', 'talent-tree-points', String(spentIn(tab))));

    const grid = el('div', 'talent-grid');

    grid.style.gridTemplateColumns = `repeat(${COLUMNS}, 44px)`;
    grid.style.gridTemplateRows = `repeat(${tab.tiers}, 44px)`;

    /*
     * The tree's own art, out of the client. TalentTab.dbc names it - "WarriorProtection" - and the
     * game tiles four 256px textures behind each tree; the same four are laid out here as one 2x2
     * background. `/client/texture/` decodes the BLP, which is the route the rest of the UI art
     * already comes through.
     */
    if (tab.background)
    {
        const tile = (corner) => `url("/client/texture/${
            encodeURIComponent(`Interface\\TalentFrame\\${tab.background}-${corner}.blp`)}")`;

        grid.style.backgroundImage =
            [tile('TopLeft'), tile('TopRight'), tile('BottomLeft'), tile('BottomRight')].join(', ');
    }

    for (const talent of tab.talents)
    {
        if (talent.requires)
        {
            const line = arrow(tab, talent);

            if (line)
            {
                grid.append(line);
            }
        }
    }

    for (const talent of tab.talents)
    {
        grid.append(cell(tab, talent));
    }

    column.append(head, grid);

    return column;
}

function draw()
{
    if (!tabs)
    {
        return;
    }

    $('#talent-trees').replaceChildren(...tabs.map(drawTree));
    $('#talent-spent').textContent = `${spentTotal()} / ${available()}`;
    $('#talent-spec').textContent = specName();

    if (onClose)
    {
        onClose();
    }
}

/** Everything back to nothing, for the class currently open. */
function resetAll()
{
    for (const tab of tabs || [])
    {
        for (const talent of tab.talents)
        {
            delete build()[talent.id];
        }
    }

    status('');
    draw();
}

/**
 * Open onto the class the Armory is showing.
 *
 * Changing class empties the build rather than carrying it: a warrior's talent ids mean nothing to
 * a mage, and keeping them would leave points spent in trees that are no longer on screen.
 */
async function openTalents(cls, changed)
{
    onClose = changed;

    const dialog = $('#talent-dialog');

    if (loadedFor !== cls)
    {
        tabs = null;
        $('#talent-trees').replaceChildren(el('p', 'hint', 'Reading the trees from your client…'));
        dialog.showModal();

        const answer = await api(`/api/character/talents?class=${cls}`);

        if (answer.error || !answer.tabs || !answer.tabs.length)
        {
            $('#talent-trees').replaceChildren(el('p', 'hint',
                answer.error || 'No talent trees for that class in this client.'));
            return;
        }

        tabs = answer.tabs;
        loadedFor = cls;
    }
    else
    {
        dialog.showModal();
    }

    status('');
    draw();

    if (!bound)
    {
        bound = true;
        $('#talent-reset').addEventListener('click', resetAll);
    }
}

/** What the Armory prints above the slots, without opening anything. */
function talentSummary()
{
    return { spec: specName(), spent: spentTotal(), available: available() };
}

/** Dropped when the class changes, since a build is a set of ids belonging to one class. */
function clearTalents()
{
    state.armoryTalents = {};
    tabs = null;
    loadedFor = 0;
}

export { openTalents, talentSummary, clearTalents };
