'use strict';

/*
 * The Armory: a character sheet with no character drawn in it.
 *
 * You pick a race, a class and a level, fill the nineteen slots, and read out the stat block that
 * character would really have. Clicking a slot opens a picker over two sources: the database,
 * filtered so a search from the boots slot cannot answer with a helm, and the pieces you invented
 * yourself, filtered the same way by the slot a saved item already carries.
 *
 * The numbers are not computed here. `sheet()` in lib/character.js does that, over the gear
 * `equipped()` adds up, and this posts what is worn and draws what comes back.
 *
 * The base of it reads the client rather than a database, so a character with nothing on it works
 * with no database configured; only the database half of the picker needs one. See TODO.md for the
 * phases and what each one adds.
 */

import { $, el } from './dom.js';
import { api, postJson } from './api.js';
import { state, effectText } from './state.js';
import { iconUrl } from './icons.js';
import { M, R } from './wow.js';
import { openTalents, talentSummary, clearTalents } from './talents.js';
import { modifyArmoryEntry } from './saved.js';

/*
 * The paper doll's own arrangement. Taking the model out is what lets the two columns sit beside
 * each other instead of down either side of it.
 */
const LEFT = ['Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Shirt', 'Tabard', 'Wrist'];
const RIGHT = ['Hands', 'Waist', 'Legs', 'Feet', 'Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2'];
const WEAPONS = ['Main hand', 'Off hand'];

/*
 * The sheet, six to a row, grouped the way the game groups them.
 *
 * `key` is what the API answers with, looked for among the five primaries, the five schools and
 * then the sheet itself. A cell whose key the sheet does not carry draws as a dash rather than a
 * zero, which is how a warrior's mana reads when every stat is shown.
 */
const SHEET = [
    { label: 'Health', key: 'health', tag: 'core' },
    { label: 'Mana', key: 'mana', tag: 'mana' },
    { label: 'Strength', key: 'str', tag: 'core' },
    { label: 'Agility', key: 'agi', tag: 'core' },
    { label: 'Stamina', key: 'sta', tag: 'core' },
    { label: 'Intellect', key: 'int', tag: 'mana' },
    { label: 'Spirit', key: 'spi', tag: 'mana' },
    { label: 'Armor', key: 'armor', tag: 'core' },

    { label: 'Damage', key: 'mainHand', part: 'damage', tag: 'melee' },
    { label: 'Speed', key: 'mainHand', part: 'speed', tag: 'melee' },
    { label: 'Off hand damage', key: 'offHand', part: 'damage', tag: 'melee' },
    { label: 'Off hand speed', key: 'offHand', part: 'speed', tag: 'melee' },
    { label: 'Attack power', key: 'attackPower', tag: 'melee' },
    { label: 'Melee crit', key: 'meleeCrit', suffix: '%', places: 2, tag: 'melee' },
    { label: 'Melee hit', key: 'meleeHit', suffix: '%', places: 2, tag: 'melee' },
    { label: 'Melee haste', key: 'meleeHaste', suffix: '%', places: 2, tag: 'melee' },
    { label: 'Expertise', key: 'expertise', tag: 'melee' },
    { label: 'Armor pen', key: 'armorPen', suffix: '%', places: 2, tag: 'melee' },

    { label: 'Ranged damage', key: 'ranged', part: 'damage', tag: 'ranged' },
    { label: 'Ranged speed', key: 'ranged', part: 'speed', tag: 'ranged' },
    { label: 'Ranged power', key: 'rangedPower', tag: 'ranged' },

    { label: 'Spell power', key: 'spellPower', tag: 'spell' },
    { label: 'Spell crit', key: 'spellCrit', suffix: '%', places: 2, tag: 'spell' },
    { label: 'Spell hit', key: 'spellHit', suffix: '%', places: 2, tag: 'spell' },
    { label: 'Spell haste', key: 'spellHaste', suffix: '%', places: 2, tag: 'spell' },
    { label: 'Mana regen', key: 'manaRegen', suffix: ' /5s', places: 1, tag: 'mana' },
    { label: 'While casting', key: 'manaRegenCasting', suffix: ' /5s', places: 1, tag: 'mana' },

    { label: 'Dodge', key: 'dodge', suffix: '%', places: 2, tag: 'defense' },
    { label: 'Parry', key: 'parry', suffix: '%', places: 2, tag: 'defense' },
    { label: 'Block', key: 'block', suffix: '%', places: 2, tag: 'defense' },
    { label: 'Block value', key: 'blockValue', tag: 'defense' },
    { label: 'Defense', key: 'defense', tag: 'defense' },
    { label: 'Resilience', key: 'resilience', suffix: '%', places: 2, tag: 'defense' },

    { label: 'Arcane', key: 'arcane', tag: 'resist' }, { label: 'Fire', key: 'fire', tag: 'resist' },
    { label: 'Frost', key: 'frost', tag: 'resist' }, { label: 'Nature', key: 'nature', tag: 'resist' },
    { label: 'Shadow', key: 'shadow', tag: 'resist' }
];

/*
 * What each class is actually read for.
 *
 * The game's own sheet shows every category to everyone, spell power on a warrior included. This
 * does not, because a sheet you are reading to judge a piece of gear is better without twelve
 * lines that will always be zero. Hybrids get both halves rather than a guess at which one they
 * are playing - a paladin can be any of three things and, until the talent calculator says which,
 * so can this. "Show all stats" is there for the case this gets wrong, which for a program about
 * inventing items is a case that will come up.
 */
const CLASS_STATS = {
    1: ['core', 'melee', 'defense', 'resist'],                          // Warrior
    2: ['core', 'mana', 'melee', 'spell', 'defense', 'resist'],         // Paladin
    3: ['core', 'mana', 'melee', 'ranged', 'defense', 'resist'],        // Hunter
    4: ['core', 'melee', 'defense', 'resist'],                          // Rogue
    5: ['core', 'mana', 'spell', 'resist'],                             // Priest
    6: ['core', 'melee', 'defense', 'resist'],                          // Death Knight
    7: ['core', 'mana', 'melee', 'spell', 'defense', 'resist'],         // Shaman
    8: ['core', 'mana', 'spell', 'resist'],                             // Mage
    9: ['core', 'mana', 'spell', 'resist'],                             // Warlock
    11: ['core', 'mana', 'melee', 'spell', 'defense', 'resist']         // Druid
};

/** Aura names as a racial should read them, rather than as the budget table spells them. */
const STAT_WORDS = {
    str: 'strength', agi: 'agility', sta: 'stamina', int: 'intellect', spi: 'spirit',
    meleeCrit: 'crit', spellCrit: 'spell crit', meleeHit: 'hit', spellHit: 'spell hit',
    meleeHaste: 'haste', attackPower: 'attack power', rangedPower: 'ranged attack power',
    blockValue: 'block value', spellPower: 'spell power', spellPen: 'spell penetration',
    manaRegen: 'mana per 5 sec', health: 'health', armor: 'armor'
};

/*
 * The editor's weapon labels back to the subclass the client numbers them by, for the racials that
 * wait on a weapon. `WEAPON_TYPES` in lib/items.js is the same table read the other way; a label
 * covers both the one and two-handed kind, and the first match is enough because every racial mask
 * that names a family names both.
 */
/*
 * Warrior, for Titan's Grip: the one class whose off hand takes a two-hander. Kept as a name
 * because the number on its own reads as nothing at the call site.
 */
const WARRIOR = 1;

const WEAPON_SUBCLASS = {
    'Axe': 0, 'Bow': 2, 'Gun': 3, 'Mace': 4, 'Polearm': 6, 'Sword': 7, 'Staff': 10,
    'Fist Weapon': 13, 'Dagger': 15, 'Thrown': 16, 'Crossbow': 18, 'Wand': 19
};

let setup = null;

let bound = false;

/** An option element. The shared select() builder wires its own handler, so this is by hand. */
function option(value, label, selected)
{
    const node = el('option', '', label);

    node.value = String(value);
    node.selected = selected;

    return node;
}

/*
 * What is equipped, by slot name.
 *
 * Whole editor items rather than references, because half of what goes in here will not have an
 * entry to refer to - a piece invented in the Item window and never saved is the case the Armory
 * exists for. It is not part of `state` for the same reason a portrait is not: it is bulky, and
 * what it is for is being read out rather than being carried in a permalink.
 */
const worn = new Map();

/*
 * The map and the saved field, kept in step.
 *
 * The panel works in a Map because order matters and slots come and go; the state works in a
 * plain object because that is what gets saved and put in a link. Rather than make every reader
 * choose, the Map stays the working copy and these two are called at the three places it
 * actually changes.
 */
function keepWorn()
{
    state.armoryWorn = Object.fromEntries(worn);
}

/** The other direction: a character that was just loaded, or a link that was just opened. */
function loadWorn()
{
    worn.clear();

    for (const [slot, item] of Object.entries(state.armoryWorn || {}))
    {
        if (item) { worn.set(slot, item); }
    }
}

