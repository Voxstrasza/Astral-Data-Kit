'use strict';

/*
 * One boss, opened.
 *
 * The roster answers "what is in this raid"; this answers "what is this fight". A boss is a name
 * and a set of difficulties, and a difficulty is the fight at that size: the creatures in it, the
 * phases it runs through, and the loot, achievements and lines that come with it.
 *
 * Difficulties are added rather than assumed. Most fights are not built at all four sizes, and a
 * row of empty tabs invites filling them in for the sake of it.
 *
 * Nothing is *made* here. A frame comes from the NPC window or the dungeon browser, a spell from
 * the Spell window, loot from the Item window, achievements and lines from theirs. Use what is
 * there rather than growing a second way to build the same thing.
 */

import { state, fieldsOf } from './state.js';
import { el, button } from './dom.js';
import { iconUrl } from './icons.js';
import { fillTriggers } from './lists.js';
import { M } from './wow.js';

/** The sizes a fight can be built at, matching lib/raids.js. */
const DIFFICULTIES = [
    { id: '10n', name: '10 Normal' },
    { id: '25n', name: '25 Normal' },
    { id: '10h', name: '10 Heroic' },
    { id: '25h', name: '25 Heroic' }
];

/** Which difficulty is showing, per boss, for as long as the window is open. */
const chosen = new Map();

function currentDifficulty(boss)
{
    const list = boss.difficulties || [];
    const wanted = chosen.get(boss.id);

    return list.find((d) => d.id === wanted) || list[0] || null;
}

/** A button that only works when a window has something in it, and says so when it does not. */
function takeButton(ready, readyLabel, emptyLabel, onClick)
{
    const node = button(ready ? readyLabel : emptyLabel, 'add', onClick);

    node.disabled = !ready;
    node.title = ready ? '' : 'Build or load one in that window, then come back';

    return node;
}

function input(value, placeholder, onChange, className)
{
    const node = el('input', className);
    node.type = 'text';
    node.value = value || '';
    node.placeholder = placeholder || '';
    node.addEventListener('change', () => onChange(node.value));

    return node;
}

/* ------------------------------------------------------------------- the boss */

/**
 * @param {object} boss     the boss being edited
 * @param {object} handlers save(patch), onBack(), onExport(boss, difficulty, mode)
 */
