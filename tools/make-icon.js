'use strict';

/**
 * Builds build/icon.ico for the Windows executable, plus an optional resized PNG.
 *
 * Downscaling uses an area average (every source pixel inside the target pixel contributes), so
 * a detailed logo stays legible at 16x16 instead of aliasing into noise. Upscaling falls back to
 * nearest-neighbour, which is what 64x64 client icons want — smoothing pixel art turns it to mush.
 * Vista-era ICOs may embed PNG data directly, which is what we do here.
 *
 * Usage:
 *   node tools/make-icon.js <source.png|iconName> [--crop x,y,size] [--png out.png:width]
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const args = process.argv.slice(2);
const SOURCE = args.find((a) => !a.startsWith('--')) || 'inv_inscription_parchment';
const CROP = (() =>
{
    const flag = args.find((a) => a.startsWith('--crop='));
    if (!flag) { return null; }
    const [x, y, size] = flag.slice(7).split(',').map(Number);
    return { x, y, w: size, h: size };
})();
const PNG_OUT = (() =>
{
    const flag = args.find((a) => a.startsWith('--png='));
    if (!flag) { return null; }
    const [file, width] = flag.slice(6).split(':');
    return { file, width: Number(width) };
})();

const ICONS = path.join(__dirname, '..', 'public', 'icons');
const OUT_DIR = path.join(__dirname, '..', 'build');
const SIZES = [16, 32, 48, 64, 128, 256];

/* ------------------------------------------------------------------ minimal PNG codec */

function crc32(buf)
{
    let c;
    const table = crc32.table || (crc32.table = (() =>
    {
        const t = new Int32Array(256);

        for (let n = 0; n < 256; n++)
        {
            c = n;

            for (let k = 0; k < 8; k++)
            {
                c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            }

            t[n] = c;
        }

        return t;
    })());

    let crc = -1;

    for (const byte of buf)
    {
        crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
    }

    return (crc ^ -1) >>> 0;
}

function chunk(type, data)
{
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);

    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba)
{
    const raw = Buffer.alloc((width * 4 + 1) * height);
    let offset = 0;

    for (let y = 0; y < height; y++)
    {
        raw[offset++] = 0; // filter: none

        for (let x = 0; x < width; x++)
        {
            const i = (y * width + x) * 4;
            raw[offset++] = rgba[i];
            raw[offset++] = rgba[i + 1];
            raw[offset++] = rgba[i + 2];
            raw[offset++] = rgba[i + 3];
        }
    }

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;   // bit depth
    ihdr[9] = 6;   // colour type: RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

function decodePng(buffer)
{
    let offset = 8;
    let width = 0;
    let height = 0;
    const idat = [];

    while (offset < buffer.length)
    {
        const length = buffer.readUInt32BE(offset);
        const type = buffer.toString('ascii', offset + 4, offset + 8);
        const data = buffer.subarray(offset + 8, offset + 8 + length);

        if (type === 'IHDR')
        {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);

            if (data[8] !== 8 || data[9] !== 6)
            {
                throw new Error(`unsupported PNG format (depth ${data[8]}, colour ${data[9]})`);
            }
        }
        else if (type === 'IDAT')
        {
            idat.push(data);
        }
        else if (type === 'IEND')
        {
            break;
        }

        offset += 12 + length;
    }

    const raw = zlib.inflateSync(Buffer.concat(idat));
    const rgba = Buffer.alloc(width * height * 4);
    const stride = width * 4;
    let pos = 0;

    for (let y = 0; y < height; y++)
    {
        const filter = raw[pos++];
        const row = raw.subarray(pos, pos + stride);
        pos += stride;

        for (let x = 0; x < stride; x++)
        {
            const left = x >= 4 ? rgba[y * stride + x - 4] : 0;
            const up = y > 0 ? rgba[(y - 1) * stride + x] : 0;
            const upLeft = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
            let value = row[x];

            if (filter === 1) { value += left; }
            else if (filter === 2) { value += up; }
            else if (filter === 3) { value += (left + up) >> 1; }
            else if (filter === 4)
            {
                const p = left + up - upLeft;
                const pa = Math.abs(p - left);
                const pb = Math.abs(p - up);
                const pc = Math.abs(p - upLeft);
                value += (pa <= pb && pa <= pc) ? left : (pb <= pc ? up : upLeft);
            }

            rgba[y * stride + x] = value & 0xff;
        }
    }

    return { width, height, rgba };
}

/* --------------------------------------------------------------------------- resizing */

function crop(image, box)
{
    const out = Buffer.alloc(box.w * box.h * 4);

    for (let y = 0; y < box.h; y++)
    {
        const sy = Math.min(image.height - 1, Math.max(0, box.y + y));

        for (let x = 0; x < box.w; x++)
        {
            const sx = Math.min(image.width - 1, Math.max(0, box.x + x));
            out.set(image.rgba.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), (y * box.w + x) * 4);
        }
    }

    return { width: box.w, height: box.h, rgba: out };
}