/** The slot the picker was opened from, and which of its two sources is showing. */
let picking = '';
let source = 'database';
let searchTimer = 0;


/* ------------------------------------------------------------------- hover tooltips */

/*
 * The real tooltip, over the slot you are pointing at.
 *
 * Nothing new is drawn for this: `renderTooltip` is the same function the Item window previews
 * with and the exporter writes PNGs with, so what hangs off a slot is the tooltip that item has,
 * not a summary of it. It is asked for at 1.5x, which is large enough to read a stat line at a
 * glance without reaching for the mouse.
 */
const HOVER_SCALE = 1.5;

/** Icon images, kept because the same piece is hovered over and over while a set is compared. */
const iconCache = new Map();
let hoverNode = null;
let fontReady = null;

/**
 * The tooltip's own face, loaded once before the first draw.
 *
 * Canvas measures synchronously and never goes back over it, so a tooltip drawn while AstralGame
 * is still loading is laid out against the fallback's metrics and painted in the game's. The live
 * preview gets away with this by redrawing on every keystroke; a hover is drawn once.
 */
function ensureTooltipFont()
{
    if (!fontReady)
    {
        fontReady = document.fonts.load('16px AstralGame').catch(() => {});
    }

    return fontReady;
}

function iconImage(name)
{
    if (!name)
    {
        return Promise.resolve(null);
    }

    if (!iconCache.has(name))
    {
        iconCache.set(name, new Promise((resolve) =>
        {
            const img = new Image();

            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = iconUrl(name);
        }));
    }

    return iconCache.get(name);
}

/** The floating host, made once and moved around rather than built per hover. */
function hoverHost()
{
    if (!hoverNode)
    {
        hoverNode = el('div', 'armory-hover');
        hoverNode.hidden = true;
        document.body.append(hoverNode);
    }

    return hoverNode;
}

function hideHover()
{
    hoverHost().hidden = true;
}

/**
 * Draw one item's tooltip and park it beside its slot.
 *
 * Placed to the right of the slot where there is room and to the left where there is not, and
 * lifted off the bottom of the window the same way, so a boots slot at the foot of the page does
 * not put its tooltip somewhere unreadable.
 */
/*
 * What the sheet said about each slot's gems, kept from the last refresh.
 *
 * Whether a meta is lit is a question about the whole character, so it is answered once where the
 * whole character is - in `equipped()` on the server - and read here rather than worked out again
 * against a second copy of the rule.
 */
let gearState = {};

/** The gem lines for one item's tooltip: what is in each socket and whether it is doing anything. */
function gemContext(slot, item)
{
    const known = gearState[slot] || {};
    const active = known.activeGems || [];

    return {
        gems: (item.gems || []).map((gem, index) => gem && { ...gem, active: active[index] !== false }),
        socketBonusMet: !!known.socketBonusMet
    };
}

/** Every gem icon on one item, loaded and keyed by name for the renderer. */
async function gemImages(item)
{
    const names = (item.gems || []).filter(Boolean).map((gem) => gem.icon).filter(Boolean);
    const loaded = await Promise.all(names.map((name) => iconImage(name)));

    return Object.fromEntries(names.map((name, i) => [name, loaded[i]]).filter(([, img]) => img));
}

async function showHover(slotNode, item, slotName)
{
    await ensureTooltipFont();

    const host = hoverHost();

    /* The pointer may have moved on while the font and the icon were loading. */
    if (!slotNode.matches(':hover'))
    {
        return;
    }

    const prepared = {
        ...item,
        kind: 'item',
        effects: (item.effects || []).map((e) => ({ kind: e.kind, text: effectText(e) })),

        /*
         * What the tooltip cannot work out for itself: how many of this set are on, and which of
         * its named pieces they are. Without these it reads "0/5" with everything grey, which is
         * right for a piece in a bag and wrong for one being worn.
         */
        ...setContext(item),

        /*
         * And the same for the gems: whether a meta is lit depends on what is socketed elsewhere
         * on the character, which one item cannot know. The sheet worked it out over the whole
         * rack and sent it back, so this reads the answer rather than deriving it twice.
         */
        ...gemContext(slotName, item)
    };

    /* The gems' icons, loaded before the draw. The renderer paints synchronously, so anything it
       is going to draw has to already be in hand. */
    const gemIcons = await gemImages(item);

    const canvas = R.renderTooltip(M.buildLines(prepared), {
        icon: await iconImage(item.icon),
        iconPlacement: 'outside',
        gemIcons,
        maxWidth: 300,
        transparent: false,
        borderColor: M.qualityColor(item.quality)
    }, HOVER_SCALE);

    host.replaceChildren(canvas);
    host.hidden = false;

    const slot = slotNode.getBoundingClientRect();
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);
    const room = window.innerWidth - slot.right;

    const left = room > width + 20 ? slot.right + 10 : Math.max(8, slot.left - width - 10);
    const top = Math.max(8, Math.min(slot.top, window.innerHeight - height - 8));

    host.style.left = `${Math.round(left)}px`;
    host.style.top = `${Math.round(top)}px`;
}
/** One slot: an item's icon and name when it holds one, the name of the slot when it does not. */
function slotBox(name)
{
    const box = el('button', 'slot');
    const item = worn.get(name);

    box.type = 'button';
    box.dataset.slot = name;

    /* No `title`. The browser's own tooltip would open a second, smaller box on top of the item's
       real one; how a slot works is said once at the head of the panel instead. */

    const icon = el('span', 'slot-icon');

    if (item && item.icon)
    {
        icon.style.backgroundImage = `url("${iconUrl(item.icon)}")`;
        icon.classList.add('has-item');
    }

    const label = el('span', 'slot-name', item ? item.name : name);

    if (item)
    {
        box.classList.add('filled');
        label.style.color = M.qualityColor(item.quality);
    }

    /*
     * The name, with the enchant on a second line under it.
     *
     * Stacked in their own column rather than appended to the slot, because the slot is a row of
     * icon and text and a third child would sit beside the name instead of under it.
     *
     * The enchantment's own line rather than the spell's, so a slot reads the same words its
     * tooltip does - "Berserking", not "Enchant Weapon - Berserking".
     */
    const text = el('span', 'slot-text');

    text.append(label);

    if (item && item.enchant)
    {
        text.append(el('span', 'slot-enchant', item.enchant.text || item.enchant.name));
    }

    box.append(icon, text);

    box.addEventListener('click', () => openPicker(name));

    if (item)
    {
        box.addEventListener('mouseenter', () => showHover(box, item, name));
        box.addEventListener('mouseleave', hideHover);
    }

    /* Right click opens the menu that gems, enchants and empties it. A slot with nothing in it
       has none of those to offer, so the browser's own menu is left alone there. */
    box.addEventListener('contextmenu', (e) =>
    {
        if (!worn.has(name))
        {
            return;
        }

        e.preventDefault();
        openSlotMenu(name, e.clientX, e.clientY);
    });

    return box;
}

/* ------------------------------------------------------------------- the slot menu */

/*
 * What right clicking a filled slot offers: its sockets, its enchant, and taking it off.
 *
 * The sockets are listed one row each rather than behind a single "add gems", because a socket is
 * where a gem goes and which one you meant is the first thing the picker would have to ask
 * anyway. Each row carries its own art and says what is in it, so the menu doubles as the readout
 * of what this piece is socketed with.
 */
let menuNode = null;

/*
 * The three slots that take a socket you added yourself.
 *
 * Gloves and bracers get theirs from a blacksmith and a belt from an Eternal Belt Buckle. The
 * Armory models no professions, so it offers the socket rather than the profession - but it
 * offers it only where the game does, since a prismatic socket on a helm is not a thing.
 */
const BUCKLE_SLOTS = new Set(['Hands', 'Waist', 'Wrist']);

/** Three is every socket an item can carry, added ones included. */
const MAX_SOCKETS = 3;

function menuHost()
{
    if (!menuNode)
    {
        menuNode = el('div', 'slot-menu');
        menuNode.hidden = true;
        document.body.append(menuNode);
    }

    return menuNode;
}

function hideMenu()
{
    menuHost().hidden = true;
}

/** One line of the menu: a label, an optional piece of art, and what it does. */
function menuRow(label, onPick, { art, note, danger } = {})
{
    const row = el('button', danger ? 'slot-menu-row is-danger' : 'slot-menu-row');

    row.type = 'button';

    if (art)
    {
        const image = el('span', 'slot-menu-art');

        image.style.backgroundImage = `url("${art}")`;
        row.append(image);
    }

    row.append(el('span', 'slot-menu-label', label));

    if (note)
    {
        row.append(el('span', 'slot-menu-note', note));
    }

    row.addEventListener('click', () =>
    {
        hideMenu();
        onPick();
    });

    return row;
}

/** Takes the piece off, which is what right click used to do on its own. */
function unequip(slot)
{
    worn.delete(slot);
    keepWorn();
    forgetSource(slot);
    drawSlots();
    drawRacials();
    refresh();
}

