'use strict';

/*
 * The character sheet as a picture.
 *
 * Laid out the way the character creation screen is: the race's own place behind it, the name
 * across the top, the paper doll down the middle, the stats along the bottom.
 *
 * The gear's tooltips were drawn down both sides for a while and have been taken out again - at 1x
 * they made the picture two thousand pixels tall, which buried the backdrop the whole design is
 * built on. The doll already says what is worn.
 *
 * The backdrop plates are screenshots taken in the game with the UI hidden, one per race plus the
 * death knight one; `art/creation/README.md` says why they are photographs rather than anything
 * rendered from the client.
 */

import { iconUrl } from './icons.js';
import { M } from './wow.js';

/*
 * Which plate a race stands on.
 *
 * Gnome shares the dwarf's Ironforge and troll shares the orc's Durotar, the way the game's own
 * creation screen does - it has no scene for either of them. A death knight overrides all of it:
 * Ebon Hold is the screen every death knight gets, whatever race made it.
 */
const PLATES = {
    1: 'Human',
    2: 'OrcTroll',
    3: 'DwarfGnome',
    4: 'NightElf',
    5: 'Undead',
    6: 'Tauren',
    7: 'DwarfGnome',
    8: 'OrcTroll',
    10: 'Bloodelf',
    11: 'Draenei'
};

const DEATH_KNIGHT = 6;

/*
 * How hard each plate is dimmed before anything is drawn on it.
 *
 * One number for all nine does not work: they were shot in the places they show, and Ironforge at
 * night is four stops darker than Thunder Bluff at noon. Dimming Ironforge as hard as the mesas
 * turns it to mud; dimming the mesas as gently as Ironforge leaves white text on a blue sky.
 */
const DIM = {
    Human: 0.42,
    DwarfGnome: 0.22,
    NightElf: 0.44,
    Draenei: 0.40,
    OrcTroll: 0.46,
    Undead: 0.40,
    Tauren: 0.52,
    Bloodelf: 0.46,
    DK: 0.34
};

/* The picture's own measurements, before scaling. */
const CARD = {
    width: 1500,

    /*
     * The height is worked out from the doll and the stat cards rather than fixed, since the third
     * stat frame is a different depth depending on which one is showing. `minHeight` is the floor.
     */
    minHeight: 1100,
    pad: 46,

    /* A stat card: its head, one row, and the gaps around and between the cards. */
    stats: { head: 36, row: 27, pad: 8, gap: 18, top: 34 },

    /*
     * The weapons are narrower than the column slots on purpose: three of them at the column width
     * came to 932 against the columns' 750 above, so the row read as off-axis even though it was
     * centered. At 240 with a tighter gap the three of them line up with the columns exactly.
     */
    slot: { width: 300, icon: 52, gap: 12, height: 62, weaponWidth: 210, weaponGap: 12 },

    /*
     * `gap` is between the rows, `split` is between the two columns.
     *
     * The split started at 150 and read as a corridor down the middle of the picture. Closing it
     * to 48 makes the doll one block rather than two lists.
     */
    column: { gap: 16, split: 48 },

    gold: '#ffd100',
    text: '#ffffff',
    muted: '#c8cddb',

    /* The game's own face for the character's own words, the way the sheet builders use it. */
    game: (size, weight = 400) => `${weight} ${size}px AstralGame, Georgia, "Times New Roman", serif`,
    ui: (size, weight = 400) => `${weight} ${size}px Figtree, "Segoe UI", Arial, sans-serif`
};

/** The plate for a character: the class first, since a death knight is a death knight. */
function plateFor(raceId, classId)
{
    if (Number(classId) === DEATH_KNIGHT)
    {
        return 'DK';
    }

    return PLATES[Number(raceId)] || 'Human';
}

let fontsReady = null;

/*
 * Canvas measures synchronously and never recalculates, so a picture laid out before AstralGame
 * arrives is measured in Georgia's metrics and drawn in AstralGame's. Same trap the raid sheet
 * documents; same answer.
 */