function renderBoss(boss, handlers)
{
    const { save, onBack, onExport } = handlers;
    const wrap = el('div');

    const bar = el('div', 'row raid-bar');
    bar.appendChild(button('← Back to the roster', 'loot-back', onBack));
    wrap.appendChild(bar);

    const head = el('div', 'raid-head');
    head.appendChild(input(boss.name, 'Boss name', (value) => save({ name: value }), 'raid-name'));
    wrap.appendChild(head);

    /* What this fight is. Drawn under the title on a sheet, in the game's flavor style. */
    const note = el('textarea', 'raid-note');
    note.rows = 2;
    note.value = boss.note || '';
    note.placeholder = 'Describe the fight - drawn as flavor text on the sheet';
    note.addEventListener('change', () => save({ note: note.value }));
    wrap.appendChild(note);

    /* ----------------------------------------------------------- difficulties */

    wrap.appendChild(el('h4', 'raid-section', 'Difficulties'));

    const difficulties = boss.difficulties || [];
    const tabs = el('div', 'boss-difficulties raid-difficulty-tabs');
    const showing = currentDifficulty(boss);

    for (const difficulty of difficulties)
    {
        const tab = button(difficulty.name, 'difficulty', () =>
        {
            chosen.set(boss.id, difficulty.id);
            handlers.redraw();
        });

        tab.classList.toggle('active', showing && difficulty.id === showing.id);
        tabs.appendChild(tab);
    }

    /* Only the sizes this fight has not been built at are offered. */
    for (const difficulty of DIFFICULTIES)
    {
        if (difficulties.some((d) => d.id === difficulty.id))
        {
            continue;
        }

        tabs.appendChild(button(`+ ${difficulty.name}`, 'difficulty raid-add-difficulty', () =>
        {
            chosen.set(boss.id, difficulty.id);
            save({
                difficulties: [...difficulties, {
                    id: difficulty.id,
                    name: difficulty.name,
                    npcs: [],
                    phases: [],
                    loot: [],
                    achievements: [],
                    lines: []
                }].sort((a, b) =>
                    DIFFICULTIES.findIndex((d) => d.id === a.id) - DIFFICULTIES.findIndex((d) => d.id === b.id))
            });
        }, `Build this fight at ${difficulty.name}`));
    }

    wrap.appendChild(tabs);

    if (!showing)
    {
        wrap.appendChild(el('p', 'hint', 'Add a difficulty to start building the fight.'));

        return wrap;
    }

    /* Everything below belongs to the difficulty showing. */
    const patch = (changes) =>
    {
        save({
            difficulties: difficulties.map((d) => (d.id === showing.id ? { ...d, ...changes } : d))
        });
    };

    wrap.appendChild(renderNpcs(showing, patch));
    wrap.appendChild(renderEnrage(showing, patch));
    wrap.appendChild(renderPhases(showing, patch));

    wrap.appendChild(renderAttachments({
        title: 'Loot',
        note: 'Drops at this difficulty. Load one in the Item window, then add it.',
        items: showing.loot || [],
        label: (entry) => entry.name || 'Unnamed item',
        icon: (entry) => entry.icon,
        ready: !!state.name,
        readyLabel: `Add ${state.name} from the Item window`,
        emptyLabel: 'Nothing in the Item window yet',
        take: () => fieldsOf('item'),
        onChange: (loot) => patch({ loot })
    }));

    wrap.appendChild(renderAttachments({
        title: 'Achievements',
        note: 'Earned from this fight at this difficulty.',
        items: showing.achievements || [],
        label: (entry) => entry.achTitle || 'Untitled achievement',
        icon: (entry) => entry.achIcon,
        ready: !!state.achTitle,
        readyLabel: `Add ${state.achTitle} from the Achievement window`,
        emptyLabel: 'Nothing in the Achievement window yet',
        take: () => fieldsOf('achievement'),
        onChange: (achievements) => patch({ achievements })
    }));

    wrap.appendChild(renderTexts(showing, patch));

    /* ---------------------------------------------------------------- export */

    wrap.appendChild(el('h4', 'raid-section', 'Export'));
    wrap.appendChild(el('p', 'hint',
        'One sheet with everything on it, or a sheet per phase when the fight is too big to read '
        + 'in one picture. Either way it is drawn for the difficulty showing.'));

    const exportBar = el('div', 'row raid-export');

    exportBar.append(
        button('Download PNG', 'primary', () => onExport(boss, showing.id, 'all')),
        button('One PNG per phase', 'add', () => onExport(boss, showing.id, 'phases'))
    );

    wrap.appendChild(exportBar);

    return wrap;
}

/* --------------------------------------------------------------------- NPCs */

/**
 * The creatures in the fight, each with the spells it casts.
 *
 * More than one is the normal case for the fights worth writing down: a council, a twin fight, a
 * boss and the adds it summons. Each carries its own frame so the sheet can draw them all.
 */