/** Adds the socket a buckle or a blacksmith would, and remembers that it was added here. */
function addPrismatic(slot)
{
    const item = worn.get(slot);

    item.sockets = [...(item.sockets || []), 'prismatic'];
    item.armoryPrismatic = true;

    keepWorn();
    refresh();
}

/** Takes it back out, and the gem that was in it with it. */
function removePrismatic(slot)
{
    const item = worn.get(slot);
    const index = (item.sockets || []).lastIndexOf('prismatic');

    if (index < 0)
    {
        return;
    }

    item.sockets = item.sockets.filter((_, i) => i !== index);
    item.gems = (item.gems || []).filter((_, i) => i !== index);
    item.armoryPrismatic = false;

    keepWorn();
    refresh();
}

function openSlotMenu(slot, x, y)
{
    /* The tooltip is hanging off the slot that was just right clicked, and the menu opens on top
       of where it is. One or the other, not both. */
    hideHover();

    const item = worn.get(slot);
    const host = menuHost();
    const rows = [];

    rows.push(el('div', 'slot-menu-title', item.name));

    /* A socket each, in the order the item carries them, so row two is socket two. */
    (item.sockets || []).forEach((color, index) =>
    {
        const def = M.SOCKETS[color];
        const gem = (item.gems || [])[index];

        if (!def)
        {
            return;
        }

        rows.push(menuRow(gem ? gem.name : def.label, () => openGemPicker(slot, index), {
            art: gem && gem.icon ? iconUrl(gem.icon) : `ui/${def.art}.png`,
            note: gem ? 'change' : 'add gem'
        }));
    });

    rows.push(menuRow(item.enchant ? item.enchant.name : 'Add enchant',
        () => openEnchantPicker(slot),
        { note: item.enchant ? 'change' : '' }));

    /*
     * The buckle, offered only where the game offers it and only while there is room. An item
     * already carrying three sockets has nowhere to put a fourth, whatever slot it is in.
     */
    if (BUCKLE_SLOTS.has(slot))
    {
        if (item.armoryPrismatic)
        {
            rows.push(menuRow('Remove prismatic socket', () => removePrismatic(slot)));
        }
        else if ((item.sockets || []).length < MAX_SOCKETS)
        {
            rows.push(menuRow('Add prismatic socket', () => addPrismatic(slot),
                { art: `ui/${M.SOCKETS.prismatic.art}.png` }));
        }
    }

    rows.push(menuRow('Remove item', () => unequip(slot), { danger: true }));

    host.replaceChildren(...rows);
    host.hidden = false;

    /* Opened at the pointer, pulled back inside the window where it would hang off an edge. */
    const box = host.getBoundingClientRect();

    host.style.left = `${Math.round(Math.min(x, window.innerWidth - box.width - 8))}px`;
    host.style.top = `${Math.round(Math.min(y, window.innerHeight - box.height - 8))}px`;
}

/* Anywhere else, any key, or a scroll closes it - the three things that mean "not this menu". */
document.addEventListener('pointerdown', (e) =>
{
    if (menuNode && !menuNode.hidden && !menuNode.contains(e.target))
    {
        hideMenu();
    }
});

document.addEventListener('keydown', (e) =>
{
    if (e.key === 'Escape')
    {
        hideMenu();
    }
});

window.addEventListener('scroll', hideMenu, true);

/*
 * The last weapon slot's name, which is also the key it is worn under.
 *
 * A warrior, rogue, hunter, priest, mage or warlock reads Ranged; a paladin reads Libram, a death
 * knight Sigil, a shaman Totem and a druid Idol. The table is the server's, sent with the setup,
 * so the word and the InventoryTypes behind it cannot drift apart.
 */
function rangedSlot()
{
    return (setup && setup.rangedSlots && setup.rangedSlots[state.armoryClass]) || 'Ranged';
}

/** The three slots under the two columns, with the last one named for the class. */
function weaponSlots()
{
    return [...WEAPONS, rangedSlot()];
}

/*
 * The order the Equipped table reads in.
 *
 * Down the character rather than in the order the slots happened to be filled: a list that reorders
 * itself as you work cannot be scanned, and the row a piece is on should not depend on when it was
 * put there. Armour from the head down, then the jewellery, then what is held, and the three that
 * carry nothing - tabard and shirt - last, where they are out of the way of the gear being read.
 *
 * Not the rack's own order, which runs down two columns side by side and puts the shirt and tabard
 * in the middle of the left one because that is where they fit. This is a single list and can be
 * ordered by what it is for.
 *
 * The relic slot is asked for by name rather than written in, since it is a Libram or a Sigil or a
 * Totem or an Idol depending on the class, and the word is the key it is worn under.
 */
function equippedOrder()
{
    return [
        'Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Wrist',
        'Hands', 'Waist', 'Legs', 'Feet',
        'Finger 1', 'Finger 2', 'Trinket 1', 'Trinket 2',
        'Main hand', 'Off hand', rangedSlot(),
        'Tabard', 'Shirt'
    ];
}

/*
 * The source map, guaranteed to exist.
 *
 * A character saved before the field existed comes back without it, and every reader would
 * otherwise have to say so itself.
 */
function sourceMap()
{
    if (!state.armorySources) { state.armorySources = {}; }

    return state.armorySources;
}

/*
 * The last slot changes its name with the class, so whatever is in it has to follow.
 *
 * A bow is not a libram. Rather than leave a piece filed under a slot the panel has stopped
 * drawing, it moves across when the new slot would take it and comes off when it would not -
 * which between the ranged and the relic halves is always, since they share no InventoryType.
 */
function retuneRanged()
{
    const wanted = rangedSlot();
    const every = ['Ranged', ...Object.values((setup && setup.rangedSlots) || {})];

    for (const name of every)
    {
        if (name === wanted || !worn.has(name))
        {
            continue;
        }

        const item = worn.get(name);
        const fits = slotAccepts(wanted).includes(item.slot);

        /* A piece keeps where it came from when it moves across; when it comes off, so does that. */
        const was = sourceMap()[name];

        worn.delete(name);
        keepWorn();
        forgetSource(name);

        if (fits)
        {
            worn.set(wanted, item);
            keepWorn();

            if (was !== undefined) { sourceMap()[wanted] = was; }
        }
    }
}

function drawSlots()
{
    /*
     * Every redraw throws away the node the pointer is over, and a node that no longer exists
     * cannot fire `mouseleave` - so a tooltip opened over a slot that is then emptied would hang
     * there with nothing left to close it. Hiding here covers every redraw rather than the one
     * that was noticed.
     */
    hideHover();

    /* Before the slots are drawn, not after: the loop below asks which three to draw. */
    retuneRanged();

    for (const [id, names] of [['left', LEFT], ['right', RIGHT], ['weapon', weaponSlots()]])
    {
        const host = $(`#armory-slots-${id}`);

        host.replaceChildren(...names.map(slotBox));
    }
}

/**
 * Equipping, with the game's own rule about hands.
 *
 * A two-hander occupies both weapon slots, so putting one in a main hand empties the off hand and
 * putting anything in an off hand that is being held by a two-hander empties the main. The panel
 * is where this belongs: `equipped()` adds up whatever it is given and would happily total a
 * two-hander and a shield at once.
 */
function equip(slot, item)
{
    forgetSource(slot);

    worn.set(slot, item);
    keepWorn();

    /*
     * A two-hander fills both hands, and empties the other one when it goes in.
     *
     * Except on a warrior, who has Titan's Grip and can hold two of them. That is the whole of the
     * exception: everyone else still loses the off hand to a two-hander, and a warrior still loses
     * nothing to anything.
     */
    const titansGrip = state.armoryClass === WARRIOR;

    if (!titansGrip && slot === 'Main hand' && item.slot === 'Two-Hand')
    {
        worn.delete('Off hand');
        keepWorn();
        forgetSource('Off hand');
    }

    if (!titansGrip && slot === 'Off hand')
    {
        const main = worn.get('Main hand');

        if (main && main.slot === 'Two-Hand')
        {
            worn.delete('Main hand');
            keepWorn();
            forgetSource('Main hand');
        }
    }

    drawSlots();
    drawRacials();
    refresh();
}

/** One row in the picker: the icon, the name in its quality color, and what it is. */
function pickerRow(item, onPick)
{
    const row = el('button', 'npc-row item-row');

    row.type = 'button';

    if (item.icon)
    {
        const img = el('img', 'item-row-icon');

        img.src = iconUrl(item.icon);
        img.alt = '';
        row.append(img);
    }

    const text = el('span', 'item-row-text');
    const name = el('span', 'npc-name', item.name || '(no name)');

    name.style.color = M.qualityColor(item.quality);

    const meta = el('span', 'npc-meta', [
        item.itemLevel ? `ilvl ${item.itemLevel}` : '',
        item.slot,
        item.type || item.itemType,
        item.entry ? `#${item.entry}` : 'custom'
    ].filter(Boolean).join(' · '));

    text.append(name, meta);
    row.append(text);
    row.addEventListener('click', onPick);

    return row;
}