function ensureFonts()
{
    if (!fontsReady)
    {
        fontsReady = Promise.all([
            document.fonts.load('400 68px AstralGame'),
            document.fonts.load('400 30px AstralGame'),
            document.fonts.load('400 17px Figtree')
        ]).catch(() => {});
    }

    return fontsReady;
}

const imageCache = new Map();

function loadImage(source)
{
    if (!source)
    {
        return Promise.resolve(null);
    }

    if (!imageCache.has(source))
    {
        imageCache.set(source, new Promise((resolve) =>
        {
            const image = new Image();

            image.onload = () => resolve(image);
            image.onerror = () => resolve(null);
            image.src = source;
        }));
    }

    return imageCache.get(source);
}

/**
 * Draws an image to fill the whole picture, cropping rather than squashing.
 *
 * The plates are 16:9 and the picture is squarer, so something has to give. Cropping the sides
 * keeps the horizon where it was photographed, which is what makes it read as a place; scaling to
 * fit would letterbox, and stretching would be visible on every straight edge in Ironforge.
 */
function drawCover(ctx, image, width, height)
{
    const scale = Math.max(width / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;

    ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

/*
 * How far down the plate is allowed to reach, and how long it takes to fade out.
 *
 * The plates are 16:9 screenshots and the picture is squarer, so covering the whole of it means
 * zooming into the middle of the shot and throwing away its sides. The art is the point of the
 * design, so it keeps close to its own shape at the top, where the name and the doll are, and
 * falls away into flat ground under the stat cards.
 */
const PLATE_MAX = 1050;
const PLATE_FADE = 260;
const GROUND = '#0a0c14';

/** The plate across the top, fading into the ground the rest of the picture stands on. */
function drawBackdrop(ctx, image, width, height)
{
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, width, height);

    if (!image)
    {
        return;
    }

    const band = Math.min(height, PLATE_MAX);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, band);
    ctx.clip();
    drawCover(ctx, image, width, band);
    ctx.restore();

    /* Only when there is picture below the band; a short sheet is all plate and needs no fade. */
    if (height > band)
    {
        const fade = ctx.createLinearGradient(0, band - PLATE_FADE, 0, band);

        fade.addColorStop(0, 'rgba(10, 12, 20, 0)');
        fade.addColorStop(1, GROUND);
        ctx.fillStyle = fade;
        ctx.fillRect(0, band - PLATE_FADE, width, PLATE_FADE);
    }
}

/**
 * The scrim: a flat dim over everything, then darker at the top and bottom.
 *
 * The flat pass is what makes any text legible at all. The two gradients are for the two places
 * text actually lands - the name across the top, the stats along the bottom - and they let the
 * middle of the plate, which is the part worth looking at, stay brighter than the edges.
 */
function drawScrim(ctx, width, height, dim)
{
    ctx.fillStyle = `rgba(6, 8, 14, ${dim})`;
    ctx.fillRect(0, 0, width, height);

    const top = ctx.createLinearGradient(0, 0, 0, height * 0.34);

    top.addColorStop(0, 'rgba(6, 8, 14, 0.78)');
    top.addColorStop(1, 'rgba(6, 8, 14, 0)');
    ctx.fillStyle = top;
    ctx.fillRect(0, 0, width, height * 0.34);

    const bottom = ctx.createLinearGradient(0, height, 0, height * 0.62);

    bottom.addColorStop(0, 'rgba(6, 8, 14, 0.82)');
    bottom.addColorStop(1, 'rgba(6, 8, 14, 0)');
    ctx.fillStyle = bottom;
    ctx.fillRect(0, height * 0.62, width, height * 0.38);
}

