'use strict';

/*
 * The tooltip "compiler": turns the editor state into a flat list of lines.
 *
 * Everything downstream — the live DOM preview and the PNG exporter — consumes this same list,
 * so the exported image can never drift from what you see on screen. A line is:
 *
 *   { l, r, lc, rc, kind }
 *
 * `l`/`r` are the left and right column text (WotLK pairs them: "Two-Hand" ... "Axe"),
 * `lc`/`rc` their colors, and `kind` drives font/spacing: title | body | flavor | gap | socket.
 */

const QUALITY = [
    { id: 0, name: 'Poor', color: '#9d9d9d' },
    { id: 1, name: 'Common', color: '#ffffff' },
    { id: 2, name: 'Uncommon', color: '#1eff00' },
    { id: 3, name: 'Rare', color: '#0070dd' },
    { id: 4, name: 'Epic', color: '#a335ee' },
    { id: 5, name: 'Legendary', color: '#ff8000' },
    { id: 6, name: 'Artifact', color: '#e6cc80' }
    /*
     * Heirloom is deliberately not offered, even though heirloom items are 3.3.5a content — 62 of
     * them sit in item_template at Quality 7.
     *
     * The Blizzard blue everyone pictures for heirlooms arrived in Legion, to stop them being
     * confused with the artifacts introduced in that same expansion. In Wrath an heirloom draws in
     * the same light gold as an Artifact, so picking Artifact already produces the right tooltip
     * and a separate entry would only be a second name for one color.
     *
     * The client says as much twice over: GlobalStrings.lua defines ITEM_QUALITY7_DESC =
     * "Heirloom", so the tier exists, while UIParent.lua builds ITEM_QUALITY_COLORS with
     * `for i = -1, 6` — the table stops short of 7, because there was no separate color for it.
     */
];

/** The quality that was dropped above, kept so an older permalink still renders as it did. */
const HEIRLOOM_QUALITY = 7;

const C = {
    white: '#ffffff',
    green: '#1eff00',
    gold: '#ffd100',
    gray: '#9d9d9d',
    red: '#ff2020',
    socketEmpty: '#808080'
};

/*
 * `art` names a PNG in public/ui extracted from the 3.3.5a client. Prismatic reuses the generic
 * empty-socket texture because the client of that era ships no dedicated prismatic art — the
 * game itself falls back the same way.
 */
const SOCKETS = {
    red: { label: 'Red Socket', color: '#ff3d3d', art: 'socket-red' },
    yellow: { label: 'Yellow Socket', color: '#ffd100', art: 'socket-yellow' },
    blue: { label: 'Blue Socket', color: '#3d7dff', art: 'socket-blue' },
    meta: { label: 'Meta Socket', color: '#c0c0c0', art: 'socket-meta' },
    prismatic: { label: 'Prismatic Socket', color: '#dda0dd', art: 'socket-generic' }
};

const STAT_TYPES = ['Strength', 'Agility', 'Stamina', 'Intellect', 'Spirit'];

const RESISTANCES = ['Arcane', 'Fire', 'Nature', 'Frost', 'Shadow'];

/*
 * The exact WotLK phrasings for "Equip:" lines. guildforging makes you type these by hand and
 * get the wording subtly wrong; picking from the real strings keeps tooltips believable.
 * {N} is substituted with the value the user types.
 */
const EQUIP_PRESETS = [
    'Increases your armor penetration rating by {N}.',
    'Improves critical strike rating by {N}.',
    'Improves haste rating by {N}.',
    'Improves hit rating by {N}.',
    'Increases attack power by {N}.',
    'Increases ranged attack power by {N}.',
    'Increases spell power by {N}.',
    'Increases your spell penetration by {N}.',
    'Improves your resilience rating by {N}.',
    'Increases your expertise rating by {N}.',
    'Increases defense rating by {N}.',
    'Increases your dodge rating by {N}.',
    'Increases your parry rating by {N}.',
    'Improves your block rating by {N}.',
    'Increases your shield block value by {N}.',
    'Restores {N} mana per 5 sec.',
    'Restores {N} health per 5 sec.'
    // No mastery: that rating arrived in Cataclysm, and this tool targets 3.3.5a only.
];

const SLOTS = [
    '', 'Head', 'Neck', 'Shoulder', 'Back', 'Chest', 'Shirt', 'Tabard', 'Wrist',
    'Hands', 'Waist', 'Legs', 'Feet', 'Finger', 'Trinket', 'Main Hand', 'Off Hand',
    'One-Hand', 'Two-Hand', 'Held In Off-hand', 'Ranged', 'Relic', 'Thrown', 'Projectile', 'Bag'
];

const ITEM_TYPES = [
    '', 'Cloth', 'Leather', 'Mail', 'Plate', 'Shield', 'Miscellaneous',
    'Axe', 'Mace', 'Sword', 'Dagger', 'Fist Weapon', 'Polearm', 'Staff', 'Wand',
    'Bow', 'Gun', 'Crossbow', 'Idol', 'Libram', 'Totem', 'Sigil'
];

