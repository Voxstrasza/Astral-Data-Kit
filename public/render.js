'use strict';

/*
 * Canvas renderer.
 *
 * The on-screen preview and the exported PNG go through this same function — the preview simply
 * draws at scale 1. That is deliberate: a CSS-styled preview plus a separate screenshot step
 * (what most tooltip creators do) always drifts from the file you actually download. Here they
 * cannot differ, and exporting at 2x/3x just re-runs the same layout at a bigger scale.
 */

const LAYOUT = {
    padding: 12,
    minWidth: 180,
    columnGap: 24,
    iconSize: 44,
    iconGap: 8,
    // Space between an outside icon and the tooltip frame.
    iconOutsideGap: 6,
    // The client's socket and coin textures are 16x16; drawn a touch smaller they sit better
    // against 13px body text without looking shrunken.
    socketBox: 15,
    socketGap: 5,
    coinSize: 13,
    coinGap: 3,
    moneyGap: 6,
    /*
     * Sizes taken from the client's own font objects rather than chosen by eye.
     *
     * GameTooltipHeaderText is Friz Quadrata at 14 and GameTooltipText at 12 — both resolved out
     * of FontStyles.xml, where the title inherits GameTooltipHeader (FRIZQT__.TTF, height 14) and
     * the body inherits Tooltip_Med (FRIZQT__.TTF, height 12).
     *
     * The leading is scaled with them, keeping the ratio the layout was tuned at.
     */
    titleSize: 14,
    bodySize: 12,
    titleLead: 19,
    bodyLead: 15,
    gapLead: 8,
    // WoW's tooltip wraps body text rather than growing without bound.
    defaultMaxWidth: 300
};

/*
 * WoW draws tooltips in Friz Quadrata throughout (GameTooltipText -> Tooltip_Med ->
 * FRIZQT__.TTF), not Arial — so the whole tooltip uses it, not just headings.
 *
 * The target frame is Friz Quadrata too, which is not the obvious answer. Arial Narrow is real but
 * it belongs to NumberFontNormal, and the target frame does not use it: TargetFrame.xml gives the
 * name and the level GameFontNormalSmall and the bar readouts TextStatusBarText, and all three
 * resolve to FRIZQT__.TTF at height 10. ARIALN.TTF appears on that frame only for buff and debuff
 * stack counts, which this program does not draw.
 *
 * Both families are still registered from the user's own client at startup (see loadGameFonts in
 * editor/icons.js). The fallbacks keep the app legible before they load, or with no client
 * configured.
 *
 * Sizes resolved from FontStyles.xml through the inherits chain:
 *
 *   GameTooltipHeaderText  -> GameTooltipHeader                  FRIZQT__.TTF  14
 *   GameTooltipText        -> Tooltip_Med                        FRIZQT__.TTF  12
 *   GameFontNormalSmall    -> SystemFont_Shadow_Small            FRIZQT__.TTF  10   shadow 1,-1
 *   TextStatusBarText      -> SystemFont_Outline_Small           FRIZQT__.TTF  10   outline
 *   NumberFontNormalSmall  -> NumberFont_OutlineThick_Mono_Small ARIALN.TTF    12
 */
const UNIT_FONT_SIZE = 10;

/*
 * The target frame's own colors, taken from the client rather than inferred from the art.
 *
 * The health bar is green for every unit — `UnitFrameHealthBar_Update` calls
 * `SetStatusBarColor(0.0, 1.0, 0.0)` and TargetFrame.lua never recolors its bars. Reaction is
 * carried by the tinted name background instead, which is the whole reason that texture is there.
 *
 * The name is gold because nothing recolors it: it keeps GameFontNormalSmall's own
 * `<Color r="1.0" g="0.82" b="0"/>`. The level text is set to the same gold explicitly, in
 * TargetFrame_CheckLevel.
 */
const UNIT_HEALTH_COLOR = '#00ff00';
const UNIT_NAME_COLOR = '#ffd100';

const FONTS = {
    title: (px) => `${px}px AstralGame, Georgia, "Times New Roman", serif`,
    body: (px) => `${px}px AstralGame, Georgia, "Times New Roman", serif`,
    /*
     * Flavor text is upright, not italic. WoW sets it apart by color — the gold of
     * GameFontNormal — and never by slant: the client ships a single FRIZQT__.TTF with no italic
     * face, so asking for one only got a synthesised oblique that the game never shows.
     */
    flavor: (px) => `${px}px AstralGame, Georgia, "Times New Roman", serif`,
    // Numbers on unit frames.
    number: (px) => `${px}px AstralNumber, "Arial Narrow", Arial, sans-serif`
};

function fontFor(kind, scale)
{
    if (kind === 'title')
    {
        return FONTS.title(LAYOUT.titleSize * scale);
    }

    if (kind === 'flavor')
    {
        return FONTS.flavor(LAYOUT.bodySize * scale);
    }

    return FONTS.body(LAYOUT.bodySize * scale);
}

function leadFor(kind, scale)
{
    if (kind === 'title')
    {
        return LAYOUT.titleLead * scale;
    }

    if (kind === 'gap')
    {
        return LAYOUT.gapLead * scale;
    }

    return LAYOUT.bodyLead * scale;
}

/** Greedy word wrap; returns at least one (possibly empty) segment. */
function wrapText(ctx, text, maxWidth)
{
    if (!text)
    {
        return [''];
    }

    const words = text.split(/\s+/);
    const out = [];
    let line = '';

    for (const word of words)
    {
        const candidate = line ? `${line} ${word}` : word;

        if (ctx.measureText(candidate).width <= maxWidth || !line)
        {
            line = candidate;
        }
        else
        {
            out.push(line);
            line = word;
        }
    }

    out.push(line);
    return out;
}

