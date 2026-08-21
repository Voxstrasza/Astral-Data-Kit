'use strict';

/* The editor's state: its shape, the values loaded alongside it, and permalink encoding. */

function defaultState()
{
    return {
        kind: 'home',
        // The same placeholder the game uses for an unknown item or spell.
        icon: 'inv_misc_questionmark',

        name: '',
        quality: 4,
        heroic: false,
        conjured: false,
        binding: 'bop',
        unique: 'none',
        uniqueN: 1,

        slot: '',
        itemType: '',
        hasWeapon: false,
        dmgMin: 0,
        dmgMax: 0,
        speed: 0,
        armor: 0,
        block: 0,
        durability: 0,
        reqLevel: 80,
        itemLevel: 0,

        stats: [],
        resistances: [],
        sockets: [],
        socketBonus: '',
        requires: [],
        effects: [],

        setName: '',
        setPieces: [],
        setBonuses: [],

        flavor: '',
        madeBy: '',
        sellGold: 0,
        sellSilver: 0,
        sellCopper: 0,

        spellIcon: 'inv_misc_questionmark',
        spellName: '',
        rank: '',
        cost: '',
        range: '',
        castTime: '',
        cooldown: '',
        reagents: '',
        spellRequires: '',
        description: '',
        spellFlavor: '',

        unitName: '',
        unitLevel: 80,
        unitSkull: false,
        unitClassification: 'normal',
        unitReaction: 'hostile',
        unitHealth: 100000,
        unitHealthMax: 100000,
        unitShowHealthText: true,
        // Most creatures show no second bar, so none is the honest default; loading an NPC
        // with a real mana pool turns it on.
        unitPower: 'none',
        unitPowerCur: 20000,
        unitPowerMax: 20000,
        unitDisplayId: 0,

        /*
         * Custom difficulty scaling. unitScalePct is the total applied so far; unitScaleBase is
         * the pool it started from, kept so Reset restores the real numbers rather than dividing
         * back out and landing a few points off.
         */
        unitScalePct: 0,
        unitScaleBase: null,

        /* The same again for mana, tracked separately so the two bars scale independently. */
        unitPowerScalePct: 0,
        unitPowerScaleBase: null,

        /*
         * Achievements. The icon is held apart from the item and spell ones for the same reason
         * those are held apart from each other: the editors share one state object, and picking
         * an icon for an achievement must not change the item in the next tab.
         */
        /*
         * The aura a spell leaves behind, which the game tooltips separately from the spell — see
         * buildBuffLines. Off by default: most spells are worth showing on their own.
         */
        buffShow: false,
        buffName: '',
        buffDescription: '',
        buffRemaining: '',

        /*
         * A creature's script: who speaks, how, and what they say, in the order it happens. A
         * list rather than one line, because a fight is a conversation — two bosses trading
         * lines, or one boss answered by a raid leader.
         */
        textLines: [],

        achIcon: 'achievement_boss_lichking',
        achTitle: '',
        achDescription: '',
        achReward: '',
        achPoints: 10,
        /* Earned draws the coloured parchment and shield; unearned draws the desaturated pair. */
        achEarned: true,
        achCriteria: [],
        /*
         * Which category it is filed under. This does not appear on the card, but it is what the
         * multi-achievement panel will lay its tree out from, and loading a real achievement
         * should not throw the answer away. 92 is General, the first heading in game.
         */
        achCategory: 92,

        /*
         * Preview and export options, kept per mode.
         *
         * They used to be single values, which meant ticking "transparent background" while
         * building a target frame silently changed how your items exported. They describe how you
         * are looking at one kind of thing, so each kind gets its own set.
         */
        view: {
            item: { transparent: false, checker: true, iconPlacement: 'outside', maxWidth: 300, zoom: 1.5, exportScale: 2, qualityBorder: true },
            spell: { transparent: false, checker: true, iconPlacement: 'outside', maxWidth: 300, zoom: 1.5, exportScale: 2, qualityBorder: false },
            unit: { transparent: false, checker: true, iconPlacement: 'outside', maxWidth: 300, zoom: 1.5, exportScale: 2, qualityBorder: false },
            /*
             * The achievement card is a fixed 434x142 — AchievementTemplate's own size — so
             * maxWidth, icon placement and the quality border have nothing to act on here. They
             * are still carried so view() returns one shape for every mode.
             */
            achievement: { transparent: false, checker: true, iconPlacement: 'outside', maxWidth: 300, zoom: 1.5, exportScale: 2, qualityBorder: false },

            /*
             * A chat log is wider than a tooltip — a yell runs to a sentence or two — so it opens
             * at 420px rather than the tooltip's 300.
             */
            text: { transparent: false, checker: true, iconPlacement: 'outside', maxWidth: 420, zoom: 1.5, exportScale: 2, qualityBorder: false }
        }
    };
}