/*
 * Which Type values each slot can actually take, and what the field is called when it does.
 *
 * In game the second line of an item tooltip is the slot on the left and its subclass on the
 * right, and the subclass is never free-form: a chest is one of the four armor classes, a main
 * hand is one of the melee weapon types, a relic is one of the four class relics. Offering all
 * twenty-two types for every slot lets you build a Plate Dagger.
 *
 * Slots that show no subclass at all in 3.3.5a map to an empty list and hide the field — a cloak
 * shows "Back" and its armor value with no armor class beside it, and the same goes for necks,
 * rings, trinkets, shirts, tabards and bags.
 */
const ARMOR_TYPES = ['Cloth', 'Leather', 'Mail', 'Plate'];
const MELEE_TYPES = ['Axe', 'Mace', 'Sword', 'Dagger', 'Fist Weapon', 'Polearm', 'Staff'];

const SLOT_TYPES = {
    Head: { label: 'Armor type', options: ARMOR_TYPES },
    Shoulder: { label: 'Armor type', options: ARMOR_TYPES },
    Chest: { label: 'Armor type', options: ARMOR_TYPES },
    Wrist: { label: 'Armor type', options: ARMOR_TYPES },
    Hands: { label: 'Armor type', options: ARMOR_TYPES },
    Waist: { label: 'Armor type', options: ARMOR_TYPES },
    Legs: { label: 'Armor type', options: ARMOR_TYPES },
    Feet: { label: 'Armor type', options: ARMOR_TYPES },

    'Main Hand': { label: 'Weapon type', options: MELEE_TYPES },
    'One-Hand': { label: 'Weapon type', options: MELEE_TYPES },
    'Two-Hand': { label: 'Weapon type', options: MELEE_TYPES },
    // A shield or a one-handed weapon can both sit here, so the list carries both.
    'Off Hand': { label: 'Off-hand type', options: ['Shield', ...MELEE_TYPES] },
    'Held In Off-hand': { label: 'Type', options: ['Miscellaneous'] },

    Ranged: { label: 'Ranged type', options: ['Bow', 'Gun', 'Crossbow', 'Wand'] },
    Thrown: { label: 'Ranged type', options: ['Thrown'] },
    Relic: { label: 'Relic type', options: ['Idol', 'Libram', 'Totem', 'Sigil'] },

    Back: { label: 'Type', options: [] },
    Neck: { label: 'Type', options: [] },
    Finger: { label: 'Type', options: [] },
    Trinket: { label: 'Type', options: [] },
    Shirt: { label: 'Type', options: [] },
    Tabard: { label: 'Type', options: [] },
    Projectile: { label: 'Type', options: [] },
    Bag: { label: 'Type', options: [] }
};

/** With no slot chosen, nothing is ruled out yet. */
const ANY_TYPE = { label: 'Type', options: ITEM_TYPES.filter(Boolean) };

/** Slots whose items carry weapon damage, so the damage fields can offer themselves. */
const WEAPON_SLOTS = ['Main Hand', 'One-Hand', 'Two-Hand', 'Off Hand', 'Ranged', 'Thrown'];

function typesForSlot(slot)
{
    return SLOT_TYPES[slot] || ANY_TYPE;
}

const BINDINGS = {
    none: '',
    bop: 'Binds when picked up',
    boe: 'Binds when equipped',
    bou: 'Binds when used',
    // ITEM_BIND_TO_ACCOUNT in the client's GlobalStrings.lua — heirlooms carry this line.
    boa: 'Binds to account',
    quest: 'Quest Item'
};

/**
 * Money is a run of number + coin-icon pairs rather than plain text, so the renderer can draw the
 * real gold/silver/copper art. Only non-zero denominations show, largest first — as in game.
 */
function formatMoney(gold, silver, copper)
{
    const parts = [];

    if (gold > 0)
    {
        parts.push({ amount: gold, coin: 'coin-gold' });
    }

    if (silver > 0)
    {
        parts.push({ amount: silver, coin: 'coin-silver' });
    }

    if (copper > 0)
    {
        parts.push({ amount: copper, coin: 'coin-copper' });
    }

    return parts;
}

/**
 * The enrage timer as it is written on a sheet: "Enrage: 10 minutes, 30 seconds".
 *
 * A flat ten minutes is spoken as ten minutes, so a zero is left out rather than printed - and the
 * two fields are added up before being split again, which is what makes "90 seconds" read as one
 * minute thirty instead of being reported back as typed.
 *
 * The icon is the game's own enrage art, named here so the sheet and anything else drawing this
 * line agree on it.
 */
const ENRAGE_ICON = 'spell_shadow_unholyfrenzy';