/** Width of a "Sell Price: 27[g] 5[s] 89[c]" run, icons included. */
function measureMoney(ctx, money, scale)
{
    let width = 0;

    for (const part of money)
    {
        width += LAYOUT.moneyGap * scale
            + ctx.measureText(String(part.amount)).width
            + LAYOUT.coinGap * scale
            + LAYOUT.coinSize * scale;
    }

    return width;
}

/**
 * Works out the tooltip width: wide enough for the longest line, capped at maxWidth so long
 * "Equip:" sentences wrap instead of stretching the frame into a ribbon.
 */
function measureWidth(ctx, lines, opts, scale)
{
    const cap = opts.maxWidth * scale;
    let widest = LAYOUT.minWidth * scale;

    for (const line of lines)
    {
        ctx.font = fontFor(line.kind, scale);

        let width = ctx.measureText(line.l || '').width;

        if (line.kind === 'socket')
        {
            width += (LAYOUT.socketBox + LAYOUT.socketGap) * scale;
        }

        if (line.kind === 'money')
        {
            width += measureMoney(ctx, line.money, scale);
        }

        if (line.r)
        {
            width += LAYOUT.columnGap * scale + ctx.measureText(line.r).width;
        }

        widest = Math.max(widest, width);
    }

    return Math.min(widest, cap);
}

/**
 * Lays out every line into draw commands. Runs before drawing so the canvas can be sized exactly,
 * and so text flows around the icon block at the top-left.
 */