function renderNpcs(difficulty, patch)
{
    const block = el('div');

    block.appendChild(el('h4', 'raid-section', 'Creatures'));
    block.appendChild(el('p', 'hint',
        'The boss, its twin, a council, whatever it summons - each with the spells it uses.'));

    const npcs = difficulty.npcs || [];

    for (const npc of npcs)
    {
        const card = el('div', 'raid-boss');
        const line = el('div', 'raid-boss-head');

        line.appendChild(input(npc.name, 'Creature name',
            (value) => patchNpc(difficulty, npc.id, { name: value }, patch), 'raid-boss-name'));

        const role = el('select', 'raid-role');

        for (const [value, label] of [['boss', 'Boss'], ['add', 'Add'], ['ally', 'Ally']])
        {
            const option = el('option', '', label);
            option.value = value;
            option.selected = (npc.role || 'boss') === value;
            role.appendChild(option);
        }

        role.addEventListener('change', () =>
            patchNpc(difficulty, npc.id, { role: role.value }, patch));

        line.appendChild(role);
        line.appendChild(button('×', 'raid-mini', () =>
            patch({ npcs: npcs.filter((n) => n.id !== npc.id) }), 'Remove this creature'));

        card.appendChild(line);

        const frame = npc.frame || {};
        const facts = [];

        if (frame.unitLevel)
        {
            facts.push(frame.unitSkull ? 'Boss level' : `Level ${frame.unitLevel}`);
        }

        if (frame.unitHealthMax)
        {
            facts.push(`${Number(frame.unitHealthMax).toLocaleString()} HP`);
        }

        if (npc.frame && npc.frame.portrait)
        {
            facts.push('portrait captured');
        }

        card.appendChild(el('p', 'hint raid-boss-meta',
            facts.join(' · ') || 'No frame yet - load one in the NPC window and use the button below.'));

        /* The spells this creature casts. */
        for (const [index, spell] of (npc.spells || []).entries())
        {
            const row = el('div', 'raid-attach');

            if (spell.spellIcon)
            {
                const img = el('img', 'raid-attach-icon');
                img.src = iconUrl(spell.spellIcon);
                img.alt = '';
                row.appendChild(img);
            }

            row.appendChild(el('span', 'raid-attach-label', spell.spellName || 'Untitled spell'));

            /* Which phase it belongs to, chosen from the phases this difficulty has. */
            const phase = el('select', 'raid-phase-pick');
            const none = el('option', '', 'Any phase');
            none.value = '';
            phase.appendChild(none);

            for (const option of difficulty.phases || [])
            {
                const item = el('option', '', option.name || 'Phase');
                item.value = option.id;
                item.selected = spell.phase === option.id;
                phase.appendChild(item);
            }

            phase.addEventListener('change', () =>
            {
                const spells = (npc.spells || []).map((s, i) =>
                    (i === index ? { ...s, phase: phase.value } : s));

                patchNpc(difficulty, npc.id, { spells }, patch);
            });

            row.appendChild(phase);

            const copy = copyToPhase(difficulty, npc, spell, index, patch);

            if (copy)
            {
                row.appendChild(copy);
            }

            row.appendChild(button('×', 'raid-mini', () =>
            {
                patchNpc(difficulty, npc.id,
                    { spells: (npc.spells || []).filter((_, i) => i !== index) }, patch);
            }, 'Remove this spell'));

            card.appendChild(row);
        }

        const spellButton = takeButton(
            !!state.spellName,
            'Add a spell',
            'Add a spell - nothing in the Spell window yet',
            () => patchNpc(difficulty, npc.id,
                { spells: [...(npc.spells || []), { ...fieldsOf('spell'), phase: '' }] }, patch)
        );

        if (state.spellName)
        {
            spellButton.appendChild(
                el('span', 'raid-take-source', ` from the Spell window · ${state.spellName}`));

            spellButton.title = `Adds ${state.spellName} to ${npc.name || 'this creature'}`;
        }

        card.appendChild(spellButton);

        /*
         * A frame for this creature.
         *
         * The label names the action, not the source. "Replace Sindragosa from the NPC window" on
         * a creature called Lord Marrowgar read as though it would do something to Sindragosa,
         * when what it does is give *this* creature her frame — so the button says what happens to
         * the card it sits on, and what is being taken is a muted note beside it.
         */
        const frameButton = takeButton(
            !!state.unitName,
            npc.frame ? 'Replace this frame' : 'Set this frame',
            'Set this frame - nothing in the NPC window yet',
            () => patchNpc(difficulty, npc.id,
                { frame: fieldsOf('unit'), name: npc.name || state.unitName }, patch)
        );

        if (state.unitName)
        {
            const source = el('span', 'raid-take-source', ` from the NPC window · ${state.unitName}`);

            frameButton.appendChild(source);
            frameButton.title = `Gives ${npc.name || 'this creature'} the frame the NPC window is `
                + `showing (${state.unitName}), portrait and all`;
        }

        card.appendChild(frameButton);

        block.appendChild(card);
    }

    const add = el('div', 'row');

    add.appendChild(button('+ Add creature', 'add', () =>
    {
        patch({
            npcs: [...npcs, {
                id: `npc-${Date.now().toString(36)}-${npcs.length}`,
                name: state.unitName || 'New creature',
                role: npcs.length ? 'add' : 'boss',
                frame: state.unitName ? fieldsOf('unit') : null,
                spells: []
            }]
        });
    }, 'Adds the NPC window\'s frame when there is one, or an empty creature to fill in'));

    block.appendChild(add);

    return block;
}