function enrageLabel(enrage)
{
    const whole = (value) => Math.max(0, Math.floor(Number(value) || 0));
    const total = whole((enrage || {}).minutes) * 60 + whole((enrage || {}).seconds);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    const parts = [];

    if (minutes)
    {
        parts.push(`${minutes} minute${minutes === 1 ? '' : 's'}`);
    }

    if (seconds)
    {
        parts.push(`${seconds} second${seconds === 1 ? '' : 's'}`);
    }

    return `Enrage: ${parts.join(', ') || 'no time set'}`;
}

/**
 * The rank as it appears beside a spell's name.
 *
 * The field takes a bare number and this adds the word, so "4" reads "Rank 4". It also passes
 * anything already worded straight through, which covers two cases that would otherwise read
 * badly: someone typing "Rank 4" by hand and getting "Rank Rank 4", and the client's own subtexts,
 * which are not all ranks — Spell.dbc puts "Passive", "Racial" and summon names in the same field.
 */
function rankLabel(rank)
{
    const value = String(rank ?? '').trim();

    if (!value)
    {
        return '';
    }

    return /^\d+$/.test(value) ? `Rank ${value}` : value;
}

function qualityColor(id)
{
    // A permalink made before Heirloom was dropped still opens, in the gold it always drew in.
    if (Number(id) === HEIRLOOM_QUALITY)
    {
        return QUALITY[6].color;
    }

    return (QUALITY[id] || QUALITY[1]).color;
}

/** A stat line reads "+100 Strength", or "-20 Strength" for a penalty. */
function formatStat(stat)
{
    const value = Number(stat.value) || 0;
    return `${value >= 0 ? '+' : ''}${value} ${stat.type}`;
}

