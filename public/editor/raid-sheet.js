'use strict';

/*
 * A fight on one sheet, laid out the way a tactics page is.
 *
 * The first version drew everything as the game draws it — every spell a full tooltip card — and a
 * boss with eight abilities became a wall of boxes to be read one at a time. A tactics page solves
 * that with a table: an icon, a name, and what the thing does, one row each. That is what abilities
 * get here. The target frames stay on top, because a frame is the one piece whose *look* is the
 * information.
 *
 * The sheet is built in sections, top to bottom, each laid out the way that kind of thing reads:
 *
 *   Creatures    frames flowed left to right, several across
 *   Abilities    a table, grouped by phase, naming the caster when there is more than one
 *   Loot         tooltips at a narrower width, so five fit across
 *   Achievements and quotes, flowed the same way
 *
 * Every piece is drawn by the same renderer its own window uses, so an item on a sheet is the item
 * the Item window would export, pixel for pixel.
 */

import { defaultState, view, effectText } from './state.js';
import { status } from './preview.js';
import { iconUrl } from './icons.js';
import { M, R } from './wow.js';

const SHEET = {
    pad: 30,
    gap: 20,
    title: 44,
    section: 19,

    /*
     * How wide the body is before scaling.
     *
     * Set from the loot row backwards: five item tooltips and the gaps between them. Widening the
     * page rather than shrinking the tooltips is the trade — a sheet is looked at, not printed, so
     * it can afford the pixels, and a tooltip too small to read is worth nothing at any width.
     */
    content: 1700,

    /* An ability row: its icon box, and the spacing around the text beside it. */
    ability: { icon: 44, gap: 14, pad: 12, name: 21, meta: 15, body: 17 },

    /*
     * The width of an item tooltip's text.
     *
     * Not its finished width: the icon sits outside the box, so its own 44 and the 6 beside it are
     * added to this plus the tooltip's padding — about 314 at its widest. Five of them plus four
     * gaps is what sets the body width above.
     */
    lootWidth: 240,

    background: '#0d0f16',
    panel: '#151823',
    line: '#2a2f42',
    text: '#dfe3ee',
    muted: '#8992ab',
    accent: '#ffd100',
    gold: '#ffd100',
    /*
     * The sheet's own voice is the program's, not the game's.
     *
     * Figtree is what the window around the sheet is set in, so a heading, an ability name and a
     * caption all match the app that produced them. The game's own face is kept for the text that
     * is quoting the game — flavor lines and descriptions, in serif below.
     */
    family: 'Figtree',
    font: (size, weight = 400) => `${weight} ${size}px Figtree, "Segoe UI", Arial, sans-serif`,
    serif: (size) => `${size}px AstralGame, Georgia, "Times New Roman", serif`
};

/**
 * Makes sure the sheet's own face has arrived before anything is measured.
 *
 * Figtree is declared in app.css with font-display: swap, so the browser is free to hand canvas
 * the fallback until it loads. Canvas measures synchronously and never recalculates, so a sheet
 * built in that window would be laid out against Segoe UI's metrics and drawn in Figtree's.
 */
let fontsReady = null;

function ensureFonts()
{
    if (!fontsReady)
    {
        fontsReady = Promise.all([
            document.fonts.load(`600 ${SHEET.title}px ${SHEET.family}`),
            document.fonts.load(`400 ${SHEET.section}px ${SHEET.family}`)
        ]).catch(() => {});
    }

    return fontsReady;
}

/**
 * Decoded images, by source, for as long as the page is open.
 *
 * The same icon appears on a boss sheet and again on the raid sheet, and a phase export draws
 * every creature's portrait once per phase. Client icons are HTTP-cached already, but the *decode*
 * is not, and a portrait is a 200px data URL that no HTTP cache ever sees.
 */
const imageCache = new Map();