function layout(ctx, lines, opts, scale)
{
    const pad = LAYOUT.padding * scale;
    const contentWidth = measureWidth(ctx, lines, opts, scale);
    const iconSpace = opts.icon ? (LAYOUT.iconSize + LAYOUT.iconGap) * scale : 0;
    const iconBottom = opts.icon ? pad + LAYOUT.iconSize * scale : 0;

    const commands = [];
    let y = pad;
    let widest = contentWidth;

    for (const line of lines)
    {
        const lead = leadFor(line.kind, scale);

        if (line.kind === 'gap')
        {
            y += lead;
            continue;
        }

        ctx.font = fontFor(line.kind, scale);

        // Lines that start beside the icon are indented; once past it they use the full width.
        const indent = y < iconBottom ? iconSpace : 0;

        // Money never wraps — it is a short run of number + coin pairs laid out left to right.
        if (line.kind === 'money')
        {
            let x = pad + indent;

            commands.push({ type: 'text', text: line.l, x, y, color: line.lc, kind: 'body' });
            x += ctx.measureText(line.l).width;

            for (const part of line.money)
            {
                x += LAYOUT.moneyGap * scale;
                const amount = String(part.amount);
                commands.push({ type: 'text', text: amount, x, y, color: line.lc, kind: 'body' });
                x += ctx.measureText(amount).width + LAYOUT.coinGap * scale;
                commands.push({ type: 'coin', coin: part.coin, x, y, scale });
                x += LAYOUT.coinSize * scale;
            }

            widest = Math.max(widest, Math.min(x - pad, contentWidth));
            y += lead;
            continue;
        }

        const socketIndent = line.kind === 'socket' ? (LAYOUT.socketBox + LAYOUT.socketGap) * scale : 0;
        const rightWidth = line.r ? ctx.measureText(line.r).width + LAYOUT.columnGap * scale : 0;
        const available = contentWidth - indent - socketIndent - rightWidth;

        const segments = wrapText(ctx, line.l || '', Math.max(available, 40 * scale));

        segments.forEach((segment, index) =>
        {
            const x = pad + indent + socketIndent;

            if (index === 0 && line.kind === 'socket')
            {
                commands.push({ type: 'socket', socket: line.socket, x: pad + indent, y, scale });
            }

            commands.push({ type: 'text', text: segment, x, y, color: line.lc, kind: line.kind });

            // The right column pairs with the first wrapped segment only.
            if (index === 0 && line.r)
            {
                commands.push({ type: 'text', text: line.r, x: pad + contentWidth, y, color: line.rc, kind: line.kind, align: 'right' });
            }

            const used = x - pad + ctx.measureText(segment).width + rightWidth;
            widest = Math.max(widest, Math.min(used, contentWidth));

            y += lead;
        });
    }

    // Never end shorter than the icon block, or the icon would hang out of the frame.
    y = Math.max(y, iconBottom);

    return { commands, width: pad * 2 + widest, height: y + pad };
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

/** Art extracted from the client, keyed by file name (see tools/extract-ui-art.js). */
function art(name)
{
    const assets = window.TooltipAssets || {};
    const image = assets[name];

    return image && image.complete && image.naturalWidth ? image : null;
}

const opaqueCenterCache = new Map();

/**
 * Where a texture's visible pixels actually sit inside its own bounds, as a fraction of size.
 *
 * The skull is padded asymmetrically inside its 32x32 texture, so drawing the texture centered
 * leaves the skull visibly off-center in the level ring — measured at roughly two pixels up and
 * to the right. Measuring the opaque bounds once and correcting by the difference fixes it for
 * any texture without hand-tuned offsets.
 */
function opaqueCenter(image, key)
{
    if (opaqueCenterCache.has(key))
    {
        return opaqueCenterCache.get(key);
    }

    let result = { dx: 0, dy: 0 };

    try
    {
        const probe = document.createElement('canvas');
        probe.width = image.naturalWidth;
        probe.height = image.naturalHeight;

        const ctx = probe.getContext('2d');
        ctx.drawImage(image, 0, 0);

        const data = ctx.getImageData(0, 0, probe.width, probe.height).data;
        let minX = probe.width, minY = probe.height, maxX = -1, maxY = -1;

        for (let y = 0; y < probe.height; y++)
        {
            for (let x = 0; x < probe.width; x++)
            {
                if (data[(y * probe.width + x) * 4 + 3] > 24)
                {
                    if (x < minX) { minX = x; }
                    if (y < minY) { minY = y; }
                    if (x > maxX) { maxX = x; }
                    if (y > maxY) { maxY = y; }
                }
            }
        }

        if (maxX >= 0)
        {
            // Offset of the visible center from the texture center, normalized to 0..1.
            result = {
                dx: ((minX + maxX) / 2 - (probe.width - 1) / 2) / probe.width,
                dy: ((minY + maxY) / 2 - (probe.height - 1) / 2) / probe.height
            };
        }
    }
    catch
    {
        // If the pixels cannot be read, drawing centered is still a reasonable approximation.
    }

    opaqueCenterCache.set(key, result);
    return result;
}

function drawSocket(ctx, cmd, scale)
{
    const size = LAYOUT.socketBox * scale;
    const def = window.TooltipModel.SOCKETS[cmd.socket];
    const y = cmd.y + (LAYOUT.bodySize * scale - size) / 2 + 1 * scale;
    const texture = def && art(def.art);

    if (texture)
    {
        ctx.drawImage(texture, cmd.x, y, size, size);
        return;
    }

    // Fallback if the extracted art is missing: a colored slot outline.
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeStyle = def ? def.color : '#808080';
    ctx.lineWidth = Math.max(1, 1.5 * scale);
    roundRect(ctx, cmd.x, y, size, size, 2 * scale);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
}

function drawCoin(ctx, cmd, scale)
{
    const size = LAYOUT.coinSize * scale;
    const y = cmd.y + (LAYOUT.bodySize * scale - size) / 2 + 1 * scale;
    const texture = art(cmd.coin);

    if (texture)
    {
        ctx.drawImage(texture, cmd.x, y, size, size);
    }
}

/**
 * Renders the tooltip and returns a fresh canvas.
 *
 * opts: { icon, iconPlacement: 'inside'|'outside'|'none', borderColor, transparent, maxWidth,
 *         background }
 *
 * 'outside' puts the icon in its own framed box to the left of the tooltip, top-aligned, the way
 * wotlkdb and Wowhead present items. 'inside' keeps it in the top-left corner with the first few
 * lines flowing around it.
 */
function renderTooltip(lines, opts, scale)
{
    scale = scale || 1;
    opts = opts || {};
    opts.maxWidth = opts.maxWidth || LAYOUT.defaultMaxWidth;

    const placement = opts.icon ? (opts.iconPlacement || 'inside') : 'none';

    // Only an inside icon reserves space within the text block.
    const planOpts = { ...opts, icon: placement === 'inside' ? opts.icon : null };

    // Measure on a scratch context first: the real canvas has to be sized before it can be drawn to.
    const scratch = document.createElement('canvas').getContext('2d');
    const plan = layout(scratch, lines, planOpts, scale);

    const iconBox = LAYOUT.iconSize * scale;
    const offsetX = placement === 'outside' ? iconBox + LAYOUT.iconOutsideGap * scale : 0;

    const boxWidth = Math.ceil(plan.width);
    const boxHeight = Math.ceil(plan.height);

    const canvas = document.createElement('canvas');
    canvas.width = boxWidth + offsetX;
    // An outside icon can be taller than a very short tooltip, so the canvas has to fit both.
    canvas.height = Math.max(boxHeight, placement === 'outside' ? Math.ceil(iconBox) : 0);

    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';

    if (!opts.transparent)
    {
        const gradient = ctx.createLinearGradient(0, 0, 0, boxHeight);
        gradient.addColorStop(0, opts.background || 'rgba(6,6,12,0.96)');
        gradient.addColorStop(1, opts.background || 'rgba(2,2,6,0.96)');
        ctx.fillStyle = gradient;
        roundRect(ctx, offsetX, 0, boxWidth, boxHeight, 4 * scale);
        ctx.fill();
    }

    if (opts.borderColor)
    {
        ctx.strokeStyle = opts.borderColor;
        ctx.lineWidth = Math.max(1, 2 * scale);
        roundRect(ctx, offsetX + ctx.lineWidth / 2, ctx.lineWidth / 2,
            boxWidth - ctx.lineWidth, boxHeight - ctx.lineWidth, 4 * scale);
        ctx.stroke();
    }

    if (placement === 'inside')
    {
        const pad = LAYOUT.padding * scale;

        ctx.drawImage(opts.icon, pad, pad, iconBox, iconBox);
        ctx.strokeStyle = 'rgba(0,0,0,0.85)';
        ctx.lineWidth = Math.max(1, 1 * scale);
        ctx.strokeRect(pad, pad, iconBox, iconBox);
    }
    else if (placement === 'outside')
    {
        // Framed to match the tooltip, so the pair reads as one object.
        ctx.drawImage(opts.icon, 0, 0, iconBox, iconBox);
        ctx.strokeStyle = opts.borderColor || 'rgba(0,0,0,0.85)';
        ctx.lineWidth = Math.max(1, 2 * scale);
        ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, iconBox - ctx.lineWidth, iconBox - ctx.lineWidth);
    }

    ctx.translate(offsetX, 0);

    for (const cmd of plan.commands)
    {
        if (cmd.type === 'socket')
        {
            drawSocket(ctx, cmd, scale);
            continue;
        }

        if (cmd.type === 'coin')
        {
            drawCoin(ctx, cmd, scale);
            continue;
        }

        ctx.font = fontFor(cmd.kind, scale);
        ctx.fillStyle = cmd.color || '#ffffff';
        ctx.textAlign = cmd.align === 'right' ? 'right' : 'left';
        ctx.fillText(cmd.text, cmd.x, cmd.y);
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.textAlign = 'left';
    return canvas;
}

/* ------------------------------------------------------------------------- unit frame */

/** Fills one bar slot: dark trough, colored portion, then a soft highlight along the top. */
/** Turns off the canvas shadow again, so it cannot leak into whatever is drawn next. */
function clearShadow(ctx)
{
    ctx.shadowColor = 'transparent';
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
}

/**
 * Draws text the way the client's OUTLINE font flag does.
 *
 * TextStatusBarText is SystemFont_Outline_Small — Friz Quadrata 10 with a black outline, which is
 * what keeps a health figure readable against a bright red or green bar. A canvas has no outline
 * flag, so the glyphs are stroked before they are filled.
 */
function drawOutlined(ctx, text, x, y, scale)
{
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2 * scale;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.strokeText(text, x, y);
    ctx.restore();
    ctx.fillText(text, x, y);
}

const tintCache = new Map();

/**
 * A client texture recolored, the way the game's SetVertexColor does it.
 *
 * The frame art is grayscale and gets its color at draw time — the name background is one
 * texture that the client tints red, yellow or green. Multiplying keeps the texture's own shading
 * instead of flattening it to a solid block, and the result is cached because a render redraws
 * this on every keystroke.
 */
function tinted(image, color, key)
{
    const id = `${key}|${color}`;

    if (tintCache.has(id))
    {
        return tintCache.get(id);
    }

    const canvas = document.createElement('canvas');
    canvas.width = image.width;
    canvas.height = image.height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(image, 0, 0);

    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Multiply ignores the alpha channel, so the texture's own transparency is put back.
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(image, 0, 0);

    tintCache.set(id, canvas);
    return canvas;
}

function drawBar(ctx, slot, fraction, color, scale)
{
    const x = slot.x * scale;
    const y = slot.y * scale;
    const w = slot.w * scale;
    const h = slot.h * scale;

    ctx.fillStyle = 'rgba(0,0,0,0.85)';
    ctx.fillRect(x, y, w, h);

    const filled = Math.max(0, Math.min(1, fraction)) * w;

    if (filled <= 0)
    {
        return;
    }

    ctx.fillStyle = color;
    ctx.fillRect(x, y, filled, h);

    // The in-game status bar texture is brighter along its upper edge.
    const sheen = ctx.createLinearGradient(0, y, 0, y + h);
    sheen.addColorStop(0, 'rgba(255,255,255,0.28)');
    sheen.addColorStop(0.5, 'rgba(255,255,255,0.06)');
    sheen.addColorStop(1, 'rgba(0,0,0,0.22)');
    ctx.fillStyle = sheen;
    ctx.fillRect(x, y, filled, h);
}

function fitText(ctx, text, maxWidth)
{
    if (ctx.measureText(text).width <= maxWidth)
    {
        return text;
    }

    let cut = text;

    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth)
    {
        cut = cut.slice(0, -1);
    }

    return `${cut}…`;
}

