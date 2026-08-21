'use strict';

/**
 * Decoder for BLP2 textures as shipped in 3.3.5a clients.
 *
 * Three encodings appear in practice: a 256-colour palette with optional alpha,
 * DXT1/3/5 block compression, and plain BGRA. Only the top mip level is decoded,
 * which is all an icon needs.
 */

const HEADER_SIZE = 148;
const PALETTE_SIZE = 256 * 4;

const ENCODING_PALETTE = 1;
const ENCODING_DXT = 2;
const ENCODING_ARGB = 3;

function decode(buffer)
{
    if (buffer.length < HEADER_SIZE || buffer.toString('latin1', 0, 4) !== 'BLP2')
    {
        throw new Error('not a BLP2 texture');
    }

    const encoding = buffer.readUInt8(8);
    const alphaDepth = buffer.readUInt8(9);
    const alphaEncoding = buffer.readUInt8(10);
    const width = buffer.readUInt32LE(12);
    const height = buffer.readUInt32LE(16);
    const mipOffset = buffer.readUInt32LE(20);
    const mipSize = buffer.readUInt32LE(84);

    if (!width || !height)
    {
        throw new Error('zero-sized texture');
    }

    const data = buffer.subarray(mipOffset, mipOffset + mipSize);
    const rgba = Buffer.alloc(width * height * 4);

    if (encoding === ENCODING_PALETTE)
    {
        decodePalette(buffer, data, rgba, width, height, alphaDepth);
    }
    else if (encoding === ENCODING_DXT)
    {
        decodeDXT(data, rgba, width, height, dxtFlavour(alphaDepth, alphaEncoding));
    }
    else if (encoding === ENCODING_ARGB)
    {
        for (let i = 0; i < width * height; ++i)
        {
            rgba[i * 4] = data[i * 4 + 2];
            rgba[i * 4 + 1] = data[i * 4 + 1];
            rgba[i * 4 + 2] = data[i * 4];
            rgba[i * 4 + 3] = data[i * 4 + 3];
        }
    }
    else
    {
        throw new Error(`unsupported BLP encoding ${encoding}`);
    }

    return { width, height, rgba };
}

function dxtFlavour(alphaDepth, alphaEncoding)
{
    if (alphaEncoding === 0)
    {
        return 1;
    }

    if (alphaEncoding === 1)
    {
        return 3;
    }

    if (alphaEncoding === 7)
    {
        return 5;
    }

    return alphaDepth <= 1 ? 1 : 3;
}

/** Palette lives at the end of the header; entries are BGRA. */
function decodePalette(buffer, data, rgba, width, height, alphaDepth)
{
    const palette = buffer.subarray(HEADER_SIZE, HEADER_SIZE + PALETTE_SIZE);
    const pixels = width * height;
    const alphaStart = pixels;

    for (let i = 0; i < pixels; ++i)
    {
        const index = data[i];

        rgba[i * 4] = palette[index * 4 + 2];
        rgba[i * 4 + 1] = palette[index * 4 + 1];
        rgba[i * 4 + 2] = palette[index * 4];

        let alpha = 255;

        if (alphaDepth === 1)
        {
            const byte = data[alphaStart + (i >> 3)];
            alpha = (byte & (1 << (i & 7))) ? 255 : 0;
        }
        else if (alphaDepth === 4)
        {
            const byte = data[alphaStart + (i >> 1)];
            const nibble = (i & 1) ? (byte >> 4) : (byte & 0x0F);
            alpha = nibble * 17;
        }
        else if (alphaDepth === 8)
        {
            alpha = data[alphaStart + i];
        }

        rgba[i * 4 + 3] = alpha;
    }
}

function rgb565(value, out)
{
    out[0] = ((value >> 11) & 0x1F) * 255 / 31;
    out[1] = ((value >> 5) & 0x3F) * 255 / 63;
    out[2] = (value & 0x1F) * 255 / 31;
}