/** Text with a shadow under it, because every plate has some patch that fights white text. */
function shadowText(ctx, text, x, y, { font, color, align = 'center' })
{
    ctx.save();
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.85)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 2;
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r)
{
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

/**
 * One slot of the doll: the icon, and the item's name beside it.
 *
 * `mirrored` puts the icon on the right and the text against it, which is what makes the two
 * columns face each other the way the game's paper doll does rather than reading as one list
 * printed twice.
 */
async function drawSlot(ctx, slot, item, x, y, mirrored, width = CARD.slot.width)
{
    const { icon, gap, height } = CARD.slot;
    const iconX = mirrored ? x + width - icon : x;
    const iconY = y + (height - icon) / 2;

    /*
     * Barely there.
     *
     * At the 62% these started on, sixteen boxes covered the middle of the plate and the picture
     * read as the program's own panel pasted over a photograph. The backdrop is the whole point of
     * the design, so the box is now just enough to hold the row together, and an empty slot is
     * fainter still - what is worn should carry more weight than what is not.
     */
    ctx.save();
    ctx.fillStyle = item ? 'rgba(10, 13, 22, 0.30)' : 'rgba(10, 13, 22, 0.16)';
    roundRect(ctx, x, y, width, height, 8);
    ctx.fill();
    ctx.strokeStyle = item ? 'rgba(255, 255, 255, 0.09)' : 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    const art = item && item.icon ? await loadImage(iconUrl(item.icon)) : null;

    ctx.save();
    roundRect(ctx, iconX, iconY, icon, icon, 6);
    ctx.clip();

    if (art)
    {
        ctx.drawImage(art, iconX, iconY, icon, icon);
    }
    else
    {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
        ctx.fillRect(iconX, iconY, icon, icon);
    }

    ctx.restore();

    /* An empty slot is outlined and an filled one takes its quality's color, so the doll says what
       is missing without printing the word "empty" sixteen times. */
    ctx.save();
    roundRect(ctx, iconX + 0.5, iconY + 0.5, icon - 1, icon - 1, 6);
    ctx.strokeStyle = item ? M.qualityColor(item.quality) : 'rgba(255, 255, 255, 0.22)';
    ctx.lineWidth = item ? 2 : 1;
    ctx.stroke();
    ctx.restore();

    const textX = mirrored ? iconX - gap : iconX + icon + gap;
    const align = mirrored ? 'right' : 'left';
    const room = width - icon - gap;

    ctx.save();
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 6;

    if (item)
    {
        ctx.font = CARD.ui(17, 500);
        ctx.fillStyle = M.qualityColor(item.quality);
        ctx.fillText(fit(ctx, item.name, room), textX, y + height / 2 - 9);

        ctx.font = CARD.ui(14);
        ctx.fillStyle = CARD.muted;
        ctx.fillText(slot, textX, y + height / 2 + 12);
    }
    else
    {
        ctx.font = CARD.ui(16);
        ctx.fillStyle = 'rgba(200, 205, 219, 0.55)';
        ctx.fillText(slot, textX, y + height / 2);
    }

    ctx.restore();
}

/** Trims a name to the room it has, with an ellipsis, so a long title never runs into the doll. */
function fit(ctx, text, room)
{
    const value = String(text || '');

    if (ctx.measureText(value).width <= room)
    {
        return value;
    }

    let cut = value;

    while (cut.length > 1 && ctx.measureText(cut + '...').width > room)
    {
        cut = cut.slice(0, -1);
    }

    return cut + '...';
}

/**
 * The whole picture.
 *
 * `character` is everything the panel already knows, handed over rather than imported: name, guild,
 * race and class, and the slots in the order the doll draws them. Passing it keeps this file from
 * importing the panel that calls it, which would be a cycle.
 */
/**
 * The stats along the bottom, six across, with the resistances on their own line at the foot.
 *
 * The same break the panel makes and for the same reason: the five schools are one thought and
 * short enough that flowing them into six wide columns puts Fire beside Resilience.
 */
/** How tall a card with this many rows comes out. */
function cardHeight(rows)
{
    return CARD.stats.head + CARD.stats.pad * 2 + rows * CARD.stats.row;
}

/**
 * One stat frame: a titled head over its rows, the same card the panel draws.
 *
 * `columns` splits the rows across the card, which is only used by the resistances - five schools
 * across one wide card rather than five lines down a narrow one.
 */
function drawCard(ctx, group, x, y, width, columns = 1)
{
    const { head, row, pad } = CARD.stats;
    const perColumn = Math.ceil(group.rows.length / columns);
    const height = head + pad * 2 + perColumn * row;

    ctx.save();
    roundRect(ctx, x, y, width, height, 7);
    ctx.fillStyle = 'rgba(10, 13, 22, 0.72)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    /* The head, darker than the body, the way the panel's is. */
    ctx.save();
    roundRect(ctx, x, y, width, height, 7);
    ctx.clip();
    ctx.fillStyle = 'rgba(0, 0, 0, 0.34)';
    ctx.fillRect(x, y, width, head);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
    ctx.fillRect(x, y + head - 1, width, 1);
    ctx.restore();

    ctx.save();
    ctx.font = CARD.ui(15, 600);
    ctx.fillStyle = CARD.gold;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(group.title.toUpperCase(), x + 14, y + head / 2 + 1);
    ctx.restore();

    const cell = width / columns;

    group.rows.forEach((entry, i) =>
    {
        const column = Math.floor(i / perColumn);
        const index = i % perColumn;
        const left = x + column * cell;
        const top = y + head + pad + index * row;

        /* Every other row a shade lighter, so a label tracks to its number across the card. */
        if (index % 2 === 1 && columns === 1)
        {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.03)';
            ctx.fillRect(left + 1, top, cell - 2, row);
        }

        const baseline = top + row / 2 + 1;

        ctx.save();
        ctx.textBaseline = 'middle';

        /* The value is measured first and the label takes what is left: "Ranged damage" beside
           "882 - 1139" is wider than the card, and the two ran into each other. */
        ctx.font = CARD.ui(15, 600);
        ctx.fillStyle = entry.value === '-' ? 'rgba(200, 205, 219, 0.5)' : CARD.text;
        ctx.textAlign = 'right';
        ctx.fillText(entry.value, left + cell - 14, baseline);

        const room = cell - 28 - ctx.measureText(entry.value).width - 10;

        ctx.font = CARD.ui(15);
        ctx.fillStyle = CARD.muted;
        ctx.textAlign = 'left';
        ctx.fillText(fit(ctx, entry.label, room), left + 14, baseline);

        ctx.restore();
    });

    return height;
}