function buildItemLines(s)
{
    const lines = [];
    const push = (line) => lines.push(line);
    const body = (l, lc = C.white, r = '', rc = C.white) => push({ l, r, lc, rc, kind: 'body' });

    push({ l: s.name || 'Item Name', lc: qualityColor(s.quality), kind: 'title' });

    // The user's headline gap: heroic raid gear tags in green directly under the name.
    if (s.heroic)
    {
        body('Heroic', C.green);
    }

    if (s.conjured)
    {
        body('Conjured Item');
    }

    if (BINDINGS[s.binding])
    {
        body(BINDINGS[s.binding]);
    }

    if (s.unique === 'unique')
    {
        body('Unique');
    }
    else if (s.unique === 'unique-equipped')
    {
        body('Unique-Equipped');
    }
    else if (s.unique === 'unique-n')
    {
        body(`Unique (${Number(s.uniqueN) || 1})`);
    }

    // Slot on the left, armor/weapon type on the right — WotLK's two-column row.
    if (s.slot || s.itemType)
    {
        body(s.slot || '', C.white, s.itemType || '', C.white);
    }

    if (s.hasWeapon)
    {
        const min = Number(s.dmgMin) || 0;
        const max = Number(s.dmgMax) || 0;
        const speed = Number(s.speed) || 0;

        body(`${min} - ${max} Damage`, C.white, speed ? `Speed ${speed.toFixed(2)}` : '', C.white);

        if (speed > 0)
        {
            const dps = (min + max) / 2 / speed;
            body(`(${dps.toFixed(1)} damage per second)`);
        }
    }

    if (Number(s.armor) > 0)
    {
        /* The same line either way, green when it is bonus armor. The colour is the whole signal -
           armor a cloak or a ring carries over what its slot already gives is still just armor, and
           a sign in front of the number would be saying it twice. */
        body(`${Number(s.armor)} Armor`, s.armorBonus ? C.green : C.white);
    }

    if (Number(s.block) > 0)
    {
        body(`${Number(s.block)} Block`);
    }

    for (const stat of s.stats || [])
    {
        if (stat.type && stat.value !== '')
        {
            body(formatStat(stat));
        }
    }

    for (const res of s.resistances || [])
    {
        if (res.type && Number(res.value))
        {
            body(`+${Number(res.value)} ${res.type} Resistance`);
        }
    }

    /*
     * The enchant, in the game's own green, between the stats and the sockets.
     *
     * That position is the game's rather than a choice: an enchant reads as part of what the item
     * gives you and sits with the stat lines, and the sockets are the block underneath.
     */
    if (s.enchant && (s.enchant.text || s.enchant.name))
    {
        body(s.enchant.text || s.enchant.name, C.green);
    }

    /*
     * The sockets, each reading either its own empty label or the gem sitting in it.
     *
     * A filled socket is white and says what the gem does rather than what color the hole is,
     * which is what the game shows once something is in there. A meta gem whose requirement is
     * not met goes gray and says so on the next line: it is socketed and it is doing nothing.
     */
    (s.sockets || []).forEach((socket, index) =>
    {
        const def = SOCKETS[socket];

        if (!def)
        {
            return;
        }

        const gem = (s.gems || [])[index];

        if (!gem)
        {
            push({ l: def.label, lc: C.socketEmpty, kind: 'socket', socket });
            return;
        }

        const lit = gem.active !== false;

        push({
            l: gem.text || gem.name,
            lc: lit ? C.white : C.socketEmpty,
            kind: 'socket',
            socket,
            gemIcon: gem.icon
        });

        if (!lit && gem.requiresText)
        {
            body(gem.requiresText, C.red);
        }
    });

    if (s.socketBonus)
    {
        /*
         * Green once it is earned and gray until then, which is the rule everyone knows and
         * nobody writes down: every socket filled and every gem a color its socket takes. The
         * panel works that out over the whole item and says so here.
         */
        body(`Socket Bonus: ${s.socketBonus}`, s.socketBonusMet ? C.green : C.socketEmpty);
    }

    if (Number(s.durability) > 0)
    {
        body(`Durability ${Number(s.durability)} / ${Number(s.durability)}`);
    }

    /*
     * Requirements, which is where the class and reputation lines land too.
     *
     * The game prints all of these in the same block between durability and the level requirement:
     * "Classes: Warrior", "Requires Revered with The Ashen Verdict", "Requires Revered with the
     * Ashen Verdict". They are one editable list rather than three fields, so a loaded item and an
     * invented one produce the same thing and either can be corrected by hand.
     */
    for (const req of s.requires || [])
    {
        if (req.text)
        {
            body(req.text, req.unmet ? C.red : C.white);
        }
    }

    /* The tick beside the field, not the number, decides whether this line exists. Absent means
       shown, so a permalink written before the tick existed still reads the way it did. */
    if (s.reqLevelShow !== false && Number(s.reqLevel) > 0)
    {
        body(`Requires Level ${Number(s.reqLevel)}`);
    }

    if (Number(s.itemLevel) > 0)
    {
        body(`Item Level ${Number(s.itemLevel)}`);
    }

    // Green block: Equip / Use / Chance on hit. Unlimited entries — the other gap called out.
    for (const effect of s.effects || [])
    {
        if (effect.text)
        {
            const prefix = effect.kind === 'custom' ? '' : `${effect.kind}: `;
            body(`${prefix}${effect.text}`, C.green);
        }
    }

    if (s.setName)
    {
        /*
         * The set block, counted against what is actually worn when the caller knows.
         *
         * An item tooltip on its own cannot know - the Item window is showing one piece and nothing
         * else - so `setWorn` and `setOn` are absent there and it reads 0 of however many, every
         * line grey, which is what the game shows for a piece sitting in a bag. The Armory hands
         * both in, and then it lights the way it does on a character.
         */
        const pieces = (s.setPieces || []).filter(Boolean);
        const on = s.setOn || [];
        const count = Number(s.setWorn) || 0;

        push({ l: '', kind: 'gap' });
        body(`${s.setName} (${count}/${pieces.length || Number(s.setCount) || 0})`, C.gold);

        for (const piece of pieces)
        {
            body(piece, on.includes(piece) ? C.white : C.socketEmpty);
        }

        if ((s.setBonuses || []).length)
        {
            push({ l: '', kind: 'gap' });

            for (const bonus of s.setBonuses)
            {
                if (bonus.text)
                {
                    body(`(${bonus.count}) Set: ${bonus.text}`,
                        count >= Number(bonus.count) ? C.green : C.socketEmpty);
                }
            }
        }
    }

    if (s.flavor)
    {
        push({ l: `"${s.flavor}"`, lc: C.gold, kind: 'flavor' });
    }

    if (s.madeBy)
    {
        body(`<Made by ${s.madeBy}>`, C.white);
    }

    const money = formatMoney(Number(s.sellGold) || 0, Number(s.sellSilver) || 0, Number(s.sellCopper) || 0);

    if (money.length)
    {
        push({ l: 'Sell Price:', lc: C.white, kind: 'money', money });
    }

    return lines;
}

function buildSpellLines(s)
{
    const lines = [];
    const push = (line) => lines.push(line);
    const body = (l, lc = C.white, r = '', rc = C.white) => push({ l, r, lc, rc, kind: 'body' });

    // Name white, rank gray and right-aligned on the same line — matching the in-game tooltip
    // (verified against wotlkdb: name rgb(255,255,255), rank rgb(157,157,157)).
    push({ l: s.spellName || 'Spell Name', lc: C.white, r: rankLabel(s.rank), rc: C.gray, kind: 'title' });

    /*
     * Cost sits left, range right; cast time left, cooldown right — the in-game arrangement, but
     * only while there is something on the left to arrange against.
     *
     * A spell with no power cost does not hang its range off an empty line: the range takes the
     * left instead. The client's own strings give this away — it keeps SPELL_CAST_TIME_INSTANT
     * ("Instant cast") for a spell that costs something and SPELL_CAST_TIME_INSTANT_NO_MANA
     * ("Instant") for one that does not, so the engine plainly has a no-cost path. Wowhead's WotLK
     * tooltip for Death Coil (spell 62904) is that path's output: no cost, "30 yd range" on its
     * own line, then "Instant".
     */
    const pair = (left, right) =>
    {
        if (left)
        {
            body(left, C.white, right || '', C.white);
        }
        else if (right)
        {
            body(right);
        }
    };

    pair(s.cost, s.range);
    pair(s.castTime, s.cooldown);

    if (s.reagents)
    {
        body(`Reagents: ${s.reagents}`);
    }

    if (s.spellRequires)
    {
        body(s.spellRequires, C.red);
    }

    if (s.description)
    {
        push({ l: '', kind: 'gap' });
        body(s.description, C.gold);
    }

    if (s.spellFlavor)
    {
        push({ l: `"${s.spellFlavor}"`, lc: C.gold, kind: 'flavor' });
    }

    return lines;
}