/** Loads any image source — an icon path or a stored data URL — or null if it will not load. */
function loadImage(source)
{
    if (!source)
    {
        return Promise.resolve(null);
    }

    if (!imageCache.has(source))
    {
        imageCache.set(source, decodeImage(source));
    }

    return imageCache.get(source);
}

function decodeImage(source)
{
    return new Promise((resolve) =>
    {
        const image = new Image();

        image.onload = () => resolve(image);
        image.onerror = () => resolve(null);
        image.src = source;
    });
}

/**
 * A state to draw one piece from: the defaults with the stored fields over them.
 *
 * Green lines need one more step. An Equip:/Use: line is stored as a preset and a number, and the
 * tooltip compiler wants the finished sentence — without this every green line came out blank.
 */
function pieceState(kind, fields)
{
    const piece = { ...defaultState(), ...fields, kind };

    piece.effects = (piece.effects || []).map((effect) => ({
        kind: effect.kind,
        text: effect.text || effectText(effect)
    }));

    return piece;
}

/** Wraps text to a width, returning the lines. */
function wrap(ctx, text, width)
{
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';

    for (const word of words)
    {
        const candidate = line ? `${line} ${word}` : word;

        if (ctx.measureText(candidate).width > width && line)
        {
            lines.push(line);
            line = word;
        }
        else
        {
            line = candidate;
        }
    }

    if (line)
    {
        lines.push(line);
    }

    return lines;
}

/* ------------------------------------------------------------------ abilities */

/**
 * Every ability in the fight, with what casts it and when.
 *
 * An ability cast by more than one creature — the shared ones in a council or a twin fight — is
 * listed once with both casters named, rather than repeated under each of them.
 */
async function abilitiesOf(difficulty, phaseId)
{
    const npcs = difficulty.npcs || [];
    const phases = difficulty.phases || [];
    const rows = [];
    const seen = new Map();

    const phaseName = (id) =>
    {
        const phase = phases.find((p) => p.id === id);

        return phase ? [phase.name, phase.trigger].filter(Boolean).join(' - ') : '';
    };

    for (const npc of npcs)
    {
        for (const spell of npc.spells || [])
        {
            if (phaseId !== undefined && (spell.phase || '') !== phaseId)
            {
                continue;
            }

            const key = `${spell.spellName}|${spell.phase || ''}`;
            const found = seen.get(key);

            if (found)
            {
                found.casters.push(npc.name);
                continue;
            }

            const row = {
                spell,
                casters: [npc.name],
                phase: spell.phase || '',
                phaseLabel: phaseName(spell.phase || '')
            };

            seen.set(key, row);
            rows.push(row);
        }
    }

    /* Rows come out grouped by phase, in the order the phases were written. */
    const order = ['', ...phases.map((phase) => phase.id)];

    rows.sort((a, b) => order.indexOf(a.phase) - order.indexOf(b.phase));

    for (const row of rows)
    {
        row.icon = await loadImage(row.spell.spellIcon ? iconUrl(row.spell.spellIcon) : '');
    }

    return rows;
}

/**
 * The enrage timer, shaped as a row of the ability table.
 *
 * It is the fight's deadline rather than one of its abilities, so it sits above everything - ahead
 * of the first phase heading, where the eye lands first - but it is drawn as a row because that is
 * what it is: an icon and a line of text in the same table. Carrying no phase keeps it there, and
 * the sort is stable, so it stays in front of the unphased abilities it shares that with.
 *
 * Returns null when the fight has no enrage, which is the difference between off and zero.
 */
async function enrageRow(difficulty)
{
    const enrage = difficulty.enrage;

    if (!enrage || !enrage.on)
    {
        return null;
    }

    return {
        spell: { spellName: M.enrageLabel(enrage), description: '' },
        casters: [],
        phase: '',
        phaseLabel: '',
        icon: await loadImage(iconUrl(M.ENRAGE_ICON))
    };
}

/**
 * The ability table, in its own canvas.
 *
 * Measured first and drawn second, because the height depends on how many lines each description
 * wraps to and a canvas has to be sized before anything can go into it.
 */