/**
 * The stat box: the three frames across, resistances under all three.
 *
 * The same model the panel renders, so the picture shows the frame the panel is showing - flip the
 * panel to Defense and the picture exports Defense.
 */
function drawStats(ctx, stats, top, width)
{
    const cards = [stats.general, stats.attributes, stats.frame].filter(Boolean);
    const gap = CARD.stats.gap;
    const inner = width - CARD.pad * 2;
    const cardWidth = (inner - gap * (cards.length - 1)) / cards.length;

    let tallest = 0;

    cards.forEach((group, i) =>
    {
        tallest = Math.max(tallest,
            drawCard(ctx, group, CARD.pad + i * (cardWidth + gap), top, cardWidth));
    });

    if (stats.resist && stats.resist.rows.length)
    {
        drawCard(ctx, stats.resist, CARD.pad, top + tallest + gap, inner, stats.resist.rows.length);
    }
}

async function buildCharacterSheet(character, scale = 2)
{
    await ensureFonts();

    /* Everything that decides how big the picture is, measured before any of it is drawn. */
    const stats = character.stats || null;
    const headerBottom = CARD.pad + 62 + (character.guild ? 40 : 0) + 34;
    const bodyTop = headerBottom + 46;

    const rows = Math.max(character.left.length, character.right.length);
    const dollHeight = rows * (CARD.slot.height + CARD.column.gap) + 14 + CARD.slot.height;

    /* The tallest of the three frames sets the block's height, plus the resistance card under it. */
    const statCards = stats ? [stats.general, stats.attributes, stats.frame].filter(Boolean) : [];
    const statsHeight = statCards.length
        ? CARD.stats.top
            + Math.max(...statCards.map((group) => cardHeight(group.rows.length)))
            + (stats.resist && stats.resist.rows.length ? CARD.stats.gap + cardHeight(1) : 0)
        : 0;

    const height = Math.max(
        CARD.minHeight,
        bodyTop + dollHeight + statsHeight + CARD.pad);

    const canvas = document.createElement('canvas');

    canvas.width = CARD.width * scale;
    canvas.height = height * scale;

    const ctx = canvas.getContext('2d');

    ctx.scale(scale, scale);

    const plate = plateFor(character.raceId, character.classId);
    const image = await loadImage(`art/creation/${plate}.jpg`);

    /* A missing plate leaves the flat ground, which is a picture rather than a failure. */
    drawBackdrop(ctx, image, CARD.width, height);

    /* The scrim belongs to the plate, so it stops where the plate does. */
    drawScrim(ctx, CARD.width, Math.min(height, PLATE_MAX),
        DIM[plate] !== undefined ? DIM[plate] : 0.42);

    const middle = CARD.width / 2;
    let y = CARD.pad + 62;

    shadowText(ctx, character.name || 'Unnamed', middle, y,
        { font: CARD.game(64), color: CARD.gold });

    if (character.guild)
    {
        y += 40;
        shadowText(ctx, `<${character.guild}>`, middle, y,
            { font: CARD.game(28), color: CARD.text });
    }

    y += 34;
    shadowText(ctx, character.subtitle, middle, y,
        { font: CARD.ui(19), color: CARD.muted });

    /* The two columns, facing each other, with the weapons on their own row underneath. */
    const columnWidth = CARD.slot.width;
    const columnGap = CARD.column.split;
    const leftX = middle - columnGap / 2 - columnWidth;
    const rightX = middle + columnGap / 2;

    /* Measured above, where the picture's height was worked out from it. */
    const rowY = bodyTop;

    for (let i = 0; i < rows; ++i)
    {
        const top = rowY + i * (CARD.slot.height + CARD.column.gap);

        if (character.left[i])
        {
            await drawSlot(ctx, character.left[i].slot, character.left[i].item, leftX, top, false);
        }

        if (character.right[i])
        {
            await drawSlot(ctx, character.right[i].slot, character.right[i].item, rightX, top, true);
        }
    }

    /*
     * Weapons sit centered under both columns, which is where the game puts them.
     *
     * An empty off hand is dropped rather than drawn as a hole: a two-hander and a hunter's bow
     * both leave it empty for a reason, and printing "Off hand" between them says nothing while
     * pushing the two that matter apart. The main hand and the ranged or relic slot close up
     * instead. Nothing else in the row is ever dropped - an empty main hand is worth saying.
     */
    const weapons = character.weapons.filter(
        (entry) => entry.item || entry.slot !== 'Off hand');

    const { weaponWidth, weaponGap } = CARD.slot;
    const weaponY = rowY + rows * (CARD.slot.height + CARD.column.gap) + 14;
    const weaponSpan = weapons.length * weaponWidth + (weapons.length - 1) * weaponGap;
    let weaponX = middle - weaponSpan / 2;

    for (const entry of weapons)
    {
        await drawSlot(ctx, entry.slot, entry.item, weaponX, weaponY, false, weaponWidth);
        weaponX += weaponWidth + weaponGap;
    }

    if (statCards.length)
    {
        drawStats(ctx, stats, bodyTop + dollHeight + CARD.stats.top, CARD.width);
    }

    return canvas;
}

function save(canvas, name)
{
    const link = document.createElement('a');

    link.download = name;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Draws the picture and hands it over as a file. */
async function exportCharacterSheet(character)
{
    const canvas = await buildCharacterSheet(character);

    save(canvas, `${slug(character.name) || 'character'}.png`);

    return canvas;
}

export { buildCharacterSheet, exportCharacterSheet, plateFor };