/**
 * The tooltip the game shows for the aura itself, which is not the spell's tooltip.
 *
 * Hovering a buff or debuff on a unit frame gives its own, shorter window: the aura's name, what
 * it does while it is on you, and how long is left. Wowhead lists the two separately for the same
 * reason — Soul Reaper (spell 69409) casts one thing and leaves another behind, and the aura's
 * text describes the part that has not happened yet.
 *
 * The time line is the client's own wording: SPELL_TIME_REMAINING_SEC is "%d |4second:seconds;
 * remaining", with MIN, HOURS and DAYS beside it, so "5 seconds remaining" is what the game prints
 * rather than a phrasing invented here.
 */
function buildBuffLines(s)
{
    const lines = [];

    lines.push({ l: s.buffName || s.spellName || 'Buff Name', lc: C.white, kind: 'title' });

    if (s.buffDescription)
    {
        lines.push({ l: s.buffDescription, lc: C.gold, kind: 'body' });
    }

    if (s.buffRemaining)
    {
        lines.push({ l: s.buffRemaining, lc: C.white, kind: 'body' });
    }

    return lines;
}

/* --------------------------------------------------------------------------- unit frame */

/*
 * Target-frame geometry, measured from the client textures rather than guessed (see
 * tools/extract-ui-art.js). Every classification variant shares the same slots — only the
 * dragon/skull ornament around the edge differs — so one set of numbers covers them all.
 *
 * Coordinates are in texture pixels relative to CROP, which is the region of the 256x128
 * texture that actually holds the frame.
 */
const UNIT_FRAME = {
    crop: { x: 24, y: 0, w: 232, h: 100 },
    /*
     * These three are the client's own numbers, not the transparent cut-outs they show through.
     *
     * TargetFrame.xml anchors each to the frame's TOPRIGHT, and the frame is 232x100 — the same
     * 232 this crop is wide, which is what makes them transferable. The health bar is 119x12 at
     * offset (-106, -41), so x = 232 - 106 - 119 = 7; the mana bar is the same at -52; the name
     * background is 119x19 at -22.
     *
     * Measuring the cut-outs instead gave 113x7 and 115x7, and drawing a bar at exactly that size
     * is what leaves a seam: any error in the measurement shows as a dark line between the bar and
     * the border. The game has no such problem because its bar is bigger than the hole and the
     * frame art masks it. Drawing these full-size, before the border, reproduces that exactly —
     * the blend becomes the texture's own alpha rather than a number this program guessed.
     */
    name: { x: 7, y: 22, w: 119, h: 19 },
    health: { x: 7, y: 41, w: 119, h: 12 },
    power: { x: 7, y: 52, w: 119, h: 12 },
    /*
     * The big ring holds the portrait; the small ring below-right holds the level (or a skull).
     *
     * The portrait is the client's again: a 64x64 texture at (126,12), so center (158,44) and an
     * inscribed radius of 32. Casting rays out from that center through the frame art puts its
     * first opaque pixel at a median radius of 28 and never past 30, which says two things — the
     * center is right, and a 32 portrait is masked by the ring in every direction.
     *
     * Drawing it at 27, as this did, is a pixel short of the 28 hole, and the gap shows as a thin
     * ring of background between the portrait and the art. Oversized-and-masked is what the game
     * does and it cannot leave a gap.
     */
    portrait: { cx: 158, cy: 44, r: 32 },
    level: { cx: 178.5, cy: 66, r: 11.5 }
};

/*
 * Boss deliberately reuses the Elite border. UI-UnitFrame-Boss is a different UI element — the
 * WotLK encounter-boss unit frames — not a target-frame border, so it does not wrap the portrait
 * ring at all. In game a worldboss shows the gold elite dragon with a skull in place of the level,
 * which is what TargetFrame.lua does: worldboss and elite both select UI-TargetingFrame-Elite.
 */