/**
 * Bar readout. Raid-boss pools run into the millions, which will not fit across a 113px bar,
 * so those get the abbreviated form the game uses in that situation.
 */
/**
 * Shortens one number exactly the way the client does.
 *
 * This is TextStatusBar_CapDisplayOfNumericValue from the client's own TextStatusBar.lua, which
 * works on the *digit count* and chops characters off the end:
 *
 *     strLen > 8  ->  sub(value, 1, -7) .. SECOND_NUMBER_CAP   (" M")
 *     strLen > 5  ->  sub(value, 1, -4) .. FIRST_NUMBER_CAP    (" K")
 *
 * Two things follow from that, and both differ from what this used to do.
 *
 * It truncates rather than rounding, and the suffixes carry a leading space — FIRST_NUMBER_CAP is
 * literally " K" in GlobalStrings.lua. And the M form does not begin at a million: nine digits are
 * needed, so a 2,200,000 pool reads "2200 K" in 3.3.5a and only 100,000,000 and up reaches "M".
 */
function capNumericValue(value)
{
    const text = String(Math.max(0, Math.floor(Number(value) || 0)));

    if (text.length > 8)
    {
        return `${text.slice(0, -6)} M`;
    }

    if (text.length > 5)
    {
        return `${text.slice(0, -3)} K`;
    }

    return text;
}

/**
 * The pair as the bar shows it.
 *
 * Each side is shortened on its own, which is the bug this replaces: picking the unit from the
 * maximum meant a 300,000 current out of a 2,200,000 pool rendered as "0.3M". The client caps
 * `value` and `valueMax` in two separate calls, so the same case reads "300 K / 2200 K".
 */
function formatUnitValue(current, max)
{
    return `${capNumericValue(current)} / ${capNumericValue(max)}`;
}

/**
 * Renders a WotLK target frame: portrait, health and power bars, name and level, wrapped in the
 * client's own border art for the chosen classification.
 */
