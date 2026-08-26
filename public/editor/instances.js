'use strict';

/*
 * The dungeon and raid browser: expansion -> instance -> boss -> difficulty.
 *
 * The difficulty buttons are not a fixed set. How many an instance offers comes from the client's
 * MapDifficulty.dbc, which is why Classic shows none, TBC shows Normal/Heroic on its 5-mans only,
 * and Trial of the Crusader onwards shows four. Nothing here hard-codes that — it is what the
 * client says.
 */

import { $ } from './dom.js';
import { api } from './api.js';
import { status } from './preview.js';
import { applyNpc } from './npc.js';
import { showLoot, showMisc } from './item-search.js';
import { addBossFrame } from './raids.js';

let tree = null;
let currentExpansion = null;
let currentInstance = null;

/*
 * Which window opened the browser.
 *
 * 'npc' fills the target frame from the boss picked; 'loot' lists what that boss drops and fills
 * the item editor from whatever is chosen out of it; 'raid' adds the boss to the raid being built.
 * One dialog rather than three, because the way in — expansion, instance, boss — is the same
 * question every time.
 */
let browserMode = 'npc';

/** The base difficulty is what the player gets by default, so it starts selected. */
const BASE_DIFFICULTY = 0;

function setStatus(message)
{
    $('#instance-status').textContent = message || '';
}

function renderInstances(expansion)
{
    const host = $('#instance-list');
    host.textContent = '';

    const section = (title, list) =>
    {
        if (!list.length)
        {
            return;
        }

        const heading = document.createElement('h4');
        heading.textContent = title;
        host.appendChild(heading);

        for (const instance of list)
        {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'instance-row';
            button.classList.toggle('active', currentInstance && currentInstance.mapId === instance.mapId);

            const name = document.createElement('span');
            name.className = 'instance-name';
            name.textContent = instance.name;

            const meta = document.createElement('span');
            meta.className = 'instance-meta';
            meta.textContent = `${instance.encounters.length} boss${instance.encounters.length === 1 ? '' : 'es'}`
                + (instance.difficulties.length > 1 ? ` · ${instance.difficulties.length} difficulties` : '');

            button.append(name, meta);
            button.addEventListener('click', () => openInstance(instance));
            host.appendChild(button);
        }
    };

    section('Dungeons', expansion.dungeons);
    section('Raids', expansion.raids);

    /*
     * Misc sits at the bottom of the loot browser, holding the things that are not any one boss's
     * drop. Emblems are the case that forced it: every boss in a tier hands out the same one, so
     * listing it under each of them says nothing.
     */
    if (browserMode === 'loot')
    {
        const heading = document.createElement('h4');
        heading.textContent = 'Misc';
        host.appendChild(heading);

        for (const [kind, label] of [
            ['currency', 'Badges & emblems'],
            ['materials', 'Materials'],
            ['mounts', 'Mounts']
        ])
        {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'instance-row';

            const name = document.createElement('span');
            name.className = 'instance-name';
            name.textContent = label;

            const meta = document.createElement('span');
            meta.className = 'instance-meta';
            meta.textContent = expansion.name;

            button.append(name, meta);
            button.addEventListener('click', () =>
            {
                currentInstance = null;
                renderInstances(expansion);
                button.classList.add('active');
                showMisc(kind, expansion, label);
            });

            host.appendChild(button);
        }
    }
}

/**
 * Draws one boss with a button per difficulty the instance offers.
 *
 * A boss can be missing a difficulty the instance advertises, and can have no creature at all —
 * Icecrown's gunship and Naxxramas' Four Horsemen are encounters rather than single creatures.
 * Those are listed but not selectable, rather than hidden, so the roster still reads as the real
 * instance.
 */
function difficultyButtons(tiers, instance, label, describe, onPick)
{
    const buttons = document.createElement('div');
    buttons.className = 'boss-difficulties';

    for (const tier of tiers)
    {
        const name = (instance.difficulties.find((d) => d.difficulty === tier.difficulty) || {}).label
            || `Difficulty ${tier.difficulty}`;

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'difficulty';
        button.classList.toggle('base', tier.difficulty === BASE_DIFFICULTY);
        button.textContent = name;
        button.title = `Entry ${tier.entry}`;

        button.addEventListener('click', () =>
        {
            /*
             * Loot mode keeps the dialog open and swaps the panel; NPC mode fills the frame and
             * gets out of the way. Same buttons, because the question they answer — which version
             * of this boss — is the same one either way.
             */
            if (onPick)
            {
                for (const other of buttons.querySelectorAll('button'))
                {
                    other.classList.toggle('active', other === button);
                }

                onPick(tier, name);
                return;
            }

            if (browserMode === 'raid')
            {
                addBossFrame(tier);
                $('#instance-dialog').close();
                return;
            }

            applyNpc(tier);
            $('#instance-dialog').close();
            status(describe(name));
        });

        buttons.appendChild(button);
    }

    return buttons;
}