function drawAbilities(rows, width, scale, multipleCasters)
{
    const A = SHEET.ability;
    const iconBox = A.icon * scale;
    const rowPad = A.pad * scale;
    const gap = A.gap * scale;
    const textLeft = iconBox + gap;
    const casterWidth = multipleCasters ? width * 0.2 : 0;
    const textWidth = width - textLeft - rowPad * 2 - casterWidth;

    const scratch = document.createElement('canvas').getContext('2d');

    const measured = [];
    let height = 0;
    let lastPhase = null;

    for (const row of rows)
    {
        const heading = row.phaseLabel && row.phaseLabel !== lastPhase ? row.phaseLabel : '';

        lastPhase = row.phaseLabel;

        scratch.font = SHEET.font(A.body * scale);

        const description = wrap(scratch, row.spell.description || '', textWidth);
        const meta = [row.spell.castTime, row.spell.cooldown, row.spell.range, row.spell.cost]
            .filter(Boolean).join('  ·  ');

        const textHeight = A.name * scale * 1.35
            + (meta ? A.meta * scale * 1.4 : 0)
            + description.length * A.body * scale * 1.35;

        const rowHeight = Math.max(iconBox, textHeight) + rowPad * 2;
        const headingHeight = heading ? SHEET.section * scale * 2.2 : 0;

        measured.push({ ...row, description, meta, rowHeight, heading, headingHeight });
        height += rowHeight + headingHeight;
    }

    const canvas = document.createElement('canvas');

    canvas.width = Math.ceil(width);
    canvas.height = Math.ceil(height);

    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';

    let y = 0;

    for (const [index, row] of measured.entries())
    {
        if (row.heading)
        {
            /*
             * As typed, not shouted. The sheet's own headings are uppercase because they are the
             * program's words - ABILITIES, LOOT - but a phase is named and described by whoever
             * wrote the fight down, and "70% HEALTH" is not how they wrote it.
             */
            ctx.fillStyle = SHEET.accent;
            ctx.font = SHEET.font(SHEET.section * scale, 600);
            ctx.fillText(row.heading, 0, y + SHEET.section * scale * 0.6);

            y += row.headingHeight;
        }

        /* Alternating bands, as a tactics table has, so a long row is easy to follow across. */
        if (index % 2 === 0)
        {
            ctx.fillStyle = SHEET.panel;
            ctx.fillRect(0, y, width, row.rowHeight);
        }

        const top = y + rowPad;

        if (row.icon)
        {
            ctx.drawImage(row.icon, rowPad, top, iconBox, iconBox);
            ctx.strokeStyle = SHEET.line;
            ctx.lineWidth = Math.max(1, scale);
            ctx.strokeRect(rowPad, top, iconBox, iconBox);
        }

        let textY = top;

        ctx.fillStyle = SHEET.text;
        ctx.font = SHEET.font(A.name * scale, 600);
        ctx.fillText(row.spell.spellName || 'Unnamed ability', rowPad + textLeft, textY);

        /* Who casts it, when that is a question worth answering. */
        if (multipleCasters)
        {
            ctx.fillStyle = SHEET.muted;
            ctx.font = SHEET.font(A.meta * scale);
            ctx.textAlign = 'right';
            ctx.fillText([...new Set(row.casters)].join(', '), width - rowPad, textY + A.name * scale * 0.2);
            ctx.textAlign = 'left';
        }

        textY += A.name * scale * 1.35;

        if (row.meta)
        {
            ctx.fillStyle = SHEET.muted;
            ctx.font = SHEET.font(A.meta * scale);
            ctx.fillText(row.meta, rowPad + textLeft, textY);
            textY += A.meta * scale * 1.4;
        }

        ctx.fillStyle = SHEET.gold;
        ctx.font = SHEET.font(A.body * scale);

        for (const line of row.description)
        {
            ctx.fillText(line, rowPad + textLeft, textY);
            textY += A.body * scale * 1.35;
        }

        y += row.rowHeight;
    }

    return canvas;
}