function renderUnitFrame(state, opts, scale)
{
    scale = scale || 1;

    const M = window.TooltipModel;
    const G = M.UNIT_FRAME;
    const classification = M.lookup(M.UNIT_CLASSIFICATIONS, state.unitClassification);
    const reaction = M.lookup(M.UNIT_REACTIONS, state.unitReaction);
    const power = M.lookup(M.POWER_TYPES, state.unitPower);

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(G.crop.w * scale);
    canvas.height = Math.ceil(G.crop.h * scale);

    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'top';

    if (!opts.transparent)
    {
        ctx.fillStyle = opts.background || 'rgba(6,6,12,0.96)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 1. Portrait, clipped into the ring. Drawn before the border so the art frames it.
    if (opts.icon)
    {
        ctx.save();
        ctx.beginPath();
        ctx.arc(G.portrait.cx * scale, G.portrait.cy * scale, G.portrait.r * scale, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = '#000';
        ctx.fill();
        const size = G.portrait.r * 2 * scale;
        ctx.drawImage(opts.icon, (G.portrait.cx - G.portrait.r) * scale, (G.portrait.cy - G.portrait.r) * scale, size, size);
        ctx.restore();
    }

    // 2. Bars, sitting in the transparent slots the border art leaves open.
    const maxHealth = Math.max(1, Number(state.unitHealthMax) || 1);
    drawBar(ctx, G.health, (Number(state.unitHealth) || 0) / maxHealth, UNIT_HEALTH_COLOR, scale);

    if (power.value !== 'none')
    {
        const maxPower = Math.max(1, Number(state.unitPowerMax) || 1);
        drawBar(ctx, G.power, (Number(state.unitPowerCur) || 0) / maxPower, power.color, scale);
    }
    else
    {
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(G.power.x * scale, G.power.y * scale, G.power.w * scale, G.power.h * scale);
    }

    /*
     * 3. The name background, tinted by reaction.
     *
     * TargetFrame.lua does exactly this — `nameBackground:SetVertexColor(UnitSelectionColor(unit))`
     * over the UI-TargetingFrame-LevelBackground texture — so a hostile target reads red, a
     * neutral one yellow and a friendly one green. Drawn before the border so the frame's edges
     * sit on top of it, as with the bars.
     */
    const nameBg = art('unit-level-bg');

    if (nameBg)
    {
        ctx.drawImage(
            tinted(nameBg, reaction.color, 'unit-level-bg'),
            G.name.x * scale, G.name.y * scale, G.name.w * scale, G.name.h * scale
        );
    }
    else
    {
        ctx.fillStyle = reaction.color;
        ctx.fillRect(G.name.x * scale, G.name.y * scale, G.name.w * scale, G.name.h * scale);
    }

    // 4. The border art itself, cropped to the region that holds the frame.
    const border = art(classification.art);

    if (border)
    {
        ctx.drawImage(border, G.crop.x, G.crop.y, G.crop.w, G.crop.h, 0, 0, canvas.width, canvas.height);
    }

    /*
     * 5. The name itself, in white.
     *
     * TargetFrame.xml gives $parentName as GameFontNormalSmall — Friz Quadrata at 10 with a
     * 1,-1 black shadow, not Arial and not 11. The reaction color is carried by the background
     * behind it now, as in game: the client leaves this font at its default and never tints it.
     */
    ctx.font = FONTS.body(UNIT_FONT_SIZE * scale);
    ctx.fillStyle = UNIT_NAME_COLOR;
    // $parentName sets no justifyH, so it takes the XML default and centers over its background.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(0,0,0,0.9)';
    ctx.shadowOffsetX = scale;
    ctx.shadowOffsetY = scale;
    const name = fitText(ctx, state.unitName || 'Unit Name', (G.name.w - 8) * scale);
    ctx.fillText(name, (G.name.x + G.name.w / 2) * scale, (G.name.y + G.name.h / 2) * scale);
    ctx.textBaseline = 'top';
    clearShadow(ctx);

    /*
     * 6. Values on the bars — TextStatusBarText, so Friz Quadrata 10 with a black outline.
     *
     * Centered on the bar rather than sitting above it. The client's status bar is 12 tall against
     * the 7 of visible cut-out here, and its text is drawn on a layer above the frame art, so in
     * game the digits overlap the border — which is why they are outlined at all.
     */
    if (state.unitShowHealthText)
    {
        ctx.font = FONTS.body(UNIT_FONT_SIZE * scale);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        const health = fitText(ctx, formatUnitValue(Number(state.unitHealth) || 0, maxHealth), (G.health.w - 4) * scale);
        drawOutlined(ctx, health, (G.health.x + G.health.w / 2) * scale, (G.health.y + G.health.h / 2) * scale, scale);

        if (power.value !== 'none')
        {
            const maxPower = Math.max(1, Number(state.unitPowerMax) || 1);
            const text = fitText(ctx, formatUnitValue(Number(state.unitPowerCur) || 0, maxPower), (G.power.w - 4) * scale);
            drawOutlined(ctx, text, (G.power.x + G.power.w / 2) * scale, (G.power.y + G.power.h / 2) * scale, scale);
        }

        ctx.textBaseline = 'top';
    }

    // 7. Level badge: a skull for bosses, otherwise the number.
    ctx.textAlign = 'center';

    if (state.unitClassification === 'boss' || state.unitSkull)
    {
        const skull = art('unit-skull');

        if (skull)
        {
            const size = 19 * scale;
            const shift = opaqueCenter(skull, 'unit-skull');

            // Subtract the texture's own off-center bias so the skull, not its bounding box,
            // lands on the middle of the ring.
            ctx.drawImage(
                skull,
                (G.level.cx * scale) - size / 2 - shift.dx * size,
                (G.level.cy * scale) - size / 2 - shift.dy * size,
                size, size
            );
        }
    }
    else
    {
        // GameFontNormalSmall as well, and TargetFrame_CheckLevel sets it to this same gold.
        ctx.font = FONTS.body(UNIT_FONT_SIZE * scale);
        ctx.fillStyle = state.unitLevelColor || UNIT_NAME_COLOR;
        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowOffsetX = scale;
        ctx.shadowOffsetY = scale;

        /*
         * 'middle' centers the glyphs on the point given. Deriving the offset from
         * actualBoundingBoxAscent was tried and abandoned: the metric is not reliably populated
         * here, and treating a zero as real puts the baseline itself on the ring center, leaving
         * the number floating well above it.
         */
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(state.unitLevel ?? 80), G.level.cx * scale, G.level.cy * scale);
        ctx.textBaseline = 'top';
        clearShadow(ctx);
    }

    ctx.textAlign = 'left';
    return canvas;
}

/**
 * Draws one string with the 1,-1 black shadow every font on this card carries.
 *
 * All five achievement fonts declare the same shadow — SystemFont_Shadow_* by inheritance, and
 * AchievementDescriptionFont by writing its own out — so this is the default rather than a case.
 */
function achText(ctx, text, x, y, scale)
{
    ctx.shadowColor = 'rgba(0,0,0,1)';
    ctx.shadowOffsetX = scale;
    ctx.shadowOffsetY = scale;
    ctx.fillText(text, x, y);
    clearShadow(ctx);
}

/**
 * Shortens a criterion to the width of its column, with an ellipsis.
 *
 * The column was clipped instead, which cut a letter in half — "Sartharion the Onyx Gua" — and
 * read as a rendering fault rather than a shortened line. The client shortens the same way when a
 * criterion is wider than the space it has.
 */
function ellipsize(ctx, text, maxWidth)
{
    if (maxWidth <= 0 || ctx.measureText(text).width <= maxWidth)
    {
        return text;
    }

    let cut = text;

    while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth)
    {
        cut = cut.slice(0, -1);
    }

    return `${cut.replace(/s+$/, '')}…`;
}