const UNIT_CLASSIFICATIONS = [
    { value: 'normal', label: 'Normal', art: 'unit-frame' },
    { value: 'elite', label: 'Elite', art: 'unit-frame-elite' },
    { value: 'rare', label: 'Rare', art: 'unit-frame-rare' },
    { value: 'rare-elite', label: 'Rare Elite', art: 'unit-frame-rare-elite' },
    { value: 'boss', label: 'Boss', art: 'unit-frame-elite' }
];

/* The health bar and name take the unit's selection color, as in the default UI. */
const UNIT_REACTIONS = [
    { value: 'hostile', label: 'Hostile', color: '#ff0000' },
    { value: 'neutral', label: 'Neutral', color: '#ffff00' },
    { value: 'friendly', label: 'Friendly', color: '#00ff00' }
];

/* PowerBarColor values from 3.3.5a. */
const POWER_TYPES = [
    { value: 'none', label: 'None', color: '#000000' },
    { value: 'mana', label: 'Mana', color: '#0000ff' },
    { value: 'rage', label: 'Rage', color: '#ff0000' },
    { value: 'energy', label: 'Energy', color: '#ffff00' },
    { value: 'focus', label: 'Focus', color: '#ff8040' },
    { value: 'runic', label: 'Runic Power', color: '#00d1ff' }
];

/*
 * The pool a bar starts at when you pick its type.
 *
 * Only mana is a real number that varies per creature. The rest are fixed hundred-point pools in
 * 3.3.5a, and they differ in where they start: rage and runic power fill up during a fight and
 * begin empty, while energy and focus are spent down from full. Picking "Rage" and getting
 * 20000/20000 was the mana default left behind.
 */
const POWER_DEFAULTS = {
    mana: { cur: 20000, max: 20000 },
    rage: { cur: 0, max: 100 },
    runic: { cur: 0, max: 100 },
    energy: { cur: 100, max: 100 },
    focus: { cur: 100, max: 100 }
};

/** Mana is the only pool a difficulty increase scales; the others are fixed at a hundred. */
const SCALES_WITH_DIFFICULTY = new Set(['mana']);

/*
 * The achievement card.
 *
 * Unlike the target frame, none of this is measured: the client ships the achievement UI's own
 * FrameXML in the archives (Interface\AddOns\Blizzard_AchievementUI), so every number below is
 * copied straight out of AchievementTemplate rather than recovered from the textures. Anchors
 * there are expressed as offsets from a corner with y growing upwards, and are converted here to
 * the top-left origin a canvas uses — a BOTTOMLEFT offset of (5, -2) on a 142-tall card is
 * y = 142 - 2 - height.
 *
 * The card is 434 wide. It is *not* 142 tall — that is only what AchievementTemplate declares as
 * a default, and it is what made the first version of this look fat. Blizzard_AchievementUI.lua
 * sizes every button itself: 84 collapsed, and when one is selected
 *
 *   height = 84 + objectives + (descriptionHeight - 20), plus 4 more if a reward strip shows
 *
 * (AchievementButton_DisplayObjectives). Since this card always draws its criteria, it is drawn
 * at the height the game would give a selected one.
 */
