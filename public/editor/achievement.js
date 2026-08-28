'use strict';

/*
 * The achievement finder: search Achievement.dbc by title or id, browse the category tree, and
 * load a real achievement in as a starting point for a custom one.
 *
 * Deliberately parallel to the spell search — same debounce, same result rows — with the tree
 * added beside it, because an achievement is looked for by "what is in Dungeons & Raids" at
 * least as often as by name. Like the spell search it needs a client and no database: everything
 * on the card lives in the DBCs.
 */

import { $ } from './dom.js';
import { api } from './api.js';
import { state } from './state.js';
import { status, update } from './preview.js';
import { syncForm } from './form.js';
import { renderLists } from './lists.js';
import { setIcon, iconUrl } from './icons.js';

/* The category tree, fetched once, for browsing the finder by heading. */
let tree = null;

/**
 * Fills the editor from a loaded achievement.
 *
 * The criteria come in matching the card's current earned state rather than always ticked: load
 * one into an unearned card and the ticks stay empty, which is the pair the game would draw.
 */
function applyAchievement(achievement)
{
    state.achTitle = achievement.title || '';
    state.achDescription = achievement.description || '';
    state.achReward = achievement.reward || '';
    state.achPoints = achievement.points || 0;

    if (achievement.icon)
    {
        state.achIcon = achievement.icon;
    }

    const met = state.achEarned !== false;

    state.achCriteria = (achievement.criteria || [])
        .filter((c) => c.text)
        .map((c) => ({ text: c.text, done: met }));

    syncForm();
    renderLists();

    // syncForm repaints the icon from state; this loads the image behind it.
    setIcon(state.achIcon);
    update();

    const where = achievement.categoryName ? ` - ${achievement.categoryName}` : '';
    status(`Loaded ${achievement.title} (achievement ${achievement.id})${where}`);
}

/** Fetches the whole achievement — a browse row carries only enough of one to draw itself. */
async function loadById(id)
{
    try
    {
        const result = await api(`api/achievements/get?id=${encodeURIComponent(id)}`);

        if (result.achievement)
        {
            applyAchievement(result.achievement);
        }
    }
    catch
    {
        status('That achievement could not be loaded.');
    }
}

/*
 * The result list, for both the search and the tree.
 *
 * The caption is where a browsed category prints its path, rather than repeating it on every row:
 * "Dungeons & Raids / Lich King 10-Player Raid" on all 36 rows forced the list wider than the
 * column it sits in and pushed the whole panel sideways.
 */
function renderResults(results, onPick, caption)
{
    const host = $('#ach-results');
    host.textContent = '';

    if (caption)
    {
        const line = document.createElement('p');
        line.className = 'ach-path';
        line.textContent = caption;
        host.appendChild(line);
    }

    for (const achievement of results)
    {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'npc-row ach-row';

        const icon = document.createElement('img');
        icon.className = 'ach-row-icon';
        icon.loading = 'lazy';
        icon.src = iconUrl(achievement.icon);
        icon.alt = '';

        const name = document.createElement('span');
        name.className = 'npc-name';
        name.textContent = achievement.title;

        const meta = document.createElement('span');
        meta.className = 'npc-meta';
        meta.textContent = [
            // A Feat of Strength is worth nothing and shows no number in game, so nor does this.
            achievement.points ? `${achievement.points} pts` : 'no points',
            achievement.faction && achievement.faction !== 'both' ? achievement.faction : '',
            achievement.categoryName,
            `#${achievement.id}`
        ].filter(Boolean).join(' · ');

        row.append(icon, name, meta);
        row.addEventListener('click', () => onPick(achievement));
        host.appendChild(row);
    }
}

/*
 * The tree flattened into one select.
 *
 * Not an optgroup per heading, which was the first shape tried: a heading holds achievements of
 * its own — General has dozens — so making it a group label would have put them out of reach.
 * Depth is carried by indentation instead, and every level stays selectable.
 */
function fillCategorySelect()
{
    const browse = $('#ach-category');

    if (!browse)
    {
        return;
    }

    const options = [];

    const walk = (category, depth) =>
    {
        options.push({
            id: category.id,
            // The indent is non-breaking spaces: a browser collapses ordinary leading whitespace
            // in an option. No count on a heading that only holds sub-categories, not a "(0)".
            label: `${'  '.repeat(depth)}${category.name}${category.count ? ` (${category.count})` : ''}`
        });

        category.children.forEach((child) => walk(child, depth + 1));
    };

    tree.forEach((root) => walk(root, 0));

    browse.textContent = '';

    const blank = document.createElement('option');

    blank.value = '';
    blank.textContent = 'Browse…';
    browse.appendChild(blank);

    for (const option of options)
    {
        const el = document.createElement('option');

        el.value = option.id;
        el.textContent = option.label;
        browse.appendChild(el);
    }
}

function noClient()
{
    $('#ach-hint').textContent = 'Point at your 3.3.5a folder in Settings to search achievements.';
}

/**
 * Loads the category tree.
 *
 * Called at start-up alongside the icon and font loads: 86 rows, so the browse select is filled
 * before the tab is ever opened.
 */
async function loadAchievementCategories()
{
    try
    {
        const result = await api('api/achievements/categories');

        if (result.error === 'no-client')
        {
            noClient();
            return;
        }

        tree = result.categories || [];
        fillCategorySelect();
    }
    catch
    {
        // Leaves the select empty; the hint already says a client is what they want.
    }
}

function bindAchievementSearch()
{
    const input = $('#ach-search');
    const category = $('#ach-category');

    if (!input || !category)
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
            renderResults([], () => {});
            return;
        }

        // Debounced as the spell search is: 1,817 titles scanned per keystroke otherwise.
        timer = setTimeout(async () =>
        {
            try
            {
                const result = await api(`api/achievements/search?q=${encodeURIComponent(query)}`);

                if (result.error === 'no-client')
                {
                    noClient();
                }

                // A search result is the full editor shape already, so it applies without a fetch.
                renderResults(result.results || [], applyAchievement);
            }
            catch
            {
                renderResults([], () => {});
            }
        }, 250);
    });

    category.addEventListener('change', async () =>
    {
        if (!category.value)
        {
            renderResults([], () => {});
            return;
        }

        // Both write into the same list, so starting to browse drops whatever was searched for.
        input.value = '';

        try
        {
            const result = await api(`api/achievements/category?id=${encodeURIComponent(category.value)}`);

            if (result.error === 'no-client')
            {
                noClient();
            }

            renderResults(
                result.achievements || [],
                (a) => loadById(a.id),
                (result.path || []).join(' / ')
            );
        }
        catch
        {
            renderResults([], () => {});
        }
    });
}

export { bindAchievementSearch, loadAchievementCategories, applyAchievement };
