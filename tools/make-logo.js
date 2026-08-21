'use strict';

/*
 * Draws the Astral wordmark and its medallion, and writes both as PNGs.
 *
 * Everything here is drawn, not painted. Blizzard's expansion logos are illustrated metal with
 * hand-worked highlights; this reaches for the same silhouette — an arched heavy serif in gold
 * over a dark outline, with a subtitle bar beneath — using gradients and strokes. It reads as the
 * same family without pretending to be the same craft.
 *
 * Rendered through Electron because that gives a real canvas with real font shaping. Georgia is
 * the face rather than the client's Friz Quadrata: FRIZQT__.TTF is Blizzard's, this program is
 * careful never to redistribute it, and a logo baked from its glyphs would ship inside the exe.
 *
 *   npm run logo
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const WORDMARK = path.join(ROOT, 'public', 'logo.png');
const MARK = path.join(ROOT, 'art', 'astral-mark.png');

/* Gold, dark to light to dark, the way a bevelled face catches light across its height. */
const GOLD = [
    [0.00, '#6b4a10'],
    [0.18, '#c9962e'],
    [0.42, '#ffe9a8'],
    [0.55, '#f7d264'],
    [0.78, '#b9821f'],
    [1.00, '#5e3f0c']
];

const OUTLINE = '#1a1206';