/* -------------------------------------------------------------------- sections */

/** Each section's pieces, already drawn, ready to be flowed. */
async function sectionsFor(difficulty, scale, phaseId)
{
    const options = { ...view(), transparent: true };
    const npcs = difficulty.npcs || [];
    const sections = [];

    /* Creatures: the frames, which are the one piece whose look is the information. */
    const frames = [];

    for (const npc of npcs)
    {
        if (!npc.frame)
        {
            continue;
        }

        const portrait = await loadImage(npc.frame.portrait);

        frames.push(R.renderUnitFrame(
            pieceState('unit', npc.frame), { ...options, icon: portrait, maxWidth: 320 }, scale));
    }

    if (frames.length)
    {
        sections.push({ title: 'Creatures', pieces: frames });
    }

    const enrage = await enrageRow(difficulty);
    const abilities = await abilitiesOf(difficulty, phaseId);
    const rows = enrage ? [enrage, ...abilities] : abilities;

    if (rows.length)
    {
        sections.push({
            title: 'Abilities',
            pieces: [drawAbilities(rows, SHEET.content * scale, scale, npcs.length > 1)]
        });
    }

    /* A phase sheet stops there: loot and the rest belong to the fight, not to one phase. */
    if (phaseId !== undefined)
    {
        return sections;
    }

    const loot = [];

    for (const item of difficulty.loot || [])
    {
        const icon = await loadImage(item.icon ? iconUrl(item.icon) : '');

        loot.push(R.renderTooltip(
            M.buildLines(pieceState('item', item)),
            { ...options, icon, maxWidth: SHEET.lootWidth, iconPlacement: 'outside' },
            scale));
    }

    if (loot.length)
    {
        sections.push({ title: 'Loot', pieces: loot });
    }

    const achievements = [];

    for (const achievement of difficulty.achievements || [])
    {
        const icon = await loadImage(achievement.achIcon ? iconUrl(achievement.achIcon) : '');

        achievements.push(R.renderAchievement(
            pieceState('achievement', achievement), { ...options, icon }, scale));
    }

    if (achievements.length)
    {
        sections.push({ title: 'Achievements', pieces: achievements });
    }

    /*
     * The quotes are one section, and each block says which moment it is.
     *
     * The moment was briefly a gold section heading of its own, which made a fight with four sets
     * of lines read as four sections of the sheet rather than one - the gold is how the sheet names
     * Loot and Abilities, and a moment does not carry that weight. It sits on the block instead, in
     * the gray a line's trigger uses. A set saved before moments existed simply has nothing to say
     * there, and the section heading covers it.
     */
    const quotes = [];

    for (const lines of difficulty.lines || [])
    {
        quotes.push(R.renderChat(
            M.buildChatLines(pieceState('text', lines)),
            { ...options, maxWidth: 460, heading: (lines.label || '').trim() },
            scale));
    }

    if (quotes.length)
    {
        sections.push({ title: 'Encounter quotes', pieces: quotes });
    }

    return sections;
}

/* ---------------------------------------------------------------- composition */