/**
 * Puts the same ability in a second phase without going back to the Spell window for it.
 *
 * A fight reuses its abilities - the same cleave runs in phase one and again in phase three - and
 * a spell is filed under one phase, so the honest way to say "and again later" is a second copy.
 * The sheet already reads it that way: abilities are keyed by name *and* phase, so the copy appears
 * under its own phase heading rather than doubling up under one.
 *
 * The copy lands directly under the original, because a list that reorders itself while you are
 * reading it is a list you have to find your place in again.
 *
 * Returns null when there is nowhere to copy to, rather than a dead control.
 */
function copyToPhase(difficulty, npc, spell, index, patch)
{
    const targets = [
        { id: '', name: 'Any phase' },
        ...(difficulty.phases || []).map((phase) => ({ id: phase.id, name: phase.name || 'Phase' }))
    ].filter((target) => target.id !== (spell.phase || ''));

    if (!targets.length)
    {
        return null;
    }

    const pick = el('select', 'raid-phase-pick raid-phase-copy');
    const head = el('option', '', 'Copy to…');
    head.value = '';
    pick.appendChild(head);

    for (const target of targets)
    {
        const option = el('option', '', target.name);
        option.value = target.id || 'any';
        pick.appendChild(option);
    }

    pick.title = `Also runs ${spell.spellName || 'this spell'} in another phase`;

    pick.addEventListener('change', () =>
    {
        if (!pick.value)
        {
            return;
        }

        const spells = [...(npc.spells || [])];

        spells.splice(index + 1, 0, { ...spell, phase: pick.value === 'any' ? '' : pick.value });

        patchNpc(difficulty, npc.id, { spells }, patch);
    });

    return pick;
}

function patchNpc(difficulty, npcId, changes, patch)
{
    patch({
        npcs: (difficulty.npcs || []).map((npc) => (npc.id === npcId ? { ...npc, ...changes } : npc))
    });
}

/* ------------------------------------------------------------------- enrage */

/** What most WotLK enrage timers are, so ticking the box gives a sensible fight rather than zero. */
const ENRAGE_MINUTES = 10;

/**
 * The fight's hard deadline.
 *
 * Off unless it is ticked, and drawn at the very top of the ability table when it is - above the
 * first phase, because it is the one thing on the sheet that is true of every phase at once.
 *
 * The line as the sheet will draw it is shown beside the fields rather than described, since the
 * only question worth answering here is what comes out - "10 minutes, 30 seconds" says more about
 * the wording than a hint could.
 */
function renderEnrage(difficulty, patch)
{
    const enrage = difficulty.enrage || {};
    const block = el('div');

    block.appendChild(el('h4', 'raid-section', 'Enrage'));
    block.appendChild(el('p', 'hint',
        'A fight with a hard deadline says so at the top of its abilities. Nothing is drawn while '
        + 'this is off.'));

    const line = el('div', 'raid-enrage-row');
    const check = el('input');

    check.type = 'checkbox';
    check.checked = !!enrage.on;

    check.addEventListener('change', () => patch({
        enrage: check.checked
            ? { ...enrage, on: true, minutes: whole(enrage.minutes) || ENRAGE_MINUTES }
            : { ...enrage, on: false }
    }));

    const label = el('label', 'check');

    label.appendChild(check);
    label.appendChild(document.createTextNode(' This fight enrages'));
    line.appendChild(label);

    if (enrage.on)
    {
        line.appendChild(clockField('Minutes', enrage.minutes,
            (value) => patch({ enrage: { ...enrage, minutes: whole(value) } })));
        line.appendChild(clockField('Seconds', enrage.seconds,
            (value) => patch({ enrage: { ...enrage, seconds: whole(value) } })));

        line.appendChild(el('span', 'hint raid-enrage-preview', M.enrageLabel(enrage)));
    }

    block.appendChild(line);

    return block;
}

/** Whatever was typed, as a whole number of one unit or another. */
function whole(value)
{
    return Math.max(0, Math.floor(Number(value) || 0));
}

/** One half of the timer: its name, and a number under it. */
function clockField(name, value, onChange)
{
    const field = el('label', 'raid-enrage-field', name);
    const node = el('input');

    node.type = 'number';
    node.min = '0';
    node.value = whole(value);
    node.addEventListener('change', () => onChange(node.value));

    field.appendChild(node);

    return field;
}