function decodeDXT(data, rgba, width, height, flavour)
{
    const blocksX = Math.ceil(width / 4);
    const blocksY = Math.ceil(height / 4);
    const blockBytes = flavour === 1 ? 8 : 16;

    const c0 = [0, 0, 0];
    const c1 = [0, 0, 0];
    const colors = [[0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255], [0, 0, 0, 255]];

    for (let by = 0; by < blocksY; ++by)
    {
        for (let bx = 0; bx < blocksX; ++bx)
        {
            const offset = (by * blocksX + bx) * blockBytes;

            if (offset + blockBytes > data.length)
            {
                continue;
            }

            const colorOffset = flavour === 1 ? offset : offset + 8;
            const value0 = data.readUInt16LE(colorOffset);
            const value1 = data.readUInt16LE(colorOffset + 2);
            const indices = data.readUInt32LE(colorOffset + 4);

            rgb565(value0, c0);
            rgb565(value1, c1);

            colors[0][0] = c0[0]; colors[0][1] = c0[1]; colors[0][2] = c0[2];
            colors[1][0] = c1[0]; colors[1][1] = c1[1]; colors[1][2] = c1[2];

            // DXT1 uses the colour ordering to signal a 1-bit alpha mode.
            const opaqueMode = flavour !== 1 || value0 > value1;

            if (opaqueMode)
            {
                for (let i = 0; i < 3; ++i)
                {
                    colors[2][i] = (2 * c0[i] + c1[i]) / 3;
                    colors[3][i] = (c0[i] + 2 * c1[i]) / 3;
                }

                colors[2][3] = 255;
                colors[3][3] = 255;
            }
            else
            {
                for (let i = 0; i < 3; ++i)
                {
                    colors[2][i] = (c0[i] + c1[i]) / 2;
                    colors[3][i] = 0;
                }

                colors[2][3] = 255;
                colors[3][3] = 0;
            }

            for (let py = 0; py < 4; ++py)
            {
                for (let px = 0; px < 4; ++px)
                {
                    const x = bx * 4 + px;
                    const y = by * 4 + py;

                    if (x >= width || y >= height)
                    {
                        continue;
                    }

                    const pixel = py * 4 + px;
                    const color = colors[(indices >> (pixel * 2)) & 3];
                    const target = (y * width + x) * 4;

                    rgba[target] = color[0];
                    rgba[target + 1] = color[1];
                    rgba[target + 2] = color[2];

                    let alpha = color[3];

                    if (flavour === 3)
                    {
                        const byte = data[offset + (pixel >> 1)];
                        const nibble = (pixel & 1) ? (byte >> 4) : (byte & 0x0F);
                        alpha = nibble * 17;
                    }
                    else if (flavour === 5)
                    {
                        alpha = dxt5Alpha(data, offset, pixel);
                    }

                    rgba[target + 3] = alpha;
                }
            }
        }
    }
}

/** DXT5 stores two endpoints plus 3-bit indices into an 8-entry alpha ramp. */
function dxt5Alpha(data, offset, pixel)
{
    const a0 = data[offset];
    const a1 = data[offset + 1];

    const bitPosition = pixel * 3;
    const bytePosition = offset + 2 + (bitPosition >> 3);

    // The index can straddle a byte boundary, so read 16 bits and shift.
    const chunk = data[bytePosition] | (data[bytePosition + 1] << 8);
    const index = (chunk >> (bitPosition & 7)) & 7;

    if (index === 0)
    {
        return a0;
    }

    if (index === 1)
    {
        return a1;
    }

    if (a0 > a1)
    {
        return ((8 - index) * a0 + (index - 1) * a1) / 7;
    }

    if (index === 6)
    {
        return 0;
    }

    if (index === 7)
    {
        return 255;
    }

    return ((6 - index) * a0 + (index - 1) * a1) / 5;
}

module.exports = { decode };