const ACHIEVEMENT = {
    width: 434,

    /* ACHIEVEMENTBUTTON_COLLAPSEDHEIGHT, and the one description line those 84 pixels allow for. */
    collapsedHeight: 84,
    descriptionHeight: 20,
    maxLinesCollapsed: 3,

    /*
     * ACHIEVEMENTUI_MAXCONTENTWIDTH. The description wraps at this and the criteria columns are
     * measured against it — note it is wider than the objectives frame the criteria sit in, which
     * is the game's own arithmetic and not a slip here.
     */
    contentWidth: 330,

    /*
     * $parentBackground: the parchment, inset 3px on every side.
     *
     * It is cropped rather than stretched. AchievementButton_Expand sets
     * TexCoord(0, 1, max(0, 1 - height/256), 1) on it — the card shows the bottom of a 256-tall
     * texture, taking more of it as the card grows — so a fixed card was squashing the whole
     * texture into 136 pixels and getting the grain wrong at every size.
     */
    background: { inset: 3, textureHeight: 256 },

    /*
     * $parentTitleBackground: 5px in from each side, 5 down, 24 tall — and only the top-left
     * corner of its texture, which is a sheet.
     */
    title: { x: 5, y: 5, w: 424, h: 24, crop: { x: 0, y: 0, w: 0.9765625, h: 0.3125 }, alpha: 0.8 },

    /* $parentLabel: 320x20 centered on the title strip. */
    label: { cx: 217, y: 5, w: 320, h: 20 },

    /*
     * $parentIcon: a 60x60 frame at (8, -9). Inside it the icon is 50x50 offset (0, 3) from the
     * center — and 3 *up*, since FrameXML's y grows the other way — with the ring drawn over it
     * at 72x72 offset (-1, 2). The ring texture is a sheet; only its top-left 0.5625 is the ring.
     */
    icon: { cx: 38, cy: 39, size: 50, dy: -3 },
    iconRing: { cx: 37, cy: 37, size: 72, crop: 0.5625 },

    /*
     * $parentShield: a 64x64 frame anchored TOPRIGHT at (-6, 0), so its right edge is at 428.
     * Inside it a 66x64 shield hangs from that same corner at (0, -6) — right edge 428, left edge
     * 362 — out of UI-Achievement-Shields, which is two shields side by side: the left half
     * earned, the right unearned.
     *
     * The points are a 32x16 FontString anchored TOPRIGHT (-18, -26) within the frame, so the box
     * runs x 378-410 and its center is 394, not the 396 this said before. Two pixels does show:
     * the painted shield's own middle sits at 393.5 (measured off the texture's opaque bounds),
     * and a number two pixels right of that reads as off-center.
     */
    shield: { x: 362, y: 6, w: 66, h: 64 },
    points: { cx: 394, cy: 34 },

    /*
     * $parentDescription: 30 down from the card's top, its lines one font-height apart —
     * ACHIEVEMENTUI_FONTHEIGHT is the description font's own size, which is what the client counts
     * lines by and therefore what the height maths above has to agree with.
     *
     * The width is the one number here that is deliberately not the client's. FrameXML centers the
     * string on the card and sets its width to ACHIEVEMENTUI_MAXCONTENTWIDTH (330), which spans
     * x 52-382 — straight over the icon ring, which ends at 73, and under the shield, which starts
     * at 362. So a full-width line has letters sitting on both. Given the whole point of this card
     * is to be exported and looked at, the description is given the same run the objectives get
     * (icon's right edge + 8, to the shield's left edge - 10) and centered on that instead.
     */
    description: { cx: 215, y: 30, w: 278, lineHeight: 10 },

    /*
     * $parentObjectives: between the icon's right edge (+8) and the shield's left edge (-10),
     * starting 8 below the description. The criteria rows themselves are 15 tall, per
     * AchievementCriteriaTemplate.
     */
    objectives: { x: 76, right: 354, gap: 8, rowHeight: 15, check: { w: 20, h: 16 } },

    /*
     * $parentRewardBackground: 5 in from each side, 24 tall, sitting 2 *below* the card's bottom
     * edge — the strip deliberately overhangs. Its texture is cropped to 0.69 x 0.75.
     */
    reward: { x: 5, fromBottom: 22, w: 424, h: 24, crop: { w: 0.69, h: 0.75 } },
    rewardText: { cx: 217, fromBottom: 19 },

    /* The faint edge glow: 32x32 corners and a 370x16 run between them, at low alpha. */
    tsunami: { corner: 32, runWidth: 370, topInset: 20, alpha: { corner: 0.1, run: 0.3 } }
};

/*
 * Every string on the card, resolved through the inherits chain in FontStyles.xml and Fonts.xml
 * exactly as the tooltip and target-frame fonts were. All five are Friz Quadrata, which is the
 * same answer the rest of this program keeps arriving at.
 *
 *   title       GameFontHighlightMedium   -> SystemFont_Shadow_Med3  14, shadow 1,-1, white
 *   description AchievementDescriptionFont-> SystemFont_Small        10, own shadow,  white
 *   criteria    AchievementCriteriaFont   -> AchievementDescription  10, left-aligned
 *   points      AchievementPointsFont     -> SystemFont_Shadow_Large 16, shadow 1,-1, gold
 *   reward      GameFontNormalSmall       -> SystemFont_Shadow_Small 10, shadow 1,-1, gold
 */
const ACHIEVEMENT_FONTS = {
    title: 14,
    description: 10,
    criteria: 10,
    points: 16,
    reward: 10
};

/* Gold is FrameXML's (1, 0.82, 0), the same value the tooltip's own gold lines use. */
const ACHIEVEMENT_COLORS = {
    title: '#ffffff',
    description: '#ffffff',
    criteria: '#ffffff',
    points: '#ffd100',
    reward: '#ffd100',
    /* An unmet criterion is dimmed rather than hidden, as in the game's own list. */
    criteriaPending: 'rgba(255,255,255,0.5)'
};

/*
 * The point values an achievement can carry, counted off the client's own Achievement.dbc rather
 * than offered as a round range: 10 (1,075 of them), 25 (40), 20 (28), 50 (10), 15 (8), 30 (1),
 * and 0 (158). Nothing in the client is worth 5, 40 or 100, so nothing here offers them.
 *
 * Zero is not "no points" but a Feat of Strength, and the data says so without ambiguity: all 158
 * zero-point achievements sit in category 81, Feats of Strength, and the card draws them with the
 * -NoPoints shield, which has no room for a number in the first place.
 */