function pickerStatus(text)
{
    $('#armory-picker-status').textContent = text;
}


/* ------------------------------------------------------- gems and enchants */

/*
 * The socket being gemmed and the slot being enchanted, while their dialogs are open.
 *
 * Two of them rather than one shared, because they are two dialogs and either can be opened from
 * the same menu; a single variable would have the enchant picker writing into a socket index.
 */
let gemming = null;
let enchanting = '';
let gemTimer = 0;

/*
 * What item class and subclass an equipped piece is, for the enchants that name a weapon rather
 * than a slot.
 *
 * The one and two handed kinds of axe, mace and sword share a label and are different subclasses,
 * so the slot the piece goes in is what tells them apart - which is the same thing the tooltip's
 * own weapon line does. `WEAPON_TYPES` in lib/items.js is this table read the other way.
 */
const TWO_HANDED_SUBCLASS = { 'Axe': 1, 'Mace': 5, 'Sword': 8 };

/*
 * The editor slot labels one Armory slot takes, with Titan's Grip folded in.
 *
 * `setup.slots` is the server's table and it is fetched once, before a class is chosen, so the
 * one slot whose answer depends on the class is added here rather than there: a warrior's off
 * hand takes a two-hander. The server applies the same rule to the database search by being told
 * the class; this is the same rule for the saved pieces, which are filtered on this side.
 */
function slotAccepts(slot)
{
    const names = (setup && setup.slots && setup.slots[slot]) || [];

    return slot === 'Off hand' && state.armoryClass === WARRIOR
        ? [...names, 'Two-Hand']
        : names;
}

function itemKind(item)
{
    if (!item)
    {
        return null;
    }

    if (item.itemType === 'Shield')
    {
        return { itemClass: 4, subclass: 6 };
    }

    const subclass = WEAPON_SUBCLASS[item.itemType];

    if (subclass === undefined)
    {
        return null;
    }

    const twoHanded = item.slot === 'Two-Hand' && TWO_HANDED_SUBCLASS[item.itemType] !== undefined;

    return { itemClass: 2, subclass: twoHanded ? TWO_HANDED_SUBCLASS[item.itemType] : subclass };
}

/** One gem or enchant row: an icon where there is one, the name, and what it does in green. */
function extraRow({ icon, name, quality, note, detail, warn }, onPick)
{
    const row = el('button', 'npc-row item-row');

    row.type = 'button';

    if (icon)
    {
        const img = el('img', 'item-row-icon');

        img.src = iconUrl(icon);
        img.alt = '';
        row.append(img);
    }

    const text = el('span', 'item-row-text');
    const title = el('span', 'npc-name', name || '(no name)');

    if (quality !== undefined)
    {
        title.style.color = M.qualityColor(quality);
    }

    text.append(title);

    if (note)
    {
        text.append(el('span', 'extra-effect', note));
    }

    if (detail)
    {
        text.append(el('span', 'npc-meta', detail));
    }

    if (warn)
    {
        text.append(el('span', 'extra-requires', warn));
    }

    row.append(text);
    row.addEventListener('click', onPick);

    return row;
}

/** Puts a gem in a socket, or takes one out when handed nothing. */
function setGem(slot, index, gem)
{
    const item = worn.get(slot);

    if (!item)
    {
        return;
    }

    /* Kept as a sparse array beside `sockets`, so socket two being filled while one and three are
       open stays true however the gems were put in. */
    const gems = [...(item.gems || [])];

    gems[index] = gem || null;
    item.gems = gems;

    keepWorn();
    refresh();
}

async function showGems()
{
    const results = $('#gem-picker-results');
    const query = $('#gem-picker-search').value.trim();
    const socket = gemming ? gemming.color : '';

    $('#gem-picker-status').textContent = 'searching...';

    const answer = await api(
        `/api/gem/search?socket=${encodeURIComponent(socket)}&q=${encodeURIComponent(query)}`);

    if (answer.error)
    {
        $('#gem-picker-status').textContent = answer.error === 'not-connected'
            ? 'No database configured, so there are no gems to list.'
            : answer.error === 'no-client'
                ? 'Point Astral at your client to read gems.'
                : answer.error;
        results.replaceChildren();
        return;
    }

    $('#gem-picker-status').textContent = `${answer.results.length} found`;

    if (!answer.results.length)
    {
        results.replaceChildren(el('p', 'hint', query
            ? `No gems match "${query}".`
            : 'No gems fit that socket.'));
        return;
    }

    results.replaceChildren(...answer.results.map((gem) => extraRow({
        icon: gem.icon,
        name: gem.name,
        quality: gem.quality,

        /* What it is worth, which is the line people actually pick on. */
        note: gem.text,
        detail: [gem.color, gem.itemLevel ? `ilvl ${gem.itemLevel}` : ''].filter(Boolean).join(' · '),
        warn: gem.requiresText
    }, () =>
    {
        setGem(gemming.slot, gemming.index, gem);
        $('#gem-picker').close();
    })));
}

function openGemPicker(slot, index)
{
    const item = worn.get(slot);

    if (!item)
    {
        return;
    }

    const color = (item.sockets || [])[index];
    const def = M.SOCKETS[color];

    gemming = { slot, index, color };

    $('#gem-picker-title').textContent = `${def ? def.label : 'Socket'} - ${slot}`;
    $('#gem-picker-search').value = '';
    $('#gem-picker-status').textContent = '';

    /* Only offered when there is something to remove. */
    $('#gem-picker-clear').hidden = !(item.gems || [])[index];

    $('#gem-picker').showModal();
    showGems();
    $('#gem-picker-search').focus();
}

/** Sets or clears the slot's enchant. */
function setEnchant(slot, enchant)
{
    const item = worn.get(slot);

    if (!item)
    {
        return;
    }

    if (enchant)
    {
        item.enchant = enchant;
    }
    else
    {
        delete item.enchant;
    }

    keepWorn();

    /* The slot draws the enchant under the item name, so the row has to be rebuilt here.
       `refresh()` only recomputes the stat sheet, which is why the line used to wait for the
       next equip to appear. */
    drawSlots();
    refresh();
}

/*
 * The whole slot's list, fetched once and filtered in the box.
 *
 * A slot has fifty or so and they all come from the client rather than a search, so there is
 * nothing to go back to the server for as you type.
 */
let enchantList = [];

function drawEnchants()
{
    const results = $('#enchant-picker-results');
    const query = $('#enchant-picker-search').value.trim().toLowerCase();

    const shown = query
        ? enchantList.filter((one) =>
            one.name.toLowerCase().includes(query) || one.text.toLowerCase().includes(query))
        : enchantList;

    $('#enchant-picker-status').textContent = query
        ? `${shown.length} of ${enchantList.length}`
        : `${enchantList.length} for this slot`;

    if (!shown.length)
    {
        results.replaceChildren(el('p', 'hint', enchantList.length
            ? `No enchants match "${query}".`
            : 'The client lists no enchants for this slot.'));
        return;
    }

    results.replaceChildren(...shown.map((one) => extraRow({
        name: one.name,

        /* The enchantment's own line, which is what the item's tooltip will read. A proc says its
           name twice rather than a number, and that is the honest answer for one. */
        note: one.text
    }, () =>
    {
        setEnchant(enchanting, one);
        $('#enchant-picker').close();
    })));
}

async function openEnchantPicker(slot)
{
    const item = worn.get(slot);

    if (!item)
    {
        return;
    }

    enchanting = slot;
    enchantList = [];

    $('#enchant-picker-title').textContent = `Enchant - ${slot}`;
    $('#enchant-picker-search').value = '';
    $('#enchant-picker-status').textContent = 'reading the client...';
    $('#enchant-picker-results').replaceChildren();
    $('#enchant-picker-clear').hidden = !item.enchant;
    $('#enchant-picker').showModal();

    /* What is in the slot goes with the question: a weapon enchant names the weapons it fits
       rather than the hand, so Mongoose is offered for a sword and not for a wand. */
    const kind = itemKind(item);
    const kindQuery = kind ? `&itemClass=${kind.itemClass}&subclass=${kind.subclass}` : '';

    const answer = await api(`/api/enchant/list?slot=${encodeURIComponent(slot)}`
        + `&class=${state.armoryClass}${kindQuery}`);

    if (answer.error)
    {
        $('#enchant-picker-status').textContent = answer.error === 'no-client'
            ? 'Point Astral at your client to read enchants.'
            : answer.error;
        return;
    }

    enchantList = answer.results || [];
    drawEnchants();
    $('#enchant-picker-search').focus();
}

/**
 * Modify and delete, for a piece of your own.
 *
 * Only the custom side gets these. A database row is the server's, and neither button has anything
 * to say about it; a piece you invented is yours to correct or to throw away, and this picker is
 * the only place it is ever listed, so it is the only place those can live.
 *
 * The whole row is wrapped rather than the buttons being put inside it, because the row *is* a
 * button — equipping the piece — and a button inside a button is not a thing a browser will build.
 */
