'use strict';

/* The repeatable rows — stats, resistances, sockets, requirements, effects and set pieces. */

import { $, button, select, input, row } from './dom.js';
import { state } from './state.js';
import { update } from './preview.js';
import { M } from './wow.js';

function del(list, index)
{
    return button('×', 'del', () =>
    {
        state[list].splice(index, 1);
        renderLists();
        update();
    }, 'Remove');
}

const LIST_RENDERERS = {
    /*
     * One spoken line: who, how, and what. The type sits between the name and the words because
     * that is the order the sentence reads in — "Lord Marrowgar" "yells:" "Bonestorm!".
     */
    textLines: (item, i) => row(
        input('text', item.speaker, (v) => { item.speaker = v; update(); }, 'Speaker', '150px'),
        select(M.CHAT_TYPE_OPTIONS, item.type, (v) => { item.type = v; update(); }),
        input('text', item.text, (v) => { item.text = v; update(); }, 'What they say', ''),
        del('textLines', i)
    ),

    stats: (item, i) => row(
        select(M.STAT_TYPES, item.type, (v) => { item.type = v; update(); }),
        input('number', item.value, (v) => { item.value = v; update(); }, '', '90px'),
        del('stats', i)
    ),

    resistances: (item, i) => row(
        select(M.RESISTANCES, item.type, (v) => { item.type = v; update(); }),
        input('number', item.value, (v) => { item.value = v; update(); }, '', '90px'),
        del('resistances', i)
    ),

    sockets: (item, i) =>
    {
        // Show the same client texture the tooltip will use, so the editor matches the output.
        const swatch = document.createElement('img');
        swatch.className = 'socket-art';
        swatch.src = `ui/${M.SOCKETS[item].art}.png`;
        swatch.alt = '';

        const label = document.createElement('span');
        label.textContent = M.SOCKETS[item].label;
        label.style.flex = '1';

        return row(swatch, label, del('sockets', i));
    },

    requires: (item, i) =>
    {
        const unmet = document.createElement('label');
        unmet.className = 'check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = !!item.unmet;
        box.addEventListener('change', () => { item.unmet = box.checked; update(); });
        unmet.append(box, document.createTextNode(' red'));

        return row(
            input('text', item.text, (v) => { item.text = v; update(); }, 'Requires Revered with the Ashen Verdict'),
            unmet,
            del('requires', i)
        );
    },

    effects: (item, i) =>
    {
        const kind = select(
            [
                { value: 'Equip', label: 'Equip' },
                { value: 'Use', label: 'Use' },
                { value: 'Chance on hit', label: 'Chance on hit' },
                { value: 'custom', label: '(no prefix)' }
            ],
            item.kind,
            (v) => { item.kind = v; update(); }
        );
        kind.style.flex = '0 0 118px';

        const presets = select(
            [{ value: 'custom', label: 'Custom text…' }, ...M.EQUIP_PRESETS.map((p) => ({ value: p, label: p.replace(' {N}', ' N').replace('{N}', 'N') }))],
            item.preset,
            (v) => { item.preset = v; renderLists(); update(); }
        );
        presets.style.flex = '1';

        const children = [kind, presets];

        if (item.preset === 'custom')
        {
            children.push(input('text', item.text, (v) => { item.text = v; update(); }, 'Your own wording'));
        }
        else
        {
            children.push(input('number', item.value, (v) => { item.value = v; update(); }, '', '84px'));
        }

        children.push(del('effects', i));
        return row(...children);
    },

    setPieces: (item, i) => row(
        input('text', item, (v) => { state.setPieces[i] = v; update(); }, 'Shadowblade Breastplate'),
        del('setPieces', i)
    ),

    setBonuses: (item, i) => row(
        input('number', item.count, (v) => { item.count = v; update(); }, '', '70px'),
        input('text', item.text, (v) => { item.text = v; update(); }, 'Increases your critical strike rating by 40.'),
        del('setBonuses', i)
    ),

    /*
     * An achievement criterion is the line the game prints beside the tick, and a tick for
     * whether it is met.
     *
     * The text is typed rather than derived from a type and an asset id, which is deliberate: the
     * client's own descriptions are frequently developer shorthand — "30 hks in arathi",
     * "Complete 130 quests in Boren Tundra", typo included — so a sentence generated from the
     * enum would be tidier than the game's and therefore wrong. Loading a real achievement brings
     * its real text in, and it can be edited from there.
     */
    achCriteria: (item, i) =>
    {
        const done = document.createElement('label');
        done.className = 'check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.checked = item.done !== false;
        box.addEventListener('change', () => { item.done = box.checked; update(); });
        done.append(box, document.createTextNode(' met'));

        return row(
            input('text', item.text, (v) => { item.text = v; update(); }, 'Kel\'Thuzad'),
            done,
            del('achCriteria', i)
        );
    }
};

const LIST_DEFAULTS = {
    stats: () => ({ type: 'Strength', value: 100 }),
    resistances: () => ({ type: 'Fire', value: 20 }),
    requires: () => ({ text: '', unmet: false }),
    effects: () => ({ kind: 'Equip', preset: M.EQUIP_PRESETS[0], value: 100, text: '' }),
    setPieces: () => '',
    setBonuses: () => ({ count: 2, text: '' }),
    achCriteria: () => ({ text: '', done: true }),

    /* A new line follows the one above it: same speaker, same kind, ready for the words. */
    textLines: () =>
    {
        const previous = (state.textLines || [])[state.textLines.length - 1];

        return { speaker: previous ? previous.speaker : '', type: previous ? previous.type : 'say', text: '' };
    }
};

function renderLists()
{
    for (const name of Object.keys(LIST_RENDERERS))
    {
        const host = $(`[data-list="${name}"]`);

        if (!host)
        {
            continue;
        }

        host.textContent = '';
        (state[name] || []).forEach((item, i) => host.appendChild(LIST_RENDERERS[name](item, i)));
    }
}

export { renderLists, LIST_DEFAULTS };