/** Lays the sections out top to bottom, flowing each section's pieces left to right. */
function composeSections(sections, { boss, difficulty, raid, subtitle }, scale)
{
    if (!sections.length)
    {
        return null;
    }

    const pad = SHEET.pad * scale;
    const gap = SHEET.gap * scale;
    const headingHeight = SHEET.section * scale * 2.2;
    const content = SHEET.content * scale;

    const scratch = document.createElement('canvas').getContext('2d');
    const flavorSize = SHEET.section * scale * 1.2;

    scratch.font = SHEET.serif(flavorSize);

    const flavor = wrap(scratch, boss.note || '', content);

    /* Plan every row before drawing, so the canvas can be sized to what it will hold. */
    const plan = [];
    let y = pad + SHEET.title * scale * 1.5;

    if (flavor.length)
    {
        y += flavorSize * 0.6;
        plan.push({ kind: 'flavor', lines: flavor, y, size: flavorSize });
        y += flavor.length * flavorSize * 1.4 + flavorSize * 0.5;
    }

    for (const section of sections)
    {
        plan.push({ kind: 'heading', text: section.title, y });
        y += headingHeight;

        let x = pad;
        let rowHeight = 0;

        for (const piece of section.pieces)
        {
            /* Wrap when the next piece would run past the body width. */
            if (x > pad && x + piece.width > pad + content)
            {
                y += rowHeight + gap;
                x = pad;
                rowHeight = 0;
            }

            plan.push({ kind: 'piece', canvas: piece, x, y });

            x += piece.width + gap;
            rowHeight = Math.max(rowHeight, piece.height);
        }

        y += rowHeight + gap * 1.6;
    }

    const canvas = document.createElement('canvas');

    canvas.width = Math.ceil(pad * 2 + content);
    canvas.height = Math.ceil(y + pad - gap);

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = SHEET.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';

    const baseline = pad + SHEET.title * scale;

    ctx.fillStyle = SHEET.text;
    ctx.font = SHEET.font(SHEET.title * scale, 600);
    ctx.fillText(boss.name, pad, baseline);

    const nameWidth = ctx.measureText(boss.name).width;

    /* The size the fight is drawn at, slashed onto the name: "Festergut / 25 Normal". */
    const at = ` / ${difficulty.name}`;

    ctx.fillStyle = SHEET.accent;
    ctx.fillText(at, pad + nameWidth, baseline);

    if (subtitle)
    {
        const after = pad + nameWidth + ctx.measureText(at).width;

        ctx.fillStyle = SHEET.muted;
        ctx.font = SHEET.font(SHEET.section * scale * 1.3);
        ctx.fillText(`  ${subtitle}`, after, baseline);
    }

    ctx.fillStyle = SHEET.muted;
    ctx.font = SHEET.font(SHEET.section * scale);
    ctx.textAlign = 'right';
    ctx.fillText(raid.name, canvas.width - pad, baseline);
    ctx.textAlign = 'left';

    ctx.strokeStyle = SHEET.line;
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.moveTo(pad, pad + SHEET.title * scale * 1.25);
    ctx.lineTo(canvas.width - pad, pad + SHEET.title * scale * 1.25);
    ctx.stroke();

    ctx.textBaseline = 'top';

    for (const item of plan)
    {
        if (item.kind === 'flavor')
        {
            ctx.fillStyle = SHEET.accent;
            ctx.font = SHEET.serif(item.size);

            let lineY = item.y;

            for (const line of item.lines)
            {
                ctx.fillText(line, pad, lineY);
                lineY += item.size * 1.4;
            }
        }
        else if (item.kind === 'heading')
        {
            ctx.fillStyle = SHEET.accent;
            ctx.font = SHEET.font(SHEET.section * scale, 600);
            ctx.fillText(item.text.toUpperCase(), pad, item.y);
        }
        else
        {
            ctx.drawImage(item.canvas, item.x, item.y);
        }
    }

    return canvas;
}

const slug = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

function save(canvas, name)
{
    const link = document.createElement('a');

    link.download = name;
    link.href = canvas.toDataURL('image/png');
    link.click();
}

/** One sheet for a difficulty, or for one phase of it. */
async function buildBossSheet(raid, boss, difficulty, { phaseId, subtitle } = {}, scale = 2)
{
    await ensureFonts();
    const sections = await sectionsFor(difficulty, scale, phaseId);

    return composeSections(sections, { boss, difficulty, raid, subtitle }, scale);
}

/**
 * Draws and saves a boss's sheets.
 *
 * `mode` is 'all' for the whole difficulty on one picture, or 'phases' for one per phase.
 */
