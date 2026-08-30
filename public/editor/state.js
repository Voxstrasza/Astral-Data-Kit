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

        /* Armor over what the slot and the armor class already give: a cloak's, a ring's, the extra
           on a tanking piece. It prints green rather than white, and that is the whole difference
           between the two - the number is armor either way. */
        armorBonus: false,
        block: 0,
        durability: 0,
        reqLevel: 80,

        /* Whether the level line is printed. On by default; a reputation item comes in with it
           off, since the standing is the requirement worth reading there. */
        reqLevelShow: true,
        itemLevel: 0,

        stats: [],
        resistances: [],
        sockets: [],
        socketBonus: '',
        requires: [],
        effects: [],

        setName: '',
        setPieces: [],

        /* The same roster with a slot on each piece, so the Armory can tell which of them are on:
           a heroic variant is in the set under a different name and only the slot lines up. */
        setRoster: [],
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

        /*
         * The Armory. Human warrior at 80 is the default because it is the combination every
         * client has and the one whose numbers are easiest to check against a real character.
         */
        armoryRace: 1,
        armoryClass: 1,
        armoryLevel: 80,

        /*
         * Who the character is, for the exported picture rather than for the numbers. There is no
         * spec field: in Wrath the spec is wherever the talent points went, so the calculator owns
         * it and nothing here needs to hold a second opinion.
         */
        armoryName: '',
        armoryGuild: '',
        armoryGuildShow: false,

        /*
         * Off by default: the sheet shows what the class is read for. On when you are checking
         * something odd, which in a program about inventing items does happen.
         */
        armoryAllStats: false,

        /* Talent id -> points in it. Empty until the calculator is opened. */
        armoryTalents: {},

        /*
         * Where each equipped piece comes from, by slot.
         *
         * On the character rather than on the item, deliberately: the same invented chest can be
         * "Yogg-Saron 25 heroic" in one set and something else in another, and an item saved once
         * has no business carrying one set's story. A slot with no key here has not been asked
         * yet and gets filled in from the loot tables; a slot with an empty string was cleared on
         * purpose and stays cleared.
         */
        armorySources: {},

        /*
         * What is equipped, by slot.
         *
         * Whole items rather than references, the same reason the sheet request sends them whole:
         * half of what can be worn here is something you invented and has no entry to refer back
         * to. It lives in state rather than in the panel so that a saved character keeps its gear
         * - without it, saving one kept the race, the level and the talents and quietly dropped
         * everything it was wearing.
         */
        armoryWorn: {},

        achIcon: 'achievement_boss_lichking',
        achTitle: '',
        achDescription: '',
        achReward: '',
        achPoints: 10,
        /* Earned draws the colored parchment and shield; unearned draws the desaturated pair. */
        achEarned: true,
        achCriteria: [],

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
        'slot', 'itemType', 'hasWeapon', 'dmgMin', 'dmgMax', 'speed', 'armor', 'armorBonus', 'block',
        'durability', 'reqLevel', 'reqLevelShow', 'itemLevel', 'stats', 'resistances', 'sockets', 'socketBonus',
        'requires', 'effects', 'setName', 'setPieces', 'setRoster', 'setBonuses', 'flavor', 'madeBy',
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
        'achIcon', 'achTitle', 'achDescription', 'achReward', 'achPoints', 'achEarned', 'achCriteria'
    ],
    text: ['textLines'],
    armory: [
        'armoryRace', 'armoryClass', 'armoryLevel',
        'armoryName', 'armoryGuild', 'armoryGuildShow', 'armoryAllStats', 'armoryTalents',
        'armorySources', 'armoryWorn'
    ]
};

/**
 * The captured portrait as a PNG, or empty when there is none.
 *
 * Stored at 200 pixels square rather than at capture size: the frame draws it into a ring about a
 * quarter of that across, and a raid with a dozen creatures in it should not carry a dozen
 * full-size screenshots around.
 */
function portraitDataUrl()
{
    const image = runtime.portraitImage;

    if (!image)
    {
        return '';
    }

    try
    {
        const size = 200;
        const canvas = document.createElement('canvas');

        canvas.width = size;
        canvas.height = size;
        canvas.getContext('2d').drawImage(image, 0, 0, size, size);

        return canvas.toDataURL('image/png');
    }
    catch
    {
        /* A tainted canvas would throw; a frame without its portrait is better than no frame. */
        return '';
    }
}

/**
 * One window's fields, lifted off the editor as it stands.
 *
 * This lives here rather than in the panels that call it because it is FIELDS_BY_KIND read back
 * out — three panels each grew their own copy, and they had already drifted over which kinds carry
 * an icon.
 */
function fieldsOf(kind)
{
    const fields = {};

    for (const field of FIELDS_BY_KIND[kind] || [])
    {
        fields[field] = state[field];
    }

    /* A frame's icon is the picker's, not one of the unit fields, so it is taken separately. */
    if (kind === 'unit')
    {
        fields.icon = state.icon;

        /* And the portrait is a capture rather than a field. */
        fields.portrait = portraitDataUrl();
    }

    return fields;
}

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
    fieldsOf, portraitDataUrl, encodeState, decodeState, effectText
};