let state = defaultState();

/*
 * The modes that actually draw something. Home and the Raid Wizard are pages rather than
 * editors, so the preview column and its export controls have nothing to show for them.
 */
const CANVAS_KINDS = ['item', 'spell', 'unit', 'achievement', 'text'];

/*
 * Which fields belong to which mode.
 *
 * The three editors share one state object, so clearing the target frame must not throw away the
 * item in the next tab. Written out rather than derived from a prefix, because the item fields
 * have no common prefix to derive from.
 */
const FIELDS_BY_KIND = {
    item: [
        'icon', 'name', 'quality', 'heroic', 'conjured', 'binding', 'unique', 'uniqueN',
        'slot', 'itemType', 'hasWeapon', 'dmgMin', 'dmgMax', 'speed', 'armor', 'block',
        'durability', 'reqLevel', 'itemLevel', 'stats', 'resistances', 'sockets', 'socketBonus',
        'requires', 'effects', 'setName', 'setPieces', 'setBonuses', 'flavor', 'madeBy',
        'sellGold', 'sellSilver', 'sellCopper'
    ],
    spell: [
        'spellIcon', 'spellName', 'rank', 'cost', 'range', 'castTime', 'cooldown', 'reagents',
        'spellRequires', 'description', 'spellFlavor',
        'buffShow', 'buffName', 'buffDescription', 'buffRemaining'
    ],
    unit: [
        'unitName', 'unitLevel', 'unitSkull', 'unitClassification', 'unitReaction', 'unitHealth',
        'unitHealthMax', 'unitShowHealthText', 'unitPower', 'unitPowerCur', 'unitPowerMax',
        'unitDisplayId', 'unitScalePct', 'unitScaleBase', 'unitPowerScalePct', 'unitPowerScaleBase'
    ],
    achievement: [
        'achIcon', 'achTitle', 'achDescription', 'achReward', 'achPoints', 'achEarned',
        'achCriteria', 'achCategory'
    ],
    text: ['textLines']
};

/**
 * Puts one mode's fields back to their defaults, leaving the other two alone.
 *
 * defaultState() is rebuilt on each call, so the arrays copied out of it are fresh — handing the
 * same array to two states would have them share a stat list.
 */
function resetKind(kind)
{
    const fresh = defaultState();

    for (const key of FIELDS_BY_KIND[kind] || [])
    {
        state[key] = fresh[key];
    }

    if (state.view && fresh.view[kind])
    {
        state.view[kind] = fresh.view[kind];
    }
}

/**
 * The view options for whichever mode is showing.
 *
 * Falls back to the item set for a permalink made before these were split per mode, so an old
 * link still opens instead of throwing on a missing object.
 */
function view()
{
    if (!state.view)
    {
        state.view = defaultState().view;
    }

    return state.view[state.kind] || state.view.item;
}

/** Swaps the whole state object. Importers read `state` as a live binding and see the new one. */
function setState(next)
{
    state = next;
}

/*
 * Everything loaded alongside the state, held on one mutable object rather than as separate
 * `let`s. An imported binding cannot be assigned from the importing module, so as bare
 * variables each of these would need its own setter for whichever module produces it.
 */
const runtime = {
    iconImage: null,
    iconNames: [],
    customIcons: [],
    customFolders: [''],
    iconNativeSize: 64,
    clientStatus: { ready: false },
    /* A portrait captured from the 3D model viewer, which overrides the chosen icon when set. */
    portraitImage: null
};

/* --------------------------------------------------------------- permalinks */

function encodeState(value)
{
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    let binary = '';

    for (const byte of bytes)
    {
        binary += String.fromCharCode(byte);
    }

    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeState(text)
{
    const padded = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));

    return JSON.parse(new TextDecoder().decode(bytes));
}

/* ------------------------------------------------------------- green effects */

/** An effect row stores its preset + number; the rendered sentence is derived from them. */
function effectText(effect)
{
    if (effect.preset === 'custom')
    {
        return effect.text || '';
    }

    return (effect.preset || '').replace('{N}', effect.value === '' ? '0' : effect.value);
}

export {
    defaultState, state, setState, runtime, view, resetKind, FIELDS_BY_KIND, CANVAS_KINDS,
    encodeState, decodeState, effectText
};