function customRow(entry, item)
{
    const row = el('div', 'picker-row');
    const pick = pickerRow(item, () =>
    {
        equip(picking, item);
        $('#armory-picker').close();
    });

    const modify = el('button', 'raid-mini', 'Modify');

    modify.type = 'button';
    modify.title = `Open ${item.name || 'this piece'} in the Item window to edit it`;
    modify.addEventListener('click', (event) =>
    {
        event.stopPropagation();

        $('#armory-picker').close();

        /* The real tab button rather than a reach into state: switching windows reloads the icon
           and redraws the preview, and that is all wired to the click. */
        modifyArmoryEntry(entry);
        $('.kind-switch button[data-kind="item"]').click();
    });

    /* Armed once before it fires, the way deleting a raid is. Losing an invented piece to a
       mis-aimed click is not something a saved file can be talked back out of. */
    const remove = el('button', 'raid-mini raid-delete', '×');

    remove.type = 'button';
    remove.title = `Delete ${item.name || 'this piece'}`;
    remove.addEventListener('click', async (event) =>
    {
        event.stopPropagation();

        if (remove.dataset.armed !== 'yes')
        {
            remove.dataset.armed = 'yes';
            remove.textContent = 'Delete?';
            remove.title = 'Press again to delete this piece for good';

            setTimeout(() =>
            {
                remove.dataset.armed = '';
                remove.textContent = '×';
                remove.title = `Delete ${item.name || 'this piece'}`;
            }, 4000);

            return;
        }

        await postJson('/api/saved/delete', { kind: 'armory', id: entry.id });
        showCustom();
    });

    row.append(pick, modify, remove);

    return row;
}

/**
 * The saved side: everything in the Armory's own store whose slot fits the one being filled.
 *
 * Its own store, not the saved-items list the Item window draws. That list is work waiting to be
 * drawn as a sheet, and gear kept so a character can wear it was never going into a picture.
 *
 * Nothing is stored twice for this. A saved piece already carries the slot it was built for, so
 * the filter is read at open time and cannot go stale the way a folder chosen at save time would.
 */
async function showCustom()
{
    const fits = slotAccepts(picking);
    const query = $('#armory-picker-search').value.trim().toLowerCase();
    const results = $('#armory-picker-results');

    /* A saved entry is a wrapper - id, name, icon, then the window's own fields underneath. The
       item is `fields`, and everything from the slot to the stat rows is in there. The wrapper is
       kept as well as the item, because Modify and delete both need the id off it. */
    const answer = await api('/api/saved?kind=armory');
    const forSlot = (answer.saved || [])
        .map((entry) => ({ entry, item: entry.fields || {} }))
        .filter(({ item }) => fits.includes(item.slot));

    /*
     * Searched like the database side, and listed unsearched when the box is empty. This store is
     * yours and small, so the useful default is to show it; the database is millions of rows and
     * has to be asked a question first.
     */
    const mine = query
        ? forSlot.filter(({ item }) => (item.name || '').toLowerCase().includes(query))
        : forSlot;

    pickerStatus(forSlot.length ? `${mine.length} of ${forSlot.length} saved` : '');

    if (!mine.length)
    {
        results.replaceChildren(el('p', 'hint', forSlot.length
            ? `No saved ${picking} slot items match "${query}".`
            : `No ${picking} slot items saved yet. Build one in the Item window and use Save for`
                + ' Armory, and it will be here. Hand-written stat lines are not read - pick the'
                + ' presets.'));
        return;
    }

    results.replaceChildren(...mine.map(({ entry, item }) => customRow(entry, item)));
}

/** The database side, filtered to what the slot takes so a boots search cannot answer with a helm. */
async function showDatabase()
{
    const query = $('#armory-picker-search').value.trim();
    const results = $('#armory-picker-results');

    if (query.length < 2)
    {
        /* No search, so no count. Leaving the last one up would have it describe a list that is
           not on screen, and on a freshly opened slot a list from a different slot entirely. */
        pickerStatus('');
        results.replaceChildren(el('p', 'hint',
            `Type a name or an entry to search for ${picking} slot items.`));
        return;
    }

    pickerStatus('searching...');

    /* The class goes with the slot, for the one slot whose answer depends on it: a warrior's off
       hand takes two-handers. */
    const answer = await api(
        `/api/item/search?q=${encodeURIComponent(query)}&slot=${encodeURIComponent(picking)}`
        + `&class=${state.armoryClass}`);

    if (answer.error)
    {
        pickerStatus(answer.error === 'not-connected'
            ? 'No database configured. Custom gear still works.'
            : answer.error);
        results.replaceChildren();
        return;
    }

    pickerStatus(`${answer.results.length} found`);

    if (!answer.results.length)
    {
        results.replaceChildren(el('p', 'hint',
            `No ${picking} slot items match "${query}".`));
        return;
    }

    results.replaceChildren(...answer.results.map((row) => pickerRow(row, async () =>
    {
        /* The search answers with a summary; the sheet needs the whole item, so it is fetched on
           the way in rather than for every row of a list that is mostly not going to be picked. */
        const full = await api(`/api/item/get?entry=${row.entry}`);

        if (full.item)
        {
            equip(picking, full.item);
            $('#armory-picker').close();
        }
        else
        {
            pickerStatus(full.error || 'could not load that item');
        }
    })));
}

function showSource()
{
    for (const button of document.querySelectorAll('.picker-source'))
    {
        button.classList.toggle('is-on', button.dataset.source === source);
    }

    /* One box, two haystacks, so it says which one it is about to search. */
    $('#armory-picker-search').placeholder = source === 'custom'
        ? 'Search your saved items by name'
        : 'Search the database by name or entry';

    if (source === 'custom')
    {
        showCustom();
    }
    else
    {
        showDatabase();
    }
}

function openPicker(slot)
{
    /* A modal draws in the top layer, above anything a z-index can reach, so a tooltip left up
       would sit under the backdrop rather than closing itself. */
    hideHover();

    picking = slot;
    source = 'database';

    $('#armory-picker-title').textContent = slot;
    $('#armory-picker-search').value = '';
    pickerStatus('');
    $('#armory-picker').showModal();
    showSource();
    $('#armory-picker-search').focus();
}


/* ------------------------------------------------------------------------ racials */

/*
 * The racials of whichever race is picked, with their real icons and their real tooltips.
 *
 * Every one is listed, including the ones that change no number. Blood Fury, Shadowmeld and War
 * Stomp are as much a part of being an orc, a night elf or a tauren as the passives are, and a
 * panel that quietly dropped half of them would look broken rather than principled. The ones that
 * do nothing to the sheet say so instead.
 */
let racials = [];

async function loadRacials()
{
    const answer = await api(`/api/character/racials?race=${state.armoryRace}`);

    racials = answer.racials || [];
    drawRacials();
}

/** What an aura contribution reads as under the icon: "+5 expertise", "+5% intellect". */
function auraLine(one)
{
    const sign = one.value < 0 ? '' : '+';
    const name = STAT_WORDS[one.to] || one.to;

    return `${sign}${one.value}${one.percent ? '%' : ''} ${name}`;
}

function drawRacials()
{
    const host = $('#armory-racials');

    /*
     * Only the ones that move a number.
     *
     * Blood Fury, Shadowmeld, War Stomp and Arcane Torrent are abilities you press, and Hardiness
     * and Command are passives about things this sheet does not show - stun duration and pet
     * damage. Listing them made the panel longer without making it say more. What stays is what
     * the stat block is actually reading, and a weapon racial stays even when it is doing nothing,
     * greyed, because "you would have five expertise with an axe" is worth knowing.
     */
    const shown = racials.filter((racial) => racial.stats.length);

    if (!shown.length)
    {
        host.replaceChildren(el('p', 'hint', racials.length
            ? 'No stat changing racials.'
            : 'Point Astral at your client to read these.'));
        return;
    }

    host.replaceChildren(...shown.map((racial) =>
    {
        const row = el('div', 'racial');
        const icon = el('span', 'racial-icon');

        if (racial.icon)
        {
            icon.style.backgroundImage = `url("${iconUrl(racial.icon)}")`;
        }

        const text = el('span', 'racial-text');

        text.append(el('span', 'racial-name', racial.name));

        /*
         * Lit or grayed by whether it is doing anything. A weapon racial with no weapon in hand is
         * the case this is for: the orc's expertise is there, and it is worth nothing right now.
         */
        const live = racial.stats.filter((one) => conditionHolds(one));

        text.append(el('span', 'racial-effect', racial.stats.map(auraLine).join(', ')));

        if (!live.length)
        {
            row.classList.add('is-off');
        }

        row.append(icon, text);
        row.addEventListener('mouseenter', () => showRacialTooltip(row, racial));
        row.addEventListener('mouseleave', hideHover);

        return row;
    }));
}