/**
 * Renders a WotLK achievement card: parchment, title strip, icon in its ring, the points shield,
 * the description, the criteria list and the reward strip.
 *
 * The card is 434 wide and as tall as its contents make it, which is what the client does: the
 * 142 in AchievementTemplate is a default the Lua overwrites for every button. A card with no
 * criteria and a short description comes out at the collapsed 84, and one with four criteria over
 * two rows at 114 — drawing every card at 142 was what made them look fat.
 */
function renderAchievement(state, opts, scale)
{
    scale = scale || 1;

    const M = window.TooltipModel;
    const G = M.ACHIEVEMENT;
    const F = M.ACHIEVEMENT_FONTS;
    const COLORS = M.ACHIEVEMENT_COLORS;

    const earned = state.achEarned !== false;
    const points = Math.max(0, Number(state.achPoints) || 0);

    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(G.width * scale);

    const ctx = canvas.getContext('2d');
    const S = (n) => n * scale;

    /*
     * Everything the height depends on is measured first, because the canvas cannot be sized
     * until the height is known — and setting the height wipes the bitmap, so nothing may be
     * drawn before this block.
     */
    ctx.font = FONTS.body(F.description * scale);

    const descriptionLines = state.achDescription
        ? wrapText(ctx, state.achDescription, S(G.description.w))
        : [];

    const criteria = Array.isArray(state.achCriteria)
        ? state.achCriteria.filter((c) => c && c.text)
        : [];

    /*
     * How many columns the criteria fall into, by the client's own rule:
     *
     *   numColumns = floor(ACHIEVEMENTUI_MAXCONTENTWIDTH / maxCriteriaWidth)
     *
     * measured across every criterion, tick included. Taking it from the widest line rather than
     * from the space left under the description is what stops "Sartharion the Onyx Guardian"
     * being squeezed into half a card; a "Glory of..." full of short boss names still columns up.
     */
    ctx.font = FONTS.body(F.criteria * scale);

    const O = G.objectives;
    let columns = 1;

    if (criteria.length > 1)
    {
        const widest = criteria.reduce(
            (max, c) => Math.max(max, ctx.measureText(c.text).width / scale + O.check.w),
            1
        );

        columns = Math.max(1, Math.min(criteria.length, Math.floor(G.contentWidth / widest)));
    }

    const rows = Math.ceil(criteria.length / columns);
    const objectivesHeight = rows * O.rowHeight;

    /* $parentObjectives hangs 8 below the description, however many lines that ran to. */
    const objectivesTop = G.description.y + descriptionLines.length * G.description.lineHeight + O.gap;

    /*
     * The height the game would give this card. No criteria and a description inside the
     * collapsed box leaves it at exactly the 84 the achievement list uses.
     */
    let height = G.collapsedHeight;

    if (objectivesHeight > 0 || descriptionLines.length > G.maxLinesCollapsed)
    {
        height = G.collapsedHeight
            + objectivesHeight
            + descriptionLines.length * G.description.lineHeight
            - G.descriptionHeight
            + (state.achReward ? 4 : 0);
    }

    canvas.height = Math.ceil(height * scale);

    ctx.textBaseline = 'top';

    if (!opts.transparent)
    {
        ctx.fillStyle = opts.background || 'rgba(6,6,12,0.96)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    /*
     * 1. The parchment.
     *
     * An unearned achievement uses the desaturated copy of the texture rather than a filter over
     * the colored one — the client ships both, so there is nothing to approximate.
     */
    const parchment = art(earned ? 'ach-parchment' : 'ach-parchment-desaturated')
        || art('ach-parchment');

    const inset = G.background.inset;
    const backgroundWidth = G.width - inset * 2;
    const backgroundHeight = height - inset * 2;

    if (parchment)
    {
        // The card shows the bottom of the texture, taking more of it the taller it gets.
        const top = Math.max(0, 1 - height / G.background.textureHeight);

        ctx.drawImage(
            parchment,
            0, parchment.naturalHeight * top,
            parchment.naturalWidth, parchment.naturalHeight * (1 - top),
            S(inset), S(inset), S(backgroundWidth), S(backgroundHeight)
        );
    }
    else
    {
        ctx.fillStyle = '#3a2d1c';
        ctx.fillRect(S(inset), S(inset), S(backgroundWidth), S(backgroundHeight));
    }

    /*
     * 2. The edge glow. Four corners plus a run along the top and bottom, all at low alpha —
     * subtle enough to be easy to leave out, and its absence is why a first attempt at this card
     * looked flat against a screenshot.
     */
    const corners = art('ach-tsunami-corners');
    const run = art('ach-tsunami-horizontal');
    const T = G.tsunami;

    if (corners && run)
    {
        ctx.save();
        const half = corners.naturalWidth / 2;

        // The sheet holds two corners; the bottom pair are the sheet as-is, the top pair flipped.
        const drawCorner = (sx, x, y, flipX, flipY) =>
        {
            ctx.save();
            ctx.translate(x + (flipX ? S(T.corner) : 0), y + (flipY ? S(T.corner) : 0));
            ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
            ctx.drawImage(corners, sx, 0, half, corners.naturalHeight, 0, 0, S(T.corner), S(T.corner));
            ctx.restore();
        };

        const bottomY = S(height - T.corner + 2);
        const topY = S(T.topInset - T.corner + 2);

        ctx.globalAlpha = T.alpha.corner * 2;
        drawCorner(0, S(-2), bottomY, false, false);
        drawCorner(half, S(G.width - T.corner + 2), bottomY, false, false);

        ctx.globalAlpha = T.alpha.corner;
        drawCorner(0, S(-2), topY, false, true);
        drawCorner(half, S(G.width - T.corner + 2), topY, false, true);

        ctx.globalAlpha = T.alpha.run;
        const runX = S(-2 + T.corner);
        const runW = S(G.width + 4 - T.corner * 2);
        ctx.drawImage(run, runX, S(height - 16 + 2), runW, S(16));
        ctx.save();
        ctx.translate(runX, S(T.topInset - 16 + 2 + 16));
        ctx.scale(1, -1);
        ctx.drawImage(run, 0, 0, runW, S(16));
        ctx.restore();

        ctx.restore();
    }

    /* 3. The title strip, cropped out of its sheet and drawn at the alpha the XML asks for. */
    const titleArt = art('ach-title');

    if (titleArt)
    {
        ctx.save();
        ctx.globalAlpha = G.title.alpha;
        ctx.drawImage(
            titleArt,
            0, 0,
            titleArt.naturalWidth * G.title.crop.w, titleArt.naturalHeight * G.title.crop.h,
            S(G.title.x), S(G.title.y), S(G.title.w), S(G.title.h)
        );
        ctx.restore();
    }

    /* 4. The icon, then its ring over the top — the ring is bigger than the icon and masks it. */
    if (opts.icon)
    {
        const size = S(G.icon.size);
        ctx.drawImage(opts.icon, S(G.icon.cx) - size / 2, S(G.icon.cy + G.icon.dy) - size / 2, size, size);
    }

    const ring = art('ach-iconframe');

    if (ring)
    {
        const size = S(G.iconRing.size);
        const crop = G.iconRing.crop;

        ctx.drawImage(
            ring,
            0, 0, ring.naturalWidth * crop, ring.naturalHeight * crop,
            S(G.iconRing.cx) - size / 2, S(G.iconRing.cy) - size / 2, size, size
        );
    }

    /*
     * 5. The points shield.
     *
     * UI-Achievement-Shields is one texture holding two shields side by side: earned on the left,
     * unearned on the right. A zero-point achievement — every Feat of Strength — uses the
     * -NoPoints sheet instead, which is the same shield without the space for a number.
     */
    const shieldArt = art(points > 0 ? 'ach-shields' : 'ach-shields-nopoints') || art('ach-shields');

    if (shieldArt)
    {
        const half = shieldArt.naturalWidth / 2;

        ctx.drawImage(
            shieldArt,
            earned ? 0 : half, 0, half, shieldArt.naturalHeight,
            S(G.shield.x), S(G.shield.y), S(G.shield.w), S(G.shield.h)
        );
    }

    if (points > 0)
    {
        const label = String(points);

        ctx.font = FONTS.title(F.points * scale);
        // An unearned achievement grays its points out, as the shield beside them is grayed.
        ctx.fillStyle = earned ? COLORS.points : 'rgba(150,150,150,1)';
        ctx.textAlign = 'center';

        /*
         * Centered on the digits, not on the em box.
         *
         * textBaseline 'middle' centers the font's whole em square — ascender, descender and all —
         * and a number has no descender to fill the bottom of it, so the digits were being pushed
         * visibly low in the shield. Measuring the glyphs and centring those puts the number where
         * the eye expects it.
         */
        // The baseline has to be set before measuring: the bounds come back relative to it.
        ctx.textBaseline = 'alphabetic';

        const metrics = ctx.measureText(label);
        const ink = (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;

        achText(ctx, label, S(G.points.cx), S(G.points.cy) + ink, scale);
        ctx.textBaseline = 'top';
    }

    /* 6. The title, centered on its strip. Clipped rather than wrapped: the strip is one line. */
    ctx.font = FONTS.title(F.title * scale);
    ctx.fillStyle = COLORS.title;
    ctx.textAlign = 'center';

    if (state.achTitle)
    {
        ctx.save();
        ctx.beginPath();
        ctx.rect(S(G.label.cx - G.label.w / 2), S(G.label.y), S(G.label.w), S(G.label.h));
        ctx.clip();
        achText(ctx, state.achTitle, S(G.label.cx), S(G.label.y + 4), scale);
        ctx.restore();
    }

    /* 7. The description, centered and wrapped; its lines were measured above. */
    ctx.font = FONTS.body(F.description * scale);
    ctx.fillStyle = COLORS.description;
    ctx.textAlign = 'center';

    descriptionLines.forEach((line, index) =>
    {
        const lineY = G.description.y + index * G.description.lineHeight;
        achText(ctx, line, S(G.description.cx), S(lineY), scale);
    });

    /*
     * 8. The criteria, in the objectives box between the icon and the shield.
     *
     * Filled across and then down, one column at a time being what a first version did and the
     * opposite of what AchievementObjectives_DisplayCriteria does — the game walks the list left
     * to right, wrapping to a new row when it runs out of columns.
     */
    if (criteria.length)
    {
        const columnWidth = G.contentWidth / columns;
        const textWidth = columnWidth - O.check.w - 4;

        ctx.font = FONTS.body(F.criteria * scale);
        ctx.textAlign = 'left';

        const check = art('ach-criteria-check');

        criteria.forEach((criterion, index) =>
        {
            const x = O.x + (index % columns) * columnWidth;
            const rowY = objectivesTop + Math.floor(index / columns) * O.rowHeight;
            const met = criterion.done !== false;

            /*
             * The tick is only drawn for a met criterion. The client's own list does the same and
             * indents every row by the tick's width regardless, so met and unmet line up.
             */
            if (met && check)
            {
                ctx.drawImage(check, S(x), S(rowY), S(O.check.w * 0.8), S(O.check.h * 0.8));
            }

            ctx.fillStyle = met ? COLORS.criteria : COLORS.criteriaPending;
            achText(ctx, ellipsize(ctx, criterion.text, S(textWidth)), S(x + O.check.w), S(rowY + 1), scale);
        });
    }

    /*
     * 9. The reward strip. Hidden unless there is reward text, exactly as $parentRewardBackground
     * is: an achievement with no reward shows no strip at all rather than an empty one.
     */
    if (state.achReward)
    {
        const rewardArt = art('ach-reward-bg');

        if (rewardArt)
        {
            ctx.drawImage(
                rewardArt,
                0, 0,
                rewardArt.naturalWidth * G.reward.crop.w, rewardArt.naturalHeight * G.reward.crop.h,
                S(G.reward.x), S(height - G.reward.fromBottom), S(G.reward.w), S(G.reward.h)
            );
        }

        ctx.font = FONTS.body(F.reward * scale);
        ctx.fillStyle = COLORS.reward;
        ctx.textAlign = 'center';

        ctx.save();
        ctx.beginPath();
        ctx.rect(S(G.reward.x), S(height - G.reward.fromBottom), S(G.reward.w), S(G.reward.h));
        ctx.clip();
        achText(ctx, state.achReward, S(G.rewardText.cx), S(height - G.rewardText.fromBottom), scale);
        ctx.restore();
    }

    ctx.textAlign = 'left';
    return canvas;
}


/* ------------------------------------------------------------------------------- chat log */

/*
 * The chat frame's own measurements.
 *
 * The game's default chat font is the same face the tooltips use at 14px with a shadow under it,
 * and a wrapped line indents to sit under the start of the text rather than under the name — so a
 * long yell reads as one paragraph instead of a column of names.
 */
const CHAT = {
    fontSize: 14,
    lineGap: 4,
    padding: 10,
    indent: 0,
    shadow: 'rgba(0, 0, 0, 0.9)'
};

/**
 * Draws a run of chat lines as the frame would print them.
 *
 * Each line carries its own color, which is the whole point of the window: a say, a yell and an
 * emote are three different colors in game, and a script written down in one color loses the
 * thing that makes it readable.
 */
function renderChat(lines, opts, scale)
{
    scale = scale || 1;
    opts = opts || {};

    const size = CHAT.fontSize * scale;
    const font = FONTS.body(size);
    const maxWidth = (opts.maxWidth || 420) * scale;
    const padding = CHAT.padding * scale;
    const gap = CHAT.lineGap * scale;

    /* Measure first: the canvas has to be sized before anything can be drawn into it. */
    const scratch = document.createElement('canvas').getContext('2d');
    scratch.font = font;

    const wrapped = [];

    for (const line of lines)
    {
        /*
         * The trigger is the program's own annotation rather than something the game prints, so it
         * sits in front of the quote in muted gray and leaves the line's own color alone.
         */
        if (line.trigger)
        {
            wrapped.push({ text: line.trigger, color: '#8992ab', small: true });
        }

        const words = String(line.text || '').split(/\s+/).filter(Boolean);
        let current = '';

        for (const word of words)
        {
            const candidate = current ? `${current} ${word}` : word;

            if (scratch.measureText(candidate).width > maxWidth && current)
            {
                wrapped.push({ text: current, color: line.color });
                current = word;
            }
            else
            {
                current = candidate;
            }
        }

        wrapped.push({ text: current, color: line.color });
    }

    const width = Math.ceil(Math.min(
        maxWidth,
        Math.max(1, ...wrapped.map((line) => scratch.measureText(line.text).width))
    ) + padding * 2);

    const height = Math.ceil(wrapped.reduce((total, line) =>
        total + (line.small ? size * 0.95 : size) + gap, 0) - gap + padding * 2);

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');

    /*
     * The chat frame's background is the window behind it, so transparent is the honest default
     * and the opaque option paints the same near-black the rest of the app exports on.
     */
    if (!opts.transparent)
    {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.72)';
        ctx.fillRect(0, 0, width, height);
    }

    ctx.font = font;
    ctx.textBaseline = 'top';

    let y = padding;

    for (const line of wrapped)
    {
        ctx.font = line.small ? FONTS.body(size * 0.82) : font;

        /* The game draws chat with a hard shadow one pixel down and right; without it, pale
           yellow on a light screenshot is unreadable. */
        ctx.fillStyle = CHAT.shadow;
        ctx.fillText(line.text, padding + scale, y + scale);

        ctx.fillStyle = line.color || '#ffffff';
        ctx.fillText(line.text, padding, y);

        y += (line.small ? size * 0.95 : size) + gap;
    }

    return canvas;
}

window.TooltipRenderer = { renderTooltip, renderUnitFrame, renderAchievement, renderChat, LAYOUT };