function renderBoss(boss, instance)
{
    const row = document.createElement('div');
    row.className = 'boss-row';

    const head = document.createElement('div');
    head.className = 'boss-head';

    const hasMembers = !!(boss.members && boss.members.length);

    /*
     * A multi-boss encounter keeps its own title — "Northrend Beasts", not "Icehowl" — and the
     * creatures in it go behind a disclosure on the name. Listing them inline made a raid roster
     * three times taller for the handful of fights that need it.
     */
    const name = document.createElement(hasMembers || browserMode === 'loot' ? 'button' : 'span');
    name.className = 'boss-name';

    /*
     * Loot mode: the name shows the base difficulty's drops, the buttons beside it the rest.
     *
     * An encounter with no creature still belongs here when it has chests. Tribunal of Ages, the
     * Grand Champions, the Faction Champions and Escape from Arthas are events rather than
     * creatures, and their whole reward is the chest at the end.
     */
    if (browserMode === 'loot' && (boss.entry || (boss.chests || []).length))
    {
        name.type = 'button';
        name.classList.add('has-members');
        name.textContent = boss.name;
        const back = () => openInstance(instance);

        name.addEventListener('click', () =>
            showLoot(boss, instance, boss.difficulties[0] || (boss.chests || [])[0], '', back));
        head.appendChild(name);

        /*
         * A button per difficulty, because loot is stored per difficulty creature and the tables
         * are genuinely different: Marrowgar drops ilvl 251 on 10-normal, 264 on both 25-normal
         * and 10-heroic, and 277 on 25-heroic — four separate lists behind one name. Showing the
         * base entry alone, which is what this did at first, hides three quarters of the raid.
         */
        /*
         * Where the difficulties come from, in order of what is most specific.
         *
         * An encounter with no creature of its own has no difficulty list either, and the
         * Assembly of Iron is exactly that - three bosses, no credited creature. Its members
         * each carry the full 10 and 25, so the union of theirs is the encounter's, and the
         * drops can be asked for per size the way every other fight can.
         */
        const fromMembers = () =>
        {
            const seen = new Map();

            for (const member of boss.members || [])
            {
                for (const tier of member.difficulties || [])
                {
                    if (!seen.has(tier.difficulty))
                    {
                        seen.set(tier.difficulty, { difficulty: tier.difficulty, entry: 0 });
                    }
                }
            }

            return [...seen.values()].sort((a, b) => a.difficulty - b.difficulty);
        };

        const tiers = boss.difficulties.length
            ? boss.difficulties
            : (boss.chests || []).length
                ? (boss.chests || []).map((c) => ({ difficulty: c.difficulty, entry: 0 }))
                : fromMembers();

        if (tiers.length)
        {
            head.appendChild(difficultyButtons(
                tiers, instance, boss.name, () => '',
                (tier, label) => showLoot(boss, instance, tier, label, back)));
        }

        row.appendChild(head);
        return row;
    }

    if (hasMembers)
    {
        name.type = 'button';
        name.classList.add('has-members');
        name.setAttribute('aria-expanded', 'false');
        name.textContent = boss.name;
    }
    else
    {
        name.textContent = boss.name;
    }

    head.appendChild(name);

    /*
     * Seven encounters in the game exist only on Heroic — Amanitar, Anzu, Eck and the rest — and
     * carry a single button rather than the instance's full set. Saying so is the difference
     * between a boss that looks like it is missing its Normal button and one that never had one.
     */
    if (boss.restricted)
    {
        const flag = document.createElement('span');
        flag.className = 'boss-flag';
        flag.textContent = 'Heroic only';
        head.appendChild(flag);
    }

    /*
     * Members win over the encounter's own creature.
     *
     * The Northrend Beasts resolve to Icehowl and are four bosses, so showing Icehowl's buttons on
     * the encounter row would quietly offer one of the four under the name of all of them.
     */
    if (!hasMembers && boss.difficulties.length)
    {
        head.appendChild(difficultyButtons(
            boss.difficulties, instance, boss.name,
            (label) => `${boss.name} - ${instance.name}, ${label}`));

        row.appendChild(head);
        return row;
    }

    row.appendChild(head);

    if (hasMembers)
    {
        const note = document.createElement('span');
        note.className = 'boss-meta';
        note.textContent = `${boss.members.length} creatures`;
        head.appendChild(note);

        const list = document.createElement('div');
        list.className = 'boss-members';
        list.hidden = true;

        for (const member of boss.members)
        {
            const line = document.createElement('div');
            line.className = 'boss-member';

            const memberName = document.createElement('span');
            memberName.className = 'boss-name';
            memberName.textContent = member.name;
            line.appendChild(memberName);

            if (member.difficulties.length)
            {
                line.appendChild(difficultyButtons(
                    member.difficulties, instance, member.name,
                    (label) => `${member.name} - ${instance.name} ${boss.name}, ${label}`));
            }

            list.appendChild(line);
        }

        name.addEventListener('click', () =>
        {
            list.hidden = !list.hidden;
            name.setAttribute('aria-expanded', String(!list.hidden));
            name.classList.toggle('open', !list.hidden);
        });

        row.appendChild(list);
        return row;
    }

    const note = document.createElement('span');
    note.className = 'boss-meta';
    note.textContent = boss.entry ? 'no creature data' : 'not a single creature';
    head.appendChild(note);

    return row;
}