/* ------------------------------------------------------------------- the socket tally */

/*
 * The order the colors are counted in, which is the order the game lists them in and the order
 * `SOCKETS` in tooltip.js is written in. Prismatic is last because it is the one you added
 * yourself rather than one the item came with.
 */
const SOCKET_ORDER = ['red', 'yellow', 'blue', 'meta', 'prismatic'];

/*
 * Every socket on everything worn, by color, less the ones that already hold a gem.
 *
 * Counted across the whole rack rather than per item, because what it is for is the question you
 * ask before going shopping: how many red gems do I still need. `gems` is a sparse array beside
 * `sockets`, so socket two being filled while one and three are open counts the way it looks.
 */
function emptySockets()
{
    const counts = new Map();

    for (const item of worn.values())
    {
        const gems = item.gems || [];

        (item.sockets || []).forEach((color, index) =>
        {
            if (!gems[index] && SOCKET_ORDER.includes(color))
            {
                counts.set(color, (counts.get(color) || 0) + 1);
            }
        });
    }

    return counts;
}

/** The box under the racials: one row per color that still has something open. */
function drawSockets()
{
    const host = $('#armory-sockets');
    const counts = emptySockets();
    const rows = SOCKET_ORDER.filter((color) => counts.get(color));

    if (!rows.length)
    {
        /* Two different nothings, and the box says which. Nothing worn has a socket at all is
           not the same as every socket being full, and only one of them is an achievement. */
        host.replaceChildren(el('p', 'hint',
            worn.size ? 'No empty sockets.' : 'Nothing worn has a socket.'));
        return;
    }

    const tally = el('div', 'socket-tally');

    tally.append(...rows.map((color) =>
    {
        const row = el('div', 'socket-tally-row');
        const art = el('span', 'socket-tally-art');

        art.style.backgroundImage = `url("ui/${M.SOCKETS[color].art}.png")`;
        art.title = M.SOCKETS[color].label;

        row.append(art, el('span', 'socket-tally-count', `x ${counts.get(color)}`));

        return row;
    }));

    host.replaceChildren(tally);
}

/** Whether a weapon condition is met by what is in the weapon slots right now. */
function conditionHolds(one)
{
    if (!one.condition)
    {
        return true;
    }

    for (const slot of weaponSlots())
    {
        const item = worn.get(slot);

        if (item && WEAPON_SUBCLASS[item.itemType] !== undefined
            && one.condition.itemClass === 2
            && (one.condition.subclassMask & (1 << WEAPON_SUBCLASS[item.itemType])))
        {
            return true;
        }
    }

    return false;
}

async function showRacialTooltip(node, racial)
{
    await ensureTooltipFont();

    if (!node.matches(':hover'))
    {
        return;
    }

    const lines = [
        { l: racial.name, lc: M.C.white, r: '', rc: M.C.gray, kind: 'title' },
        { l: '', kind: 'gap' },
        { l: racial.description || 'No description in the client.', lc: M.C.gold, r: '', rc: M.C.white, kind: 'body' }
    ];

    if (racial.stats.length && !racial.stats.every(conditionHolds))
    {
        lines.push({ l: '', kind: 'gap' });
        lines.push({ l: 'Requires appropriate weapon equipped.', lc: M.C.red, r: '', rc: M.C.white, kind: 'body' });
    }

    const canvas = R.renderTooltip(lines, {
        icon: null, iconPlacement: 'none', maxWidth: 300, transparent: false, borderColor: '#4a4a4a'
    }, 1);

    const host = hoverHost();

    host.replaceChildren(canvas);
    host.hidden = false;

    const box = node.getBoundingClientRect();
    const width = canvas.width / (window.devicePixelRatio || 1);
    const height = canvas.height / (window.devicePixelRatio || 1);

    host.style.left = `${Math.round(Math.min(box.right + 10, window.innerWidth - width - 8))}px`;
    host.style.top = `${Math.round(Math.max(8, Math.min(box.top, window.innerHeight - height - 8)))}px`;
}
/** The race list, and the classes that race can be, both straight out of the client. */
function fillPickers()
{
    const raceSelect = $('#armory-race');
    const classSelect = $('#armory-class');

    raceSelect.replaceChildren(...setup.races.map(
        (r) => option(r.id, r.name, r.id === state.armoryRace)));

    const race = setup.races.find((r) => r.id === state.armoryRace) || setup.races[0];

    state.armoryRace = race.id;
    raceSelect.value = String(race.id);

    /* A race cannot be a class the client does not pair it with, so the list is filtered rather
       than validated after the fact. */
    const allowed = setup.classes.filter((c) => race.classes.includes(c.id));

    if (!allowed.some((c) => c.id === state.armoryClass))
    {
        state.armoryClass = allowed[0].id;
    }

    classSelect.replaceChildren(...allowed.map(
        (c) => option(c.id, c.name, c.id === state.armoryClass)));

    classSelect.value = String(state.armoryClass);

    showWho();
    clampLevel();
}

/**
 * Who the character is, which is for the exported picture rather than for the numbers.
 *
 * The guild line is off by default and its field only appears when it is wanted, the same way the
 * target frame keeps its second bar hidden until a creature has one.
 */
function showWho()
{
    $('#armory-name').value = state.armoryName || '';
    $('#armory-guild').value = state.armoryGuild || '';
    $('#armory-guild-on').checked = !!state.armoryGuildShow;
    $('#armory-guild').hidden = !state.armoryGuildShow;
    $('#armory-all-stats').checked = !!state.armoryAllStats;
}

/**
 * The line over the slots that says what this character is.
 *
 * A readout rather than a picker: in Wrath the spec is whichever tree holds the most points, so
 * there is nothing to choose here and nothing that could disagree with the build.
 */
function showSpec()
{
    const talents = talentSummary();

    /* The three counts already say how many points are spent, so the total said it twice. How many
       are left is on the calculator's own header, which is where you are when it matters. */
    $('#armory-spec').textContent = talents.spent ? talents.spec : 'no talents spent';
}

/** Death knights start at 55, so the level field says so rather than answering with an error. */
function clampLevel()
{
    const floor = state.armoryClass === 6 ? 55 : 1;
    const input = $('#armory-level');

    input.min = String(floor);
    state.armoryLevel = Math.min(80, Math.max(floor, Number(state.armoryLevel) || 80));
    input.value = String(state.armoryLevel);
}

/** Where a stat lives: among the five primaries, among the five schools, or on the sheet itself. */
function lookup(sheet, key)
{
    if (sheet.stats[key] !== undefined)
    {
        return sheet.stats[key];
    }

    if (sheet.resistances[key] !== undefined)
    {
        return sheet.resistances[key];
    }

    return sheet[key];
}

/*
 * What one line reads as.
 *
 * A weapon slot answers with a whole hand rather than a number - a range, a swing, and nothing
 * to round - so the two lines it fills say which half of it they are quoting. Everything else is
 * one number, its places and its suffix.
 */
function read(entry, value)
{
    if (entry.part === 'damage')
    {
        return `${Math.round(value.min)} - ${Math.round(value.max)}`;
    }

    if (entry.part === 'speed')
    {
        return value.speed.toFixed(2);
    }

    return `${entry.places ? value.toFixed(entry.places) : Math.round(value)}${entry.suffix || ''}`;
}

/** One line, the way the game writes it: the stat, a colon, the number. */
function cell(entry, sheet)
{
    const value = lookup(sheet, entry.key);

    /* An empty off hand answers null and a stat this class has no line for answers undefined.
       Both read as the dash that says "not a thing here", which a zero does not. */
    const missing = value === undefined || value === null;

    const line = el('div', missing ? 'stat pending' : 'stat');

    line.append(el('span', 'stat-label', `${entry.label}:`));
    line.append(el('span', 'stat-value', missing ? '-' : read(entry, value)));

    return line;
}

/** The lines this class is read for, or all of them when the box below the sheet is ticked. */
function linesFor(cls, all)
{
    if (all)
    {
        return SHEET;
    }

    const tags = CLASS_STATS[cls] || Object.keys(CLASS_STATS);

    return SHEET.filter((entry) => tags.includes(entry.tag));
}

async function refresh()
{
    if (!setup)
    {
        return;
    }

    /* Equipped items travel whole. Half of what can be worn here has no entry to refer to - an
       invented piece that was never saved is the case this exists for. Each one carries the slot
       it is in as well, because a weapon's damage is a different line depending on which hand
       holds it, and the item on its own cannot say. */
    const sheet = await postJson('/api/character/sheet', {
        race: state.armoryRace,
        class: state.armoryClass,
        level: state.armoryLevel,
        items: [...worn].map(([slot, item]) => ({ ...item, armorySlot: slot })),
        talents: state.armoryTalents || {}
    });

    if (sheet.error)
    {
        $('#armory-stat-note').textContent = sheet.error;
        return;
    }

    /*
     * The five schools sit under the sheet rather than flowing into its columns. They are one
     * thought and they are short, so a row of five reads as the resistance line the game has,
     * where six wide columns would put Fire beside Resilience and carry Frost onto the next row.
     * Same box, same lines, one break.
     */
    const lines = linesFor(state.armoryClass, state.armoryAllStats);

    $('#armory-stat-grid').replaceChildren(
        ...lines.filter((entry) => entry.tag !== 'resist').map((entry) => cell(entry, sheet)));

    $('#armory-resist-grid').replaceChildren(
        ...lines.filter((entry) => entry.tag === 'resist').map((entry) => cell(entry, sheet)));

    /* What the sheet worked out about each slot's gems, for the tooltips to read. */
    gearState = sheet.gear || {};

    drawEquipped();
    drawSets();
    drawSockets();

    /* The line under the sheet is for what went wrong, and nothing did. */
    $('#armory-stat-note').textContent = '';
}