const ACHIEVEMENT_POINTS = [
    { value: 0, label: 'Feat of Strength' },
    { value: 10, label: '10' },
    { value: 15, label: '15' },
    { value: 20, label: '20' },
    { value: 25, label: '25' },
    { value: 30, label: '30' },
    { value: 50, label: '50' }
];

function lookup(list, value)
{
    return list.find((entry) => entry.value === value) || list[0];
}

function buildLines(state)
{
    return state.kind === 'spell' ? buildSpellLines(state) : buildItemLines(state);
}


/* --------------------------------------------------------------------------- chat lines */

/*
 * What the chat frame prints when a creature speaks, and in what color.
 *
 * Both halves come from the client rather than from memory. The sentences are in
 * `Interface\FrameXML\GlobalStrings.lua` — CHAT_MONSTER_SAY_GET is "%s says:\32", and the \32 is
 * a space, which is why the game's output has one after the colon and none before it. The colors
 * are the client's own defaults, written out in its `chat-cache.txt`:
 *
 *     MONSTER_SAY      255 255 159     a pale yellow, not white
 *     MONSTER_YELL     255  64  64
 *     MONSTER_WHISPER  255 181 235
 *     MONSTER_EMOTE    255 128  64
 *     RAID_BOSS_EMOTE  255 221   0     the yellow a boss's own emote uses
 *
 * The pale yellow is the one worth knowing: a creature saying something is not white like a
 * player's say, and drawing it white is the commonest way a mocked-up chat log looks wrong.
 */
const CHAT_TYPES = {
    say: { label: 'Say', color: 'rgb(255, 255, 159)', format: (who, what) => `${who} says: ${what}` },
    yell: { label: 'Yell', color: 'rgb(255, 64, 64)', format: (who, what) => `${who} yells: ${what}` },
    whisper: { label: 'Whisper', color: 'rgb(255, 181, 235)', format: (who, what) => `${who} whispers: ${what}` },

    /*
     * An emote is third person and carries no colon: the name is the start of the sentence, so
     * "Lord Marrowgar" plus "roars in fury" reads as one line rather than as a quotation.
     */
    emote: { label: 'Emote', color: 'rgb(255, 128, 64)', format: (who, what) => `${who} ${what}` },

    /* A boss emote is the yellow line in the middle of the screen, printed with no name at all. */
    bossEmote: { label: 'Boss emote', color: 'rgb(255, 221, 0)', format: (who, what) => what || who },
    bossWhisper: {
        label: 'Boss whisper', color: 'rgb(255, 221, 0)',
        format: (who, what) => `${who} whispers: ${what}`
    }
};

/*
 * The moments a line is usually tied to.
 *
 * Suggestions rather than a fixed set — the field takes anything, because half the interesting
 * ones are specific to a fight ("When the third add spawns", "At 30% health").
 *
 * The list runs in the order the fight does, which is why Intro and Outro sit at the ends: they are
 * the role-play either side of the pull rather than a moment inside it.
 */
const CHAT_TRIGGERS = [
    'Intro',
    'On aggro',
    'On pull',
    'On phase change',
    'On casting a spell',
    'On killing a player',
    'On death',
    'On wipe',
    'On enrage',
    'Outro'
];

/** The dropdown's own list, in the order the types are worth reaching for. */
const CHAT_TYPE_OPTIONS = Object.entries(CHAT_TYPES).map(([value, type]) => ({ value, label: type.label }));

/**
 * The lines a script prints, ready to draw.
 *
 * A line with no text at all is dropped rather than printed as a bare name — an empty row in the
 * editor is one being typed, not a line in the fight.
 */
function buildChatLines(s)
{
    return (s.textLines || [])
        .filter((line) => (line.text || '').trim() || (line.speaker || '').trim())
        .map((line) =>
        {
            const type = CHAT_TYPES[line.type] || CHAT_TYPES.say;
            const who = (line.speaker || '').trim() || 'Unnamed';
            const what = (line.text || '').trim();

            return {
                text: type.format(who, what),
                color: type.color,
                trigger: (line.trigger || '').trim()
            };
        });
}

window.TooltipModel = {
    QUALITY, C, SOCKETS, STAT_TYPES, RESISTANCES, EQUIP_PRESETS,
    SLOTS, ITEM_TYPES, BINDINGS, SLOT_TYPES, WEAPON_SLOTS, typesForSlot,
    UNIT_FRAME, UNIT_CLASSIFICATIONS, UNIT_REACTIONS, POWER_TYPES,
    ACHIEVEMENT, ACHIEVEMENT_FONTS, ACHIEVEMENT_COLORS, ACHIEVEMENT_POINTS,
    POWER_DEFAULTS, SCALES_WITH_DIFFICULTY,
    buildLines, buildBuffLines, buildChatLines, CHAT_TYPES, CHAT_TYPE_OPTIONS, CHAT_TRIGGERS,
    enrageLabel, ENRAGE_ICON,
    qualityColor, rankLabel, formatMoney, lookup
};