/* ------------------------------------------------------------------- phases */

function renderPhases(difficulty, patch)
{
    const block = el('div');

    block.appendChild(el('h4', 'raid-section', 'Phases'));
    block.appendChild(el('p', 'hint',
        'Name the moments of the fight; a creature\'s spells can then be filed under one, and the '
        + 'sheet can be broken up by them.'));

    const phases = difficulty.phases || [];

    for (const [index, phase] of phases.entries())
    {
        const row = el('div', 'raid-boss raid-phase');
        const line = el('div', 'raid-boss-head');

        line.appendChild(el('span', 'raid-boss-order', String(index + 1)));
        line.appendChild(input(phase.name, 'Phase name',
            (value) => patchPhase(difficulty, phase.id, { name: value }, patch), 'raid-boss-name'));
        line.appendChild(input(phase.trigger, 'When - 70% health, on pull…',
            (value) => patchPhase(difficulty, phase.id, { trigger: value }, patch), 'raid-phase-trigger'));

        /*
         * A phase's place in the list is the order the fight runs in, and a fight is rarely written
         * down in that order — the arrows are how it gets there. Same idiom as the roster's bosses,
         * clamping silently at the ends rather than going dead there.
         */
        const buttons = el('div', 'raid-boss-buttons');

        buttons.append(
            button('↑', 'raid-mini', () => movePhase(phases, index, -1, patch), 'Earlier in the fight'),
            button('↓', 'raid-mini', () => movePhase(phases, index, 1, patch), 'Later in the fight'),
            button('×', 'raid-mini', () =>
                patch({ phases: phases.filter((p) => p.id !== phase.id) }), 'Remove this phase')
        );

        line.appendChild(buttons);

        row.appendChild(line);
        block.appendChild(row);
    }

    block.appendChild(button('+ Add phase', 'add', () =>
    {
        patch({
            phases: [...phases, {
                id: `phase-${Date.now().toString(36)}-${phases.length}`,
                name: `Phase ${phases.length + 1}`,
                trigger: ''
            }]
        });
    }));

    return block;
}

/**
 * A list with two neighbors swapped, or null when the move would fall off an end.
 *
 * Phases and text sets are both lists whose order is the order the fight runs in, and both are
 * reordered by the same pair of arrows, so the swap itself is written once.
 */
function swapped(list, index, delta)
{
    const to = index + delta;

    if (to < 0 || to >= list.length)
    {
        return null;
    }

    const moved = [...list];

    [moved[index], moved[to]] = [moved[to], moved[index]];

    return moved;
}

/**
 * Moves a phase up or down the fight.
 *
 * Spells are filed under a phase by id, so moving one carries its abilities with it and the sheet's
 * phase breakdown follows without anything else being touched.
 */
function movePhase(phases, index, delta, patch)
{
    const moved = swapped(phases, index, delta);

    if (moved)
    {
        patch({ phases: moved });
    }
}

function patchPhase(difficulty, phaseId, changes, patch)
{
    patch({
        phases: (difficulty.phases || []).map((phase) =>
            (phase.id === phaseId ? { ...phase, ...changes } : phase))
    });
}

/* -------------------------------------------------------------------- texts */

/** How a set of lines reads in the list: how many, and who speaks first. */
function summaryOf(set)
{
    const lines = set.textLines || [];

    return lines.length
        ? `${lines.length} line${lines.length === 1 ? '' : 's'} - ${lines[0].speaker || 'Unnamed'}`
        : 'No lines';
}

/**
 * Lines from the Texts window, each set filed under the moment it belongs to.
 *
 * A fight is not one conversation. The role-play before the pull, what the boss says over a corpse
 * and the words after the kill are separate exchanges, and a set that could only be attached
 * anonymously left them running together as one wall of quotes. So a set carries the moment it is
 * for, and draws under that name on the sheet.
 *
 * The moment is typed rather than chosen from a fixed list, with the same suggestions the Texts
 * window offers behind it - Intro and Outro included. Half the interesting moments belong to one
 * fight and nothing else ("When the third add spawns"), which is exactly why that field is free
 * text where it is written, and it would be strange for it to harden here.
 *
 * Order is the order they are listed: an intro belongs at the top of a sheet and an outro at the
 * bottom, and the arrows are how that is said.
 */