/**
 * What is on, slot by slot.
 *
 * Its own item level per row and no average anywhere: an average needs rules the client never had,
 * about which slots count and what an empty off hand is worth, and inventing them would put a
 * number on the panel that nothing can check. The item's own field needs inventing nothing.
 */

/* --------------------------------------------------------------------------- sets */

/*
 * The set block, counted from what is on rather than from what one piece claims.
 *
 * A single item's tooltip can only ever say "(0/5)", because an item does not know what else is
 * worn. Here everything is, so the count is real and a bonus lights up at its threshold the way the
 * game lights it.
 *
 * Grouped by set *name*, which is what makes a custom tier work: a piece you invented with the same
 * set name as another joins it and counts toward it, whether the others are yours or the
 * database's. Real sets get their name from `ItemSet.dbc`, so two tiers that look alike - the
 * Ymirjar Lord's Battlegear and the Ymirjar Lord's Plate - stay apart on their own names rather
 * than being merged by a family resemblance.
 */
function wornSets()
{
    const sets = new Map();

    for (const item of worn.values())
    {
        const name = (item.setName || '').trim();

        if (!name)
        {
            continue;
        }

        if (!sets.has(name))
        {
            sets.set(name, { name, worn: [], slots: [], pieces: [], roster: [], bonuses: [] });
        }

        const set = sets.get(name);

        set.worn.push(item.name || '(no name)');
        set.slots.push(item.slot || '');

        /*
         * The roster and the bonuses come off whichever piece carries them. A custom piece may
         * list neither, and then the set is as long as the pieces actually equipped.
         */
        if ((item.setPieces || []).length > set.pieces.length)
        {
            set.pieces = item.setPieces.filter(Boolean);
        }

        if ((item.setRoster || []).length > set.roster.length)
        {
            set.roster = item.setRoster;
        }

        if ((item.setBonuses || []).length > set.bonuses.length)
        {
            set.bonuses = item.setBonuses.filter((b) => b && b.text);
        }
    }

    return [...sets.values()];
}