async function exportBossSheet(raid, boss, difficultyId, mode = 'all')
{
    const difficulty = (boss.difficulties || []).find((d) => d.id === difficultyId);

    if (!difficulty)
    {
        status('That difficulty has nothing in it yet.');
        return;
    }

    try
    {
        if (mode === 'phases')
        {
            const phases = [{ id: '', name: 'Unphased' }, ...(difficulty.phases || [])];
            const saved = [];

            for (const phase of phases)
            {
                const abilities = await abilitiesOf(difficulty, phase.id);

                /* A phase with no abilities in it is not worth a sheet of its own. */
                if (!abilities.length)
                {
                    continue;
                }

                const canvas = await buildBossSheet(raid, boss, difficulty,
                    { phaseId: phase.id, subtitle: phase.name }, 2);

                if (canvas)
                {
                    save(canvas, `${slug(boss.name)}-${difficultyId}-${slug(phase.name) || 'phase'}.png`);
                    saved.push(phase.name);
                }
            }

            status(saved.length
                ? `Saved ${saved.length} sheet${saved.length === 1 ? '' : 's'}: ${saved.join(', ')}`
                : 'No phases with abilities in them yet.');

            return;
        }

        const canvas = await buildBossSheet(raid, boss, difficulty, {}, 2);

        if (!canvas)
        {
            status('Nothing to draw yet - add a creature, an ability or some loot first.');
            return;
        }

        save(canvas, `${slug(boss.name) || 'boss'}-${difficultyId}.png`);
        status(`Saved ${slug(boss.name)}-${difficultyId}.png`);
    }
    catch (err)
    {
        status(`Could not draw that sheet: ${err.message}`);
    }
}

/* --------------------------------------------------------------- the raid sheet */

/**
 * The raid itself as a picture: its logo, its name, its description, and what is in it.
 *
 * A boss sheet answers "what is this fight"; this answers "what is this raid" — the thing handed
 * over first. The roster is a list rather than frames, because forty target frames is a poster.
 */