async function openInstance(instance)
{
    currentInstance = instance;
    renderInstances(currentExpansion);

    const host = $('#boss-list');
    host.textContent = '';
    setStatus(`Loading ${instance.name}…`);

    const heading = document.createElement('h4');
    heading.textContent = instance.name;
    host.appendChild(heading);

    let result;

    try
    {
        result = await api(`api/instances/bosses?map=${encodeURIComponent(instance.mapId)}`);
    }
    catch (err)
    {
        setStatus(`Could not load bosses: ${err.message}`);
        return;
    }

    setStatus('');

    if (result.error === 'not-connected')
    {
        const hint = document.createElement('p');
        hint.className = 'hint';
        hint.textContent = 'Connect your world database in Settings to load these bosses.';
        host.appendChild(hint);
    }

    for (const boss of result.bosses || [])
    {
        host.appendChild(renderBoss(boss, instance));
    }
}

function selectExpansion(id)
{
    currentExpansion = tree.find((e) => e.id === id) || null;
    currentInstance = null;

    for (const button of $('#xpac-picker').querySelectorAll('button'))
    {
        button.classList.toggle('active', Number(button.dataset.xpac) === id);
    }

    $('#boss-list').textContent = '';

    const hint = document.createElement('p');
    hint.className = 'hint';
    /* The dialog serves both windows, and each is here for a different reason. */
    hint.textContent = browserMode === 'loot'
        ? 'Select a dungeon or raid boss to show its loot.'
        : browserMode === 'raid'
            ? 'Pick a boss, at the difficulty you want it in the raid.'
            : 'Select a dungeon or raid to show its bosses and bring up a template and model.';
    $('#boss-list').appendChild(hint);

    if (currentExpansion)
    {
        renderInstances(currentExpansion);
    }
}

async function openBrowser(mode = 'npc')
{
    browserMode = ['loot', 'raid'].includes(mode) ? mode : 'npc';

    $('#instance-dialog').showModal();
    $('#instance-dialog .dialog-head strong').textContent =
        browserMode === 'loot' ? 'Loot by boss'
            : browserMode === 'raid' ? 'Add a boss to the raid'
                : 'Dungeons & raids';

    /* The boss column belongs to whichever mode is open, so it starts over on each open. */
    if (currentInstance)
    {
        openInstance(currentInstance);
    }

    if (tree)
    {
        return;
    }

    setStatus('Reading the client…');

    try
    {
        const result = await api('api/instances');

        if (result.error)
        {
            setStatus(result.error === 'no-client'
                ? 'Point at your 3.3.5a folder in Settings first.'
                : `Could not read the instance list: ${result.error}`);
            return;
        }

        tree = result.expansions;
        setStatus('');

        // Wrath first: it is the expansion this program is for.
        selectExpansion(2);
    }
    catch (err)
    {
        setStatus(`Could not read the instance list: ${err.message}`);
    }
}

function bindBrowser()
{
    $('#btn-browse-instances').addEventListener('click', () => openBrowser('npc'));

    const loot = $('#btn-browse-loot');

    if (loot)
    {
        loot.addEventListener('click', () => openBrowser('loot'));
    }

    for (const button of $('#xpac-picker').querySelectorAll('button'))
    {
        button.addEventListener('click', () => selectExpansion(Number(button.dataset.xpac)));
    }
}

export { bindBrowser, openBrowser };