/** A name reduced to its letters and numbers, so punctuation and case stop mattering. */
function plainName(value)
{
    return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Does a worn piece answer for a roster line?
 *
 * Either name containing the other, which is the shape the game's own upgrades take: Sanctified
 * Ymirjar Lord's Helmet over Ymirjar Lord's Helmet, and the same trick anyone inventing a tier
 * plays - a Consecrated Ebon Vindicator's Helmet belongs on the Ebon Vindicator's Helmet row.
 *
 * Both directions, because the roster is as likely to hold the longer name as the shorter one. It
 * is a containment rather than a word-by-word comparison so that the slot word carries it: Helm
 * and Helmet agree, and nothing in a set's own roster is close enough for that to reach the wrong
 * row.
 */
function namesAgree(a, b)
{
    return Boolean(a && b) && (a.includes(b) || b.includes(a));
}

/**
 * The worn piece that answers for one roster name, removed from the pool so it cannot answer twice.
 *
 * Exact first, then containment, longest before shortest. Without the ordering a Helm on the roster
 * could claim the Helmet that the Helmet row wanted, purely by being listed above it.
 */
function claimFor(pool, name)
{
    const wanted = plainName(name);
    const exact = pool.findIndex((one) => plainName(one) === wanted);

    const at = exact !== -1
        ? exact
        : pool
            .map((one, index) => ({ index, length: plainName(one).length }))
            .filter(({ index }) => namesAgree(plainName(pool[index]), wanted))
            .sort((x, y) => y.length - x.length)
            .map(({ index }) => index)[0];

    return at === undefined || at === -1 ? null : pool.splice(at, 1)[0];
}

/**
 * One set's roster as it should read, with each row lit or not.
 *
 * A row shows the piece you are *wearing* where you are wearing one, which is what the game does:
 * put a Sanctified Ymirjar Lord's Helmet on and the Ymirjar Lord's Helmet row becomes the
 * sanctified name. The slot is what joins them - the roster names the un-sanctified piece and the
 * heroic variants are in the set without being in its list, so names never match and slots always
 * do. A custom set has no slots on its roster, so there it goes by name instead, and the names it
 * is given are rarely the names on the roster: an invented tier is written the way the real ones
 * are, with a word on the front of the upgraded piece. So the rows are claimed by agreement rather
 * than by equality, one piece to one row.
 */
function rosterFor(set)
{
    if (!set.roster.length)
    {
        const names = set.pieces.length ? set.pieces : set.worn;
        const pool = [...set.worn];

        return names.map((name) =>
        {
            const claimed = claimFor(pool, name);

            return { name: claimed || name, on: Boolean(claimed) };
        });
    }

    const mine = [...worn.values()].filter((item) => (item.setName || '').trim() === set.name);

    return set.roster.map((piece) =>
    {
        const item = mine.find((one) => one.slot === piece.slot);

        return { name: (item && item.name) || piece.name, on: !!item };
    });
}

/**
 * How much of one item's set is on, for its tooltip.
 *
 * The tooltip cannot work this out for itself - it is drawing one item and knows nothing of the
 * other eighteen slots - so the count and the roster are handed to it already resolved.
 */
function setContext(item)
{
    const name = (item.setName || '').trim();
    const set = name ? wornSets().find((one) => one.name === name) : null;

    if (!set)
    {
        return {};
    }

    const roster = rosterFor(set);

    return {
        setWorn: set.worn.length,
        setPieces: roster.map((piece) => piece.name),
        setOn: roster.filter((piece) => piece.on).map((piece) => piece.name)
    };
}

function drawSets()
{
    const host = $('#armory-sets');
    const sets = wornSets();

    if (!sets.length)
    {
        host.replaceChildren(el('p', 'hint',
            'Equip two or more pieces of a set and its bonuses show here.'));
        return;
    }

    host.replaceChildren(...sets.map((set) =>
    {
        const box = el('div', 'set');
        const total = Math.max(set.pieces.length, set.worn.length);

        box.append(el('div', 'set-name', `${set.name} (${set.worn.length}/${total})`));

        /*
         * The roster, with what is on lit and the rest grey - the game's own arrangement. A set
         * whose pieces are not named lists what is worn instead of an empty block.
         */
        const list = el('div', 'set-pieces');

        for (const piece of rosterFor(set))
        {
            const line = el('div', 'set-piece', piece.name);

            if (piece.on)
            {
                line.classList.add('is-on');
            }

            list.append(line);
        }

        box.append(list);

        if (set.bonuses.length)
        {
            const bonuses = el('div', 'set-bonuses');

            for (const bonus of set.bonuses)
            {
                const line = el('div', 'set-bonus', `(${bonus.count}) Set: ${bonus.text}`);

                if (set.worn.length >= Number(bonus.count))
                {
                    line.classList.add('is-on');
                }

                bonuses.append(line);
            }

            box.append(bonuses);
        }

        return box;
    }));
}

/*
 * Forget where a slot's piece came from.
 *
 * A different item in the slot is a different question, so the field is asked again rather than
 * kept: leaving the last piece's boss under the new one would be wrong and quiet about it. An
 * absent key is what tells the filler to go and look; an empty string is a field someone cleared
 * on purpose, and that is left alone.
 */
function forgetSource(slot)
{
    if (sourceMap()[slot] !== undefined)
    {
        delete sourceMap()[slot];
    }
}

/*
 * Where this piece comes from: a line to read, with the field kept out of the way until it is
 * wanted.
 *
 * A real item arrives with it filled in by the loot walk. An invented one arrives empty, because a
 * piece you made up has an intended source and nothing else in the program knows it. Typing over an
 * autofilled line is the point of the thing rather than something to refuse.
 *
 * So a source that has something to say reads as a line of text, the same as the ones the walk
 * answered — a boss's name in a text box, with a box around it, announces that it is a form when
 * what it is is an answer. Modify puts the field back. Enter takes it away again, which is the
 * gesture people already make when they have finished typing into something.
 *
 * The two halves are swapped inside this cell rather than by redrawing the table. drawEquipped()
 * rebuilds every row and starts the loot walk over, which on Enter would throw away the focus and
 * blink the whole list for the sake of one cell.
 */
function sourceCell(slot)
{
    const cell = el('td', 'source-cell');

    /*
     * The open field's listeners, dropped the moment it is finished with.
     *
     * Enter has to take the field away, and taking away the focused element makes the browser fire
     * blur on the way out — which ran the collapse a second time, inside the first one, and threw
     * when the outer replaceChildren went looking for a child that the inner one had already
     * removed. Checking whether the node is still connected does not help: blur arrives while it
     * still is. Ending the session is the honest version of what is meant, so the handlers of a
     * field that is going away simply stop existing.
     */
    let session = null;

    const show = () =>
    {
        if (session)
        {
            session.abort();
            session = null;
        }

        const value = sourceMap()[slot] || '';

        /* Nothing to read yet, so there is nothing to collapse into: an empty source goes straight
           to the field, which is also what a piece you invented needs on the way in. */
        if (!value)
        {
            edit();
            return;
        }

        /* A wrapper rather than laying the cell out directly: a <td> told to be a flex container
           stops being a table cell, and the column widths go with it. */
        const wrap = el('div', 'source-row');
        const line = el('span', 'source-line', value);
        const modify = el('button', 'source-modify', 'Modify');

        modify.type = 'button';
        modify.title = 'Change where this piece comes from';
        modify.addEventListener('click', () => edit(true));

        wrap.append(line, modify);
        cell.replaceChildren(wrap);
    };

    const edit = (focus) =>
    {
        const box = el('input', 'source-input');
        const before = sourceMap()[slot] || '';

        session = new AbortController();

        const until = { signal: session.signal };

        box.type = 'text';
        box.value = before;
        box.placeholder = 'Where it comes from';

        box.addEventListener('input', () =>
        {
            sourceMap()[slot] = box.value;
        }, until);

        box.addEventListener('keydown', (event) =>
        {
            if (event.key === 'Enter')
            {
                /* The table sits in the page's form, and a bare Enter in a text input submits it. */
                event.preventDefault();
                show();
            }

            /* Escape is the way out of a change you did not mean to start. */
            if (event.key === 'Escape')
            {
                event.preventDefault();
                sourceMap()[slot] = before;
                show();
            }
        }, until);

        /* Clicking away is finishing too. Left open, the field is exactly the clutter collapsing
           it was meant to clear — and an empty one has nothing to collapse into, so it stays. */
        box.addEventListener('blur', () =>
        {
            if (sourceMap()[slot])
            {
                show();
            }
        }, until);

        cell.replaceChildren(box);

        if (focus)
        {
            box.focus();
            box.select();
        }
    };

    show();

    return cell;
}

/*
 * Fill the blanks in from the loot tables.
 *
 * Only for slots holding a real item that has not been asked about yet, so this settles after one
 * pass and the redraw at the end of it cannot loop: every slot it touches comes back with a key,
 * including the ones the walk had no answer for. A custom piece is never asked, having no entry to
 * ask with, and stays empty for its owner to write.
 */
async function fillSources()
{
    const asking = [...worn.entries()]
        .filter(([slot, item]) => item.entry && sourceMap()[slot] === undefined);

    if (!asking.length)
    {
        return;
    }

    const entries = [...new Set(asking.map(([, item]) => item.entry))];
    let answer = null;

    try
    {
        answer = await api(`/api/item/drops?entries=${entries.join(',')}`);
    }
    catch
    {
        answer = null;
    }

    /* No database is not a failure worth saying out loud here - the field is still yours to fill,
       and the slots stay unasked so connecting one later fills them in. */
    if (!answer || answer.error || !answer.drops)
    {
        return;
    }

    for (const [slot, item] of asking)
    {
        const found = answer.drops[item.entry];

        sourceMap()[slot] = found ? found.line : '';
    }

    drawEquipped();
}

function drawEquipped()
{
    const order = equippedOrder();

    /* A slot the order does not name goes to the end rather than to the front, which is where a
       -1 from indexOf would have put it. That is the relic a class change has not retuned yet:
       still worn, still worth showing, just not anywhere the list has an opinion about. Sorting is
       stable, so any of those keep the order they went on in. */
    const rank = (slot) =>
    {
        const at = order.indexOf(slot);

        return at === -1 ? order.length : at;
    };

    const rows = [...worn.entries()].sort(([a], [b]) => rank(a) - rank(b));

    if (!rows.length)
    {
        const note = el('td', 'hint', 'Nothing equipped. Click a slot to fill it.');
        const line = el('tr');

        note.colSpan = 4;
        line.append(note);
        $('#armory-equipped').replaceChildren(line);
        return;
    }

    $('#armory-equipped').replaceChildren(...rows.map(([slot, item]) =>
    {
        const line = el('tr');
        const name = el('td', '');
        const label = el('span', '', item.name || '(no name)');

        label.style.color = M.qualityColor(item.quality);

        /* The entry moves in beside the name now that the fourth column is the source field.
           A piece with no entry says nothing: "custom" was a label on the only rows that had no
           number to show, and next to a name you typed yourself it was never news. */
        if (item.entry)
        {
            name.append(label, el('span', 'hint', ` #${item.entry}`));
        }
        else
        {
            name.append(label);
        }

        line.append(
            name,
            el('td', '', item.itemLevel ? String(item.itemLevel) : '-'),
            el('td', '', slot),
            sourceCell(slot));

        return line;
    }));

    fillSources();
}


/**
 * Called at start-up, and again whenever the client folder changes underneath us.
 *
 * The pickers are rebuilt every time; the handlers are bound once, since binding them twice would
 * run every change through the whole refresh two deep.
 */
async function initArmory()
{
    loadWorn();
    drawSlots();
    drawEquipped();
    drawSets();
    drawSockets();

    try
    {
        setup = await api('/api/character/setup');
    }
    catch
    {
        setup = null;
    }

    if (!setup || setup.error)
    {
        $('#armory-stat-note').textContent = setup && setup.error
            ? setup.error
            : 'Point Astral at your 3.3.5a folder in Settings to fill this in.';
        setup = null;
        return;
    }

    fillPickers();
    drawSlots();
    showSpec();
    await loadRacials();
    await refresh();

    if (bound)
    {
        return;
    }

    bound = true;

    for (const button of document.querySelectorAll('.picker-source'))
    {
        button.addEventListener('click', () =>
        {
            source = button.dataset.source;
            showSource();
        });
    }

    /* Debounced the way the item and NPC searches are, so typing a name is one query rather than
       one per keystroke. */
    $('#armory-picker-search').addEventListener('input', () =>
    {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(showSource, 250);
    });

    /* The gem search goes to the database, so it is debounced the same way. */
    $('#gem-picker-search').addEventListener('input', () =>
    {
        clearTimeout(gemTimer);
        gemTimer = setTimeout(showGems, 250);
    });

    $('#gem-picker-clear').addEventListener('click', () =>
    {
        setGem(gemming.slot, gemming.index, null);
        $('#gem-picker').close();
    });

    /* The enchant list is already in hand, so its box filters rather than searches. */
    $('#enchant-picker-search').addEventListener('input', drawEnchants);

    $('#enchant-picker-clear').addEventListener('click', () =>
    {
        setEnchant(enchanting, null);
        $('#enchant-picker').close();
    });

    $('#armory-race').addEventListener('change', (e) =>
    {
        state.armoryRace = Number(e.target.value);
        fillPickers();
        drawSlots();
        loadRacials();
        refresh();
    });

    $('#armory-class').addEventListener('change', (e) =>
    {
        state.armoryClass = Number(e.target.value);

        /* A build is a set of talent ids belonging to one class, so it does not survive a change
           of class - keeping it would leave points spent in trees that are no longer on screen. */
        clearTalents();
        drawSlots();
        showWho();
        clampLevel();
        showSpec();
        refresh();
    });

    $('#btn-talents').addEventListener('click', () => openTalents(state.armoryClass, showSpec));

    /*
     * The sheet is recomputed when the calculator closes rather than on every point.
     *
     * Spending a point is a click and the window sits over the sheet while it happens, so posting
     * a character per click would be twenty requests nobody is looking at. The spec line above the
     * slots does update live, because that is inside the window.
     */
    $('#talent-dialog').addEventListener('close', () =>
    {
        showSpec();
        refresh();
    });

    $('#armory-all-stats').addEventListener('change', (e) =>
    {
        state.armoryAllStats = e.target.checked;
        refresh();
    });

    $('#armory-name').addEventListener('input', (e) =>
    {
        state.armoryName = e.target.value;
    });

    $('#armory-guild').addEventListener('input', (e) =>
    {
        state.armoryGuild = e.target.value;
    });

    $('#armory-guild-on').addEventListener('change', (e) =>
    {
        state.armoryGuildShow = e.target.checked;
        $('#armory-guild').hidden = !e.target.checked;
    });

    $('#armory-level').addEventListener('change', (e) =>
    {
        state.armoryLevel = Number(e.target.value);
        clampLevel();
        refresh();
    });
}

export { initArmory };
