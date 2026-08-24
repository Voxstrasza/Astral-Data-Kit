'use strict';

/*
 * Keeps art/roadmap.png in step with ROADMAP.md: stamps COMPLETE across the cards that are now
 * built, and appends cards for ideas added since the picture was rendered.
 *
 * The picture is a render, not something this repo generates, so everything here is composited on
 * top of it. What it composites *from* is art/roadmap-base.png, which is created from the current
 * roadmap.png the first time this runs and never written to again — without a fixed baseline this
 * would stamp the stamps on a second run, since the output is the same file as the input.
 *
 * The baseline was itself made from an already-stamped picture: cards 5 and 6 were burned in
 * before this tool kept a source copy, which is why DONE below starts at 7 rather than listing
 * every finished card.
 *
 *   node tools/stamp-roadmap.js
 */

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const BASE = path.join(ROOT, 'art', 'roadmap-base.png');
const OUT = path.join(ROOT, 'art', 'roadmap.png');

/*
 * The copy the program itself shows at the foot of its Home page. public/ is what ships — art/
 * is not in APP_CONTENTS — so the picture has to be written to both or the packaged app keeps
 * showing the roadmap as it was the day it was built.
 */
const APP_OUT = path.join(ROOT, 'public', 'roadmap.png');

/*
 * Card boxes in the image's own 3200-pixel width, measured off the render.
 *
 * 4 — Raid wizard: raids as documents, bosses with difficulties, phases and abilities, and the
 *     sheet they draw as. Shipped in 1.5.
 * 7 — Achievement creator: the Achievement window, its finder and the card renderer.
 */
const DONE = [
    { label: '4', x0: 1087, y0: 1222, x1: 2034, y1: 1960 },
    { label: '7', x0: 1090, y0: 2001, x1: 3026, y1: 3079 }
];

/*
 * Ideas added to ROADMAP.md after the picture was rendered, drawn in its own style rather than
 * left out of it. Each one extends the canvas downwards and pushes the footer ahead of it.
 */
const NEW_CARDS = [
    {
        number: '8',
        title: 'Texts',
        complete: true,
        height: 470,
        body: [
            'Plan what a creature says and does across an encounter: the text lines it speaks and the',
            'emotes it performs, in the order they happen — a fight’s script written as a whole rather',
            'than a line at a time.'
        ],
        /* A chat frame, in the colors the game prints those lines in. */
        chat: [
            { text: 'The Lich King yells: Frostmourne hungers…', color: '#ff4d4d' },
            { text: 'Highlord Tirion Fordring says: Hold, champions.', color: '#f2f4f8' },
            { text: 'The Lich King raises his blade.', color: '#ff9c40' }
        ],
        footnote: {
            label: 'ALREADY HAVE',
            text: 'creature_text · 18,711 lines across 4,206 creatures, with the type and emote on each · Emotes.dbc in the client.'
        }
    }
];

/* The count in the top right, which the new cards make wrong. */
/*
 * The header, rewritten.
 *
 * The picture came with "Roadmap — parked for later", a subtitle under it and an idea counter in
 * the top right, and all three are now wrong: cards get built, so a count of ideas that says
 * "none in progress" ages badly, and the strap line repeated what the logo beside it already says.
 *
 * Everything from x=430 rightwards is repainted before the new title goes down. The paint is
 * sampled from the picture's own background a row at a time — the header carries a slow vertical
 * gradient, and a flat fill bands against it.
 */
const HEADER = {
    paint: { x: 430, y: 40, w: 2750, h: 292 },
    sampleX: 2200,
    lead: { text: 'Astral 3.3.5a Data Kit ', color: '#f2f4f8' },
    tail: { text: 'Roadmap', color: '#ffd100' },
    x: 459,
    baseline: 192,
    size: 86
};

/*
 * Cards parked rather than finished. Boxes measured off the base image, as the COMPLETE ones were.
 *
 *   1 — Tier stat generator, 2 — Item wizard: the maths is built and verified, the shape of the
 *   window is not, so both wait rather than ship half-right.
 */