function renderTexts(difficulty, patch)
{
    const sets = difficulty.lines || [];
    const block = el('div');
    const save = (lines) => patch({ lines });

    block.appendChild(el('h4', 'raid-section', 'Texts'));
    block.appendChild(el('p', 'hint',
        'Role-play and encounter quotes. Each set is filed under a moment and drawn as its own '
        + 'block on the sheet, in the order they are listed here.'));

    /* The suggestions come from the model, the same list the Texts window's own trigger field uses. */
    fillTriggers();

    for (const [index, set] of sets.entries())
    {
        const row = el('div', 'raid-attach');

        const moment = input(set.label, 'Encounter quotes', (value) =>
            save(sets.map((s, i) => (i === index ? { ...s, label: value } : s))), 'raid-text-label');

        moment.setAttribute('list', 'chat-triggers');
        moment.title = 'The moment these lines belong to, drawn as the block\'s heading';

        row.appendChild(moment);
        row.appendChild(el('span', 'raid-attach-label', summaryOf(set)));

        const buttons = el('div', 'raid-boss-buttons');
        const move = (delta) =>
        {
            const moved = swapped(sets, index, delta);

            if (moved)
            {
                save(moved);
            }
        };

        buttons.append(
            button('↑', 'raid-mini', () => move(-1), 'Earlier on the sheet'),
            button('↓', 'raid-mini', () => move(1), 'Later on the sheet'),
            button('×', 'raid-mini', () => save(sets.filter((_, i) => i !== index)), 'Remove from texts')
        );

        row.appendChild(buttons);
        block.appendChild(row);
    }

    /*
     * Which moment the Texts window is being taken as, named before it is taken rather than fixed
     * afterwards - the answer is known while the lines are being written, and a set that arrives
     * unnamed is one more thing to go back and tidy.
     *
     * Typed, with the suggestions behind it, for the same reason the Texts window's own trigger is:
     * the moments worth naming are usually this fight's and nobody else's - "When the harpoons
     * fire", "Between intermissions" - and a list of eight would only ever be a starting point.
     */
    const held = (state.textLines || []).length;
    const moment = el('input', 'raid-text-label');

    moment.type = 'text';
    moment.placeholder = 'Intro, Outro, or your own';
    moment.setAttribute('list', 'chat-triggers');
    moment.title = 'Pick one of the usual moments or type whatever this set of lines is';

    const take = el('div', 'row raid-take-row');

    take.appendChild(takeButton(
        held > 0,
        `Add ${held} line${held === 1 ? '' : 's'} from the Texts window as`,
        'Nothing in the Texts window yet',
        () => save([...sets, { label: moment.value.trim(), ...fieldsOf('text') }])
    ));

    if (held)
    {
        take.appendChild(moment);
    }

    block.appendChild(take);

    return block;
}

/* -------------------------------------------------------------- attachments */

/**
 * Loot and achievements behave the same way: show what is attached, and offer whatever the relevant
 * window is holding. Written once so the two cannot drift apart.
 *
 * Texts started here too and outgrew it - a set of lines carries the moment it belongs to and an
 * order that matters, neither of which a drop of loot has.
 */
function renderAttachments({ title, note, items, label, icon, ready, readyLabel, emptyLabel, take, onChange })
{
    const block = el('div');

    block.appendChild(el('h4', 'raid-section', title));
    block.appendChild(el('p', 'hint', note));

    for (const [index, entry] of items.entries())
    {
        const row = el('div', 'raid-attach');
        const iconName = icon(entry);

        if (iconName)
        {
            const img = el('img', 'raid-attach-icon');
            img.src = iconUrl(iconName);
            img.alt = '';
            row.appendChild(img);
        }

        row.appendChild(el('span', 'raid-attach-label', label(entry)));
        row.appendChild(button('×', 'raid-mini',
            () => onChange(items.filter((_, i) => i !== index)), `Remove from ${title.toLowerCase()}`));

        block.appendChild(row);
    }

    block.appendChild(takeButton(ready, readyLabel, emptyLabel, () => onChange([...items, take()])));

    return block;
}

export { renderBoss, DIFFICULTIES };