async function buildRaidSheet(raid, scale = 2)
{
    await ensureFonts();
    const pad = SHEET.pad * scale;
    const titleSize = SHEET.title * scale;
    const flavorSize = SHEET.section * scale * 1.2;
    const rowSize = SHEET.section * scale * 1.15;
    const logoSize = titleSize * 1.6;

    const scratch = document.createElement('canvas').getContext('2d');

    scratch.font = SHEET.serif(flavorSize);

    const flavor = wrap(scratch, raid.note || '', 900 * scale);
    const bosses = raid.bosses || [];

    const rows = bosses.map((boss) =>
    {
        const difficulties = (boss.difficulties || []).map((d) => d.name);
        const creatures = (boss.difficulties || []).reduce((n, d) => n + (d.npcs || []).length, 0);
        const loot = (boss.difficulties || []).reduce((n, d) => n + (d.loot || []).length, 0);

        const detail = [
            difficulties.join(' · '),
            creatures ? `${creatures} creature${creatures === 1 ? '' : 's'}` : '',
            loot ? `${loot} drop${loot === 1 ? '' : 's'}` : ''
        ].filter(Boolean).join('   ');

        return { name: boss.name, detail };
    });

    const rowHeight = rowSize * 2.6;
    const headerHeight = pad + Math.max(logoSize, titleSize * 1.4)
        + (flavor.length ? flavor.length * flavorSize * 1.4 + flavorSize : 0) + pad;

    scratch.font = SHEET.font(titleSize, 600);

    const canvas = document.createElement('canvas');

    canvas.width = Math.ceil(Math.max(1000 * scale,
        pad * 2 + logoSize + pad + scratch.measureText(raid.name).width));
    canvas.height = Math.ceil(headerHeight + rows.length * rowHeight + pad);

    const ctx = canvas.getContext('2d');

    ctx.fillStyle = SHEET.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.textBaseline = 'alphabetic';

    const logo = await loadImage(iconUrl(raid.icon || 'inv_misc_questionmark'));
    const textLeft = logo ? pad + logoSize + pad * 0.7 : pad;

    if (logo)
    {
        ctx.drawImage(logo, pad, pad, logoSize, logoSize);
        ctx.strokeStyle = SHEET.line;
        ctx.lineWidth = Math.max(1, scale);
        ctx.strokeRect(pad, pad, logoSize, logoSize);
    }

    ctx.fillStyle = SHEET.text;
    ctx.font = SHEET.font(titleSize, 600);
    ctx.fillText(raid.name, textLeft, pad + titleSize);

    ctx.fillStyle = SHEET.muted;
    ctx.font = SHEET.font(SHEET.section * scale);
    ctx.fillText(`${bosses.length} boss${bosses.length === 1 ? '' : 'es'}`, textLeft, pad + titleSize * 1.5);

    let y = pad + Math.max(logoSize, titleSize * 1.4) + flavorSize * 1.4;

    if (flavor.length)
    {
        ctx.fillStyle = SHEET.accent;
        ctx.font = SHEET.serif(flavorSize);

        for (const line of flavor)
        {
            ctx.fillText(line, pad, y);
            y += flavorSize * 1.4;
        }

        y += flavorSize * 0.6;
    }

    ctx.strokeStyle = SHEET.line;
    ctx.lineWidth = Math.max(1, scale);
    ctx.beginPath();
    ctx.moveTo(pad, y);
    ctx.lineTo(canvas.width - pad, y);
    ctx.stroke();

    y += rowSize * 1.8;

    for (const [index, row] of rows.entries())
    {
        ctx.fillStyle = SHEET.muted;
        ctx.font = SHEET.font(rowSize * 0.9);
        ctx.fillText(String(index + 1), pad, y);

        ctx.fillStyle = SHEET.text;
        ctx.font = SHEET.font(rowSize, 600);
        ctx.fillText(row.name, pad + rowSize * 2, y);

        if (row.detail)
        {
            ctx.fillStyle = SHEET.muted;
            ctx.font = SHEET.font(rowSize * 0.8);
            ctx.fillText(row.detail, pad + rowSize * 2, y + rowSize * 1.05);
        }

        y += rowHeight;
    }

    return canvas;
}

/** Draws the raid sheet and saves it. */
async function exportRaidSheet(raid)
{
    try
    {
        const canvas = await buildRaidSheet(raid, 2);
        const name = `${slug(raid.name) || 'raid'}.png`;

        save(canvas, name);
        status(`Saved ${name}`);
    }
    catch (err)
    {
        status(`Could not draw the raid sheet: ${err.message}`);
    }
}


/*
 * The order the kinds read in on a sheet: who is in the fight, what they cast, what drops, and
 * what it earns. The same order the boss sheets use, because it is the order the questions come in.
 */
const KIND_SECTIONS = [
    { kind: 'unit', title: 'Target frames' },
    { kind: 'spell', title: 'Spells' },
    { kind: 'item', title: 'Items' },
    { kind: 'achievement', title: 'Achievements' }
];

/**
 * Draws one saved thing, whatever kind it is.
 *
 * Each kind is drawn by the renderer its own window uses, so a spell on a mixed sheet is the spell
 * the Spell window would export — the sheet is an arrangement, never a second way of drawing.
 */