const SCRIPT = `(async () => {
    await document.fonts.ready;

    const GOLD = ${JSON.stringify(GOLD)};
    const OUTLINE = ${JSON.stringify(OUTLINE)};

    const gold = (ctx, top, bottom) => {
        const g = ctx.createLinearGradient(0, top, 0, bottom);
        for (const [stop, color] of GOLD) { g.addColorStop(stop, color); }
        return g;
    };

    /*
     * Lays text along a shallow arc, the way the expansion logos curve their titles.
     *
     * Each glyph is placed by its share of the total width rather than by a fixed angle per
     * character, so an "I" does not claim the same arc as a "W" and the spacing stays even.
     */
    const arched = (ctx, text, cx, baseY, radius, spread, paint) => {
        const chars = [...text];
        const widths = chars.map((c) => ctx.measureText(c).width);
        const total = widths.reduce((a, b) => a + b, 0);
        let angle = -spread / 2;

        for (let i = 0; i < chars.length; i++) {
            const step = spread * (widths[i] / total);
            const a = angle + step / 2;

            ctx.save();
            ctx.translate(cx + Math.sin(a) * radius, baseY + radius - Math.cos(a) * radius);
            ctx.rotate(a);
            paint(chars[i], 0, 0);
            ctx.restore();

            angle += step;
        }
    };

    /* ------------------------------------------------------------------ wordmark */

    const W = 1100;
    const H = 340;

    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const ctx = c.getContext('2d');

    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    const TITLE = 100;
    ctx.font = 'bold ' + TITLE + 'px Georgia, "Times New Roman", serif';

    /*
     * Tracked apart before anything else is decided.
     *
     * A heavy serif at this size with an 18px outline on each glyph merges into a solid bar —
     * the first attempt ran the A into the S and lost the word. The letters need room for their
     * own outline before the arc closes them up further.
     */
    ctx.letterSpacing = '16px';

    const cx = W / 2;
    const baseY = 140;
    const radius = 1150;
    const spread = 0.26;

    /*
     * One outline pass, carrying its own shadow.
     *
     * Two passes plus a separate blurred halo stacked into a grey cloud over the letter tops,
     * which read as dull pewter rather than gold. The gradient underneath was fine; it was being
     * covered up.
     */
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 5;
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 15;
    arched(ctx, 'ASTRAL', cx, baseY, radius, spread, (ch, x, y) => ctx.strokeText(ch, x, y));
    ctx.restore();

    // 3. The gold face.
    ctx.fillStyle = gold(ctx, baseY - TITLE, baseY + 14);
    arched(ctx, 'ASTRAL', cx, baseY, radius, spread, (ch, x, y) => ctx.fillText(ch, x, y));

    // 4. A narrow highlight across the upper third, which is what sells it as metal.
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const sheen = ctx.createLinearGradient(0, baseY - TITLE, 0, baseY + 10);
    sheen.addColorStop(0.00, 'rgba(255,255,255,0.00)');
    sheen.addColorStop(0.26, 'rgba(255,255,255,0.42)');
    sheen.addColorStop(0.40, 'rgba(255,255,255,0.00)');
    sheen.addColorStop(1.00, 'rgba(255,255,255,0.00)');
    ctx.fillStyle = sheen;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    ctx.letterSpacing = '0px';

    /* The rule and subtitle beneath, the way the expansions hang their subtitle off the title. */
    const ruleY = 196;
    const ruleHalf = 288;

    const drawRule = () => {
        ctx.save();
        ctx.strokeStyle = gold(ctx, ruleY - 4, ruleY + 4);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(cx - ruleHalf, ruleY);
        ctx.lineTo(cx + ruleHalf, ruleY);
        ctx.stroke();

        // Diamond finials at each end.
        for (const dx of [-ruleHalf, ruleHalf]) {
            ctx.beginPath();
            ctx.moveTo(cx + dx, ruleY - 9);
            ctx.lineTo(cx + dx + 9, ruleY);
            ctx.lineTo(cx + dx, ruleY + 9);
            ctx.lineTo(cx + dx - 9, ruleY);
            ctx.closePath();
            ctx.fillStyle = gold(ctx, ruleY - 9, ruleY + 9);
            ctx.fill();
        }
        ctx.restore();
    };

    drawRule();

    const SUB = 34;
    ctx.font = 'bold ' + SUB + 'px Georgia, "Times New Roman", serif';
    ctx.letterSpacing = '10px';

    const subY = 252;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 8;
    ctx.strokeText('3.3.5a DATA KIT', cx, subY);
    ctx.fillStyle = gold(ctx, subY - SUB, subY + 6);
    ctx.fillText('3.3.5a DATA KIT', cx, subY);
    ctx.letterSpacing = '0px';

    /* ------------------------------------------------------------------ medallion */

    const S = 512;
    const m = document.createElement('canvas');
    m.width = S; m.height = S;
    const mx = m.getContext('2d');

    const mid = S / 2;

    // Deep field, lit from the centre.
    const field = mx.createRadialGradient(mid, mid * 0.85, 20, mid, mid, mid);
    field.addColorStop(0, '#1d2b4a');
    field.addColorStop(0.55, '#0d1524');
    field.addColorStop(1, '#05080f');
    mx.beginPath();
    mx.arc(mid, mid, mid - 26, 0, Math.PI * 2);
    mx.fillStyle = field;
    mx.fill();

    // Gold ring.
    const ring = mx.createLinearGradient(0, 40, 0, S - 40);
    for (const [stop, color] of GOLD) { ring.addColorStop(stop, color); }
    mx.lineWidth = 22;
    mx.strokeStyle = ring;
    mx.stroke();

    mx.beginPath();
    mx.arc(mid, mid, mid - 48, 0, Math.PI * 2);
    mx.lineWidth = 3;
    mx.strokeStyle = 'rgba(255,233,168,0.45)';
    mx.stroke();

    /*
     * A four-pointed star with drawn-in waists — the astral mark.
     *
     * Built from quadratic curves rather than straight lines so the points taper the way a
     * celestial sparkle does instead of reading as a plus sign.
     */
    /*
     * Each point tapers into the waist from both sides.
     *
     * Curving straight from one tip to the next inner corner sweeps every edge the same way round
     * and the star comes out as a pinwheel. Drawing inner corner -> tip -> inner corner, with both
     * curves pulled toward the centre, keeps each point symmetric about its own axis.
     */
    const star = (cxs, cys, outer, inner, rotation) => {
        mx.save();
        mx.translate(cxs, cys);
        mx.rotate(rotation || 0);
        mx.beginPath();

        const at = (angle, r) => [Math.cos(angle) * r, Math.sin(angle) * r];

        for (let i = 0; i < 4; i++) {
            const a = (i * Math.PI) / 2;
            const [px, py] = at(a - Math.PI / 4, inner);
            const [ox, oy] = at(a, outer);
            const [nx, ny] = at(a + Math.PI / 4, inner);

            // Control points sit near the middle, which is what pinches the waist.
            const [c1x, c1y] = at(a - Math.PI / 8, inner * 0.30);
            const [c2x, c2y] = at(a + Math.PI / 8, inner * 0.30);

            if (i === 0) { mx.moveTo(px, py); } else { mx.lineTo(px, py); }
            mx.quadraticCurveTo(c1x, c1y, ox, oy);
            mx.quadraticCurveTo(c2x, c2y, nx, ny);
        }

        mx.closePath();
        mx.restore();
    };

    mx.save();
    mx.shadowColor = 'rgba(120,190,255,0.85)';
    mx.shadowBlur = 44;
    star(mid, mid, 168, 86, Math.PI / 4);
    const starFill = mx.createLinearGradient(0, mid - 168, 0, mid + 168);
    starFill.addColorStop(0.00, '#ffffff');
    starFill.addColorStop(0.35, '#ffe9a8');
    starFill.addColorStop(0.62, '#f0c040');
    starFill.addColorStop(1.00, '#a86f16');
    mx.fillStyle = starFill;
    mx.fill();
    mx.restore();

    mx.lineWidth = 5;
    mx.strokeStyle = OUTLINE;
    star(mid, mid, 168, 86, Math.PI / 4);
    mx.stroke();

    /*
     * A slim glint on the same axes, not rotated against them.
     *
     * Offsetting it by 45 degrees put a second set of points between the first and made the mark
     * read as an eight-pointed burst at small sizes.
     */
    mx.save();
    mx.globalAlpha = 0.55;
    star(mid, mid, 150, 20, Math.PI / 4);
    mx.fillStyle = 'rgba(255,255,255,0.9)';
    mx.fill();
    mx.restore();

    return { wordmark: c.toDataURL('image/png'), mark: m.toDataURL('image/png') };
})()`;

app.disableHardwareAcceleration();

app.whenReady().then(async () =>
{
    const win = new BrowserWindow({ width: 1200, height: 700, show: false });
    await win.loadURL('data:text/html,<body style="margin:0"></body>');

    const out = await win.webContents.executeJavaScript(SCRIPT);

    const write = (file, dataUrl) =>
    {
        const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, bytes);
        console.log(`wrote ${file} (${(bytes.length / 1024).toFixed(0)} KB)`);
    };

    write(WORDMARK, out.wordmark);
    write(MARK, out.mark);

    console.log('\nNext: node tools/make-icon.js art/astral-mark.png   # -> build/icon.ico');

    app.exit(0);
});

setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, 40000);