const ON_HOLD = [
    { label: 'ON HOLD', color: '#ffb020', x0: 99, y0: 412, x1: 2080, y1: 1209 },
    { label: 'ON HOLD', color: '#ffb020', x0: 2128, y0: 412, x1: 3144, y1: 1209 }
];

const GREEN = '#3ddc55';
const GOLD = '#e8c268';
const PANEL = '#161925';
const TITLE = '#f2f4f8';
const BODY = '#a8b0be';

/*
 * Where the footer band starts: everything below this slides down to make room.
 *
 * Measured off the picture a row at a time rather than eyeballed, because guessing it twice left
 * the cards' own bottom edges behind — the last text in the bottom row ends at 3028, but the card
 * borders and their rounded corners run on to 3079, and only from 3080 is the row plain
 * background.
 */
const FOOTER_TOP = 3084;

app.disableHardwareAcceleration();

app.whenReady().then(async () =>
{
    if (!fs.existsSync(BASE))
    {
        fs.copyFileSync(OUT, BASE);
        console.log(`kept a baseline copy at ${BASE}`);
    }

    const win = new BrowserWindow({ width: 900, height: 700, show: false });
    await win.loadURL('data:text/html,<body style="margin:0"></body>');

    const base64 = fs.readFileSync(BASE).toString('base64');

    const script = `(async () => {
        const img = new Image();
        img.src = 'data:image/png;base64,${base64}';
        await img.decode();

        const DONE = ${JSON.stringify(DONE)};
        const NEW_CARDS = ${JSON.stringify(NEW_CARDS)};
        const HEADER = ${JSON.stringify(HEADER)};
        const ON_HOLD = ${JSON.stringify(ON_HOLD)};
        const GREEN = ${JSON.stringify(GREEN)};
        const GOLD = ${JSON.stringify(GOLD)};
        const PANEL = ${JSON.stringify(PANEL)};
        const TITLE_COLOR = ${JSON.stringify(TITLE)};
        const BODY_COLOR = ${JSON.stringify(BODY)};
        const FOOTER_TOP = ${FOOTER_TOP};

        const GAP = 38;               // the gutter between card rows in the original
        const MARGIN_X = 93;          // the left edge every card sits on
        const RIGHT = 3026;
        const PAD = 52;               // a card's own inner padding

        const extra = NEW_CARDS.reduce((total, card) => total + card.height + GAP, 0) + (NEW_CARDS.length ? 40 : 0);

        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight + extra;

        const ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);

        if (extra) {
            /*
             * Push the footer down, then fill what it left behind by stretching a strip of plain
             * background over it. The background is a slow vertical gradient, so a repeated strip
             * is invisible where a flat fill would band.
             */
            ctx.drawImage(
                img,
                0, FOOTER_TOP, img.naturalWidth, img.naturalHeight - FOOTER_TOP,
                0, FOOTER_TOP + extra, img.naturalWidth, img.naturalHeight - FOOTER_TOP
            );

            ctx.drawImage(img, 0, 3086, img.naturalWidth, 8, 0, FOOTER_TOP, img.naturalWidth, extra);
        }


        /**
         * One stamp, sized to the card it sits on.
         *
         * The card bounds are measured off a rendered picture, so a hard-edged wash over the whole
         * card bleeds into the gutter when it is a few pixels out. A stamp floating in the middle
         * cannot be misaligned that way.
         */
        const stampCard = (card, label, color, plate) => {
            const cx = (card.x0 + card.x1) / 2;
            const cy = (card.y0 + card.y1) / 2;
            const cardW = card.x1 - card.x0;

            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(-11 * Math.PI / 180);

            /* Size the word to the card, but not past a ceiling: the wide cards swallowed it. */
            const target = Math.min(cardW * 0.74, 860);
            let size = 200;
            ctx.font = '900 ' + size + 'px "Segoe UI", Arial, sans-serif';
            ctx.letterSpacing = '10px';
            size = Math.floor(size * (target / ctx.measureText(label).width));
            ctx.font = '900 ' + size + 'px "Segoe UI", Arial, sans-serif';

            const wordWidth = ctx.measureText(label).width;
            const padX = size * 0.34;
            const padY = size * 0.30;
            const boxW = wordWidth + padX * 2;
            const boxH = size + padY * 2;

            ctx.globalAlpha = 0.92;
            ctx.strokeStyle = color;
            ctx.lineWidth = Math.max(6, size * 0.075);
            ctx.beginPath();
            ctx.roundRect(-boxW / 2, -boxH / 2, boxW, boxH, size * 0.16);
            ctx.stroke();

            /* A darkened plate behind the word, so it stays legible over charts and code. */
            ctx.globalAlpha = 0.30;
            ctx.fillStyle = plate;
            ctx.fill();

            ctx.globalAlpha = 1;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
            ctx.shadowBlur = size * 0.14;
            ctx.fillStyle = color;
            ctx.fillText(label, 0, size * 0.04);

            ctx.restore();
        };

        const roundRect = (x, y, w, h, r) => {
            ctx.beginPath();
            ctx.roundRect(x, y, w, h, r);
        };

        let y = FOOTER_TOP + 30;

        for (const card of NEW_CARDS) {
            const w = RIGHT - MARGIN_X;

            // The panel.
            ctx.save();
            roundRect(MARGIN_X, y, w, card.height, 18);
            ctx.fillStyle = PANEL;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.06)';
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.restore();

            // The gold edge along the top, as every other card carries.
            ctx.save();
            roundRect(MARGIN_X, y, w, card.height, 18);
            ctx.clip();
            ctx.fillStyle = GOLD;
            ctx.globalAlpha = 0.85;
            ctx.fillRect(MARGIN_X, y, w, 5);
            ctx.restore();

            // The number badge.
            const badge = { x: MARGIN_X + PAD, y: y + PAD, size: 58 };
            ctx.save();
            roundRect(badge.x, badge.y, badge.size, badge.size, 10);
            ctx.strokeStyle = GOLD;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 2;
            ctx.stroke();
            ctx.globalAlpha = 0.10;
            ctx.fillStyle = GOLD;
            ctx.fill();
            ctx.globalAlpha = 1;
            ctx.fillStyle = GOLD;
            ctx.font = '600 34px "Segoe UI", Arial, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(card.number, badge.x + badge.size / 2, badge.y + badge.size / 2 + 2);
            ctx.restore();

            // The title, on the badge's center line.
            ctx.save();
            ctx.fillStyle = TITLE_COLOR;
            ctx.font = '600 46px "Segoe UI", Arial, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'middle';
            ctx.fillText(card.title, badge.x + badge.size + 30, badge.y + badge.size / 2 + 2);
            ctx.restore();

            // The description, left half.
            ctx.save();
            ctx.fillStyle = BODY_COLOR;
            ctx.font = '400 30px "Segoe UI", Arial, sans-serif';
            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            let lineY = badge.y + badge.size + 62;
            for (const line of card.body) {
                ctx.fillText(line, MARGIN_X + PAD, lineY);
                lineY += 44;
            }
            ctx.restore();

            // The chat frame, right half.
            if (card.chat && card.chat.length) {
                const box = {
                    x: MARGIN_X + w / 2 + 40,
                    y: badge.y + badge.size + 26,
                    w: w / 2 - PAD - 40,
                    h: 172
                };

                ctx.save();
                roundRect(box.x, box.y, box.w, box.h, 12);
                ctx.fillStyle = 'rgba(0, 0, 0, 0.35)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
                ctx.lineWidth = 2;
                ctx.stroke();

                ctx.font = '400 27px "Segoe UI", Arial, sans-serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';

                let chatY = box.y + 52;
                for (const line of card.chat) {
                    ctx.fillStyle = line.color;
                    ctx.fillText(line.text, box.x + 28, chatY);
                    chatY += 46;
                }
                ctx.restore();
            }

            // The footnote, along the bottom behind a divider.
            if (card.footnote) {
                const noteY = y + card.height - 96;

                ctx.save();
                ctx.strokeStyle = 'rgba(255, 255, 255, 0.07)';
                ctx.lineWidth = 2;
                ctx.setLineDash([6, 8]);
                ctx.beginPath();
                ctx.moveTo(MARGIN_X + PAD, noteY);
                ctx.lineTo(RIGHT - PAD, noteY);
                ctx.stroke();
                ctx.restore();

                ctx.save();
                ctx.fillStyle = 'rgba(168, 176, 190, 0.65)';
                ctx.font = '600 22px "Segoe UI", Arial, sans-serif';
                ctx.letterSpacing = '3px';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'alphabetic';
                ctx.fillText(card.footnote.label, MARGIN_X + PAD, noteY + 38);
                ctx.letterSpacing = '0px';
                ctx.fillStyle = BODY_COLOR;
                ctx.font = '400 27px "Segoe UI", Arial, sans-serif';
                ctx.fillText(card.footnote.text, MARGIN_X + PAD, noteY + 76);
                ctx.restore();
            }

            if (card.complete) {
                stampCard({ x0: MARGIN_X, y0: y, x1: RIGHT, y1: y + card.height },
                    'COMPLETE', GREEN, '#04120a');
            }

            y += card.height + GAP;
        }

        /*
         * The idea count in the header. Covered with a patch of the background beside it rather
         * than a guessed color, so the header's own gradient carries through.
         */
        if (HEADER) {
            ctx.save();

            /*
             * Repaint the strip a row at a time, as a gradient between the background just outside
             * each end of it.
             *
             * A single sampled color was tried first and left a visible rectangle: the header's
             * background falls off from left to right as well as top to bottom, so a flat fill is
             * the right color only in the middle. Reading both ends and interpolating between
             * them matches the picture in both directions and leaves no seam.
             */
            for (let row = 0; row < HEADER.paint.h; row++) {
                const y = HEADER.paint.y + row;
                const left = ctx.getImageData(HEADER.paint.x - 6, y, 1, 1).data;
                const right = ctx.getImageData(HEADER.paint.x + HEADER.paint.w + 4, y, 1, 1).data;

                const fill = ctx.createLinearGradient(
                    HEADER.paint.x, y, HEADER.paint.x + HEADER.paint.w, y);

                fill.addColorStop(0, 'rgb(' + left[0] + ',' + left[1] + ',' + left[2] + ')');
                fill.addColorStop(1, 'rgb(' + right[0] + ',' + right[1] + ',' + right[2] + ')');

                ctx.fillStyle = fill;
                ctx.fillRect(HEADER.paint.x, y, HEADER.paint.w, 1);
            }

            ctx.textAlign = 'left';
            ctx.textBaseline = 'alphabetic';
            ctx.font = '300 ' + HEADER.size + 'px "Segoe UI", Arial, sans-serif';
            ctx.fillStyle = HEADER.lead.color;
            ctx.fillText(HEADER.lead.text, HEADER.x, HEADER.baseline);

            const leadWidth = ctx.measureText(HEADER.lead.text).width;

            ctx.font = '700 ' + HEADER.size + 'px "Segoe UI", Arial, sans-serif';
            ctx.fillStyle = HEADER.tail.color;
            ctx.fillText(HEADER.tail.text, HEADER.x + leadWidth, HEADER.baseline);

            ctx.restore();
        }

        for (const card of ON_HOLD) {
            stampCard(card, card.label, card.color, '#1a1204');
        }

        /*
         * The stamp only, with no tint across the card behind it.
         *
         * A full-card wash was tried and abandoned: the card bounds here are measured off a
         * rendered picture, so a hard-edged rectangle that is a few pixels out bleeds into the
         * gutter beside it. The stamp floats in the middle and cannot be misaligned that way.
         */
        for (const card of DONE) {
            stampCard(card, 'COMPLETE', GREEN, '#04120a');
        }

        return c.toDataURL('image/png');
    })()`;

    const dataUrl = await win.webContents.executeJavaScript(script);
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64');

    fs.writeFileSync(OUT, bytes);
    fs.writeFileSync(APP_OUT, bytes);
    console.log(`wrote ${OUT} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`);
    console.log(`wrote ${APP_OUT}`);
    console.log(`stamped: ${DONE.map((d) => d.label).join(', ') || 'none'}`);
    console.log(`appended: ${NEW_CARDS.map((card) => card.number + ' ' + card.title).join(', ') || 'none'}`);

    app.exit(0);
});

setTimeout(() => { console.log('TIMEOUT'); app.exit(2); }, 60000);