async function drawSaved(kind, fields, scale)
{
    const options = { ...view(), transparent: true };

    if (kind === 'achievement')
    {
        const icon = await loadImage(fields.achIcon ? iconUrl(fields.achIcon) : '');

        return R.renderAchievement(pieceState('achievement', fields), { ...options, icon }, scale);
    }

    if (kind === 'unit')
    {
        const portrait = await loadImage(fields.portrait);

        return R.renderUnitFrame(pieceState('unit', fields), { ...options, icon: portrait, maxWidth: 320 }, scale);
    }

    if (kind === 'spell')
    {
        const icon = await loadImage(fields.spellIcon ? iconUrl(fields.spellIcon) : '');

        return R.renderTooltip(M.buildLines(pieceState('spell', fields)),
            { ...options, icon, maxWidth: 300 }, scale);
    }

    const icon = await loadImage(fields.icon ? iconUrl(fields.icon) : '');

    return R.renderTooltip(M.buildLines(pieceState('item', fields)),
        { ...options, icon, maxWidth: SHEET.lootWidth, iconPlacement: 'outside' }, scale);
}


/* ---------------------------------------------------------------- a saved set */

/**
 * Everything saved of one kind, drawn as a single sheet.
 *
 * The same section layout the boss sheets use, with one section in it, and each entry drawn by the
 * renderer its own window uses — frames as frames, items five across at the narrow width,
 * achievement cards at their fixed size. A set is the unit most of the work is really
 * about: a tier set, a boss's drop table, the achievements for a wing.
 */
async function buildSetSheet(kind, entries, title, scale = 2)
{
    await ensureFonts();
    const pieces = [];

    for (const entry of entries)
    {
        pieces.push(await drawSaved(kind, entry.fields || entry, scale));
    }

    if (!pieces.length)
    {
        return null;
    }

    /*
     * The section is named for what the things are, not for the sheet — a sheet called "Icecrown
     * weapons" whose only section is also called "Icecrown weapons" says it twice.
     */
    const sectionTitle = (KIND_SECTIONS.find((entry) => entry.kind === kind) || {}).title
        || 'Saved';

    const canvas = composeSections(
        [{ title: sectionTitle, pieces }],
        {
            boss: { name: title, note: '' },
            difficulty: { name: `${entries.length} saved` },
            raid: { name: 'Astral' }
        },
        scale
    );

    return canvas;
}

/** Draws a saved set and saves it. */
async function exportSetSheet(kind, entries, title)
{
    try
    {
        const canvas = await buildSetSheet(kind, entries, title, 2);

        if (!canvas)
        {
            status('Nothing saved to draw yet.');
            return;
        }

        const name = `${slug(title) || 'saved'}.png`;

        save(canvas, name);
        status(`Saved ${name}`);
    }
    catch (err)
    {
        status(`Could not draw that sheet: ${err.message}`);
    }
}


/**
 * A sheet from a mixed selection.
 *
 * `selection` is { kind: [entries] }; empty kinds are left out rather than drawn as empty headings.
 */
async function buildMixedSheet(selection, title, scale = 2)
{
    await ensureFonts();
    const sections = [];
    let count = 0;

    for (const { kind, title: sectionTitle } of KIND_SECTIONS)
    {
        const entries = selection[kind] || [];

        if (!entries.length)
        {
            continue;
        }

        const pieces = [];

        for (const entry of entries)
        {
            pieces.push(await drawSaved(kind, entry.fields || entry, scale));
        }

        count += pieces.length;
        sections.push({ title: sectionTitle, pieces });
    }

    if (!sections.length)
    {
        return null;
    }

    return composeSections(sections, {
        boss: { name: title || 'Saved work', note: '' },
        difficulty: { name: `${count} piece${count === 1 ? '' : 's'}` },
        raid: { name: 'Astral' }
    }, scale);
}

/** Draws a mixed selection and saves it. */
async function exportMixedSheet(selection, title)
{
    try
    {
        const canvas = await buildMixedSheet(selection, title, 2);

        if (!canvas)
        {
            status('Nothing selected to draw.');
            return;
        }

        const name = `${slug(title) || 'sheet'}.png`;

        save(canvas, name);
        status(`Saved ${name}`);
    }
    catch (err)
    {
        status(`Could not draw that sheet: ${err.message}`);
    }
}

export { exportBossSheet, exportRaidSheet, exportSetSheet, exportMixedSheet };