/**
 * Area-average downscale, nearest-neighbour upscale.
 *
 * Averaging matters at icon sizes: point-sampling a 390px logo down to 16px throws away 99% of
 * the pixels and lands on whatever happens to sit under the sample point, which looks like noise.
 */
function resize(image, width, height)
{
    height = height || width;
    const out = Buffer.alloc(width * height * 4);
    const scaleX = image.width / width;
    const scaleY = image.height / height;
    const shrinking = scaleX > 1 || scaleY > 1;

    for (let y = 0; y < height; y++)
    {
        for (let x = 0; x < width; x++)
        {
            const to = (y * width + x) * 4;

            if (!shrinking)
            {
                const sx = Math.min(image.width - 1, Math.floor(x * scaleX));
                const sy = Math.min(image.height - 1, Math.floor(y * scaleY));
                out.set(image.rgba.subarray((sy * image.width + sx) * 4, (sy * image.width + sx) * 4 + 4), to);
                continue;
            }

            const x0 = Math.floor(x * scaleX);
            const x1 = Math.min(image.width, Math.max(x0 + 1, Math.ceil((x + 1) * scaleX)));
            const y0 = Math.floor(y * scaleY);
            const y1 = Math.min(image.height, Math.max(y0 + 1, Math.ceil((y + 1) * scaleY)));

            let r = 0, g = 0, b = 0, a = 0, n = 0;

            for (let sy = y0; sy < y1; sy++)
            {
                for (let sx = x0; sx < x1; sx++)
                {
                    const i = (sy * image.width + sx) * 4;
                    const alpha = image.rgba[i + 3];

                    // Weight colour by alpha so transparent pixels do not drag the edges dark.
                    r += image.rgba[i] * alpha;
                    g += image.rgba[i + 1] * alpha;
                    b += image.rgba[i + 2] * alpha;
                    a += alpha;
                    n++;
                }
            }

            out[to] = a ? Math.round(r / a) : 0;
            out[to + 1] = a ? Math.round(g / a) : 0;
            out[to + 2] = a ? Math.round(b / a) : 0;
            out[to + 3] = Math.round(a / n);
        }
    }

    return { width, height, rgba: out };
}

/* -------------------------------------------------------------------------- ICO writer */

function buildIco(pngs)
{
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);            // reserved
    header.writeUInt16LE(1, 2);            // type: icon
    header.writeUInt16LE(pngs.length, 4);

    const entries = [];
    let offset = 6 + pngs.length * 16;

    for (const { size, data } of pngs)
    {
        const entry = Buffer.alloc(16);
        entry[0] = size >= 256 ? 0 : size;  // 0 means 256
        entry[1] = size >= 256 ? 0 : size;
        entry[2] = 0;                       // palette size
        entry[3] = 0;                       // reserved
        entry.writeUInt16LE(1, 4);          // colour planes
        entry.writeUInt16LE(32, 6);         // bits per pixel
        entry.writeUInt32LE(data.length, 8);
        entry.writeUInt32LE(offset, 12);

        entries.push(entry);
        offset += data.length;
    }

    return Buffer.concat([header, ...entries, ...pngs.map((p) => p.data)]);
}

function main()
{
    // Accept either a path to a PNG or the bare name of an extracted client icon.
    const sourceFile = fs.existsSync(SOURCE)
        ? SOURCE
        : path.join(ICONS, `${SOURCE}.png`);

    if (!fs.existsSync(sourceFile))
    {
        console.error(`Image not found: ${sourceFile}`);
        process.exit(1);
    }

    let image = decodePng(fs.readFileSync(sourceFile));
    console.log(`source ${path.basename(sourceFile)} ${image.width}x${image.height}`);

    if (CROP)
    {
        image = crop(image, CROP);
        console.log(`cropped to ${image.width}x${image.height} at ${CROP.x},${CROP.y}`);
    }

    if (PNG_OUT)
    {
        const height = Math.round(image.height * (PNG_OUT.width / image.width));
        const scaled = resize(image, PNG_OUT.width, height);
        fs.writeFileSync(PNG_OUT.file, encodePng(scaled.width, scaled.height, scaled.rgba));
        console.log(`wrote ${PNG_OUT.file} (${scaled.width}x${scaled.height})`);
        return;
    }

    const pngs = SIZES.map((size) =>
    {
        const scaled = resize(image, size);
        return { size, data: encodePng(size, size, scaled.rgba) };
    });

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const out = path.join(OUT_DIR, 'icon.ico');
    fs.writeFileSync(out, buildIco(pngs));

    console.log(`wrote ${out} (${SIZES.join(', ')})`);
}

main();
