'use strict';

/**
 * Minimal TGA reader, for custom icons.
 *
 * TGA is what art tends to arrive as around WoW — it is what BLPConverter writes and what the
 * modelling tools export — but no browser decodes it, so a .tga picked in the icon window used to
 * do nothing at all: the <img> that reads a file's size failed silently and the upload was
 * rejected for not being a PNG. Decoding it here and storing a PNG puts it on the same footing as
 * everything else in the picker, and costs nothing beyond this file: the PNG side already exists
 * for BLP.
 *
 * Handles the two layouts icon art actually comes in — uncompressed and run-length encoded, in
 * 24-bit BGR, 32-bit BGRA or 8-bit greyscale. Colour-mapped TGAs are refused by name rather than
 * decoded wrongly; nothing exports icons that way.
 */

const TYPE = {
    COLOUR_MAPPED: 1,
    TRUE_COLOUR: 2,
    GREYSCALE: 3,
    RLE_COLOUR_MAPPED: 9,
    RLE_TRUE_COLOUR: 10,
    RLE_GREYSCALE: 11
};

const HEADER_SIZE = 18;

/**
 * Is this plausibly a TGA?
 *
 * TGA has no magic number at the front — the format predates the convention — so this reads the
 * header and asks whether it describes an image anyone could have written. Files from this century
 * usually carry the v2 footer, which is checked first because it is conclusive.
 */
function looksLikeTga(buffer)
{
    if (!buffer || buffer.length < HEADER_SIZE + 1)
    {
        return false;
    }

    if (buffer.length >= 26 && buffer.subarray(buffer.length - 18, buffer.length - 2).toString('latin1') === 'TRUEVISION-XFILE')
    {
        return true;
    }

    const imageType = buffer.readUInt8(2);
    const depth = buffer.readUInt8(16);
    const width = buffer.readUInt16LE(12);
    const height = buffer.readUInt16LE(14);

    const knownType = [
        TYPE.COLOUR_MAPPED, TYPE.TRUE_COLOUR, TYPE.GREYSCALE,
        TYPE.RLE_COLOUR_MAPPED, TYPE.RLE_TRUE_COLOUR, TYPE.RLE_GREYSCALE
    ].includes(imageType);

    return knownType
        && [8, 15, 16, 24, 32].includes(depth)
        && width > 0 && height > 0
        && width <= 8192 && height <= 8192;
}

/** One pixel out of the source, as RGBA. */
function readPixel(buffer, offset, bytesPerPixel, out, at)
{
    if (bytesPerPixel === 1)
    {
        const grey = buffer[offset];
        out[at] = grey;
        out[at + 1] = grey;
        out[at + 2] = grey;
        out[at + 3] = 255;
        return;
    }

    if (bytesPerPixel === 2)
    {
        // 15/16-bit: five bits a channel, with the top bit as attribute.
        const value = buffer.readUInt16LE(offset);
        out[at] = ((value >> 10) & 0x1F) * 255 / 31;
        out[at + 1] = ((value >> 5) & 0x1F) * 255 / 31;
        out[at + 2] = (value & 0x1F) * 255 / 31;
        out[at + 3] = 255;
        return;
    }

    // 24- and 32-bit are stored BGR(A).
    out[at] = buffer[offset + 2];
    out[at + 1] = buffer[offset + 1];
    out[at + 2] = buffer[offset];
    out[at + 3] = bytesPerPixel === 4 ? buffer[offset + 3] : 255;
}

/**
 * Decodes to { width, height, rgba }, the same shape lib/wow/blp.js returns, or throws with a
 * reason worth showing someone.
 */
function decode(buffer)
{
    if (!buffer || buffer.length < HEADER_SIZE)
    {
        throw new Error('That file is too short to be a TGA.');
    }

    const idLength = buffer.readUInt8(0);
    const colourMapType = buffer.readUInt8(1);
    const imageType = buffer.readUInt8(2);
    const colourMapLength = buffer.readUInt16LE(5);
    const colourMapDepth = buffer.readUInt8(7);
    const width = buffer.readUInt16LE(12);
    const height = buffer.readUInt16LE(14);
    const depth = buffer.readUInt8(16);
    const descriptor = buffer.readUInt8(17);

    if (imageType === TYPE.COLOUR_MAPPED || imageType === TYPE.RLE_COLOUR_MAPPED)
    {
        throw new Error('That TGA is colour-mapped, which this cannot read. Save it as 24- or 32-bit.');
    }

    if (![TYPE.TRUE_COLOUR, TYPE.GREYSCALE, TYPE.RLE_TRUE_COLOUR, TYPE.RLE_GREYSCALE].includes(imageType))
    {
        throw new Error(`That TGA uses image type ${imageType}, which this cannot read.`);
    }

    if (![8, 15, 16, 24, 32].includes(depth))
    {
        throw new Error(`That TGA is ${depth}-bit, which this cannot read.`);
    }

    if (!width || !height)
    {
        throw new Error('That TGA has no size in its header.');
    }

    const bytesPerPixel = Math.ceil(depth / 8);
    const compressed = imageType === TYPE.RLE_TRUE_COLOUR || imageType === TYPE.RLE_GREYSCALE;

    // The pixels start after the id field and the colour map, even when the map is unused.
    let offset = HEADER_SIZE + idLength + (colourMapType === 1 ? colourMapLength * Math.ceil(colourMapDepth / 8) : 0);

    const pixels = width * height;
    const rgba = Buffer.alloc(pixels * 4);

    if (compressed)
    {
        let written = 0;

        while (written < pixels)
        {
            if (offset >= buffer.length)
            {
                throw new Error('That TGA ends part-way through its pixels.');
            }

            const packet = buffer.readUInt8(offset++);
            const count = (packet & 0x7F) + 1;

            if (packet & 0x80)
            {
                // A run: one pixel repeated.
                if (offset + bytesPerPixel > buffer.length) { throw new Error('That TGA ends part-way through a run.'); }

                for (let i = 0; i < count && written < pixels; ++i, ++written)
                {
                    readPixel(buffer, offset, bytesPerPixel, rgba, written * 4);
                }

                offset += bytesPerPixel;
            }
            else
            {
                // A literal stretch: count pixels, one after another.
                for (let i = 0; i < count && written < pixels; ++i, ++written)
                {
                    if (offset + bytesPerPixel > buffer.length) { throw new Error('That TGA ends part-way through its pixels.'); }

                    readPixel(buffer, offset, bytesPerPixel, rgba, written * 4);
                    offset += bytesPerPixel;
                }
            }
        }
    }
    else
    {
        if (offset + pixels * bytesPerPixel > buffer.length)
        {
            throw new Error('That TGA is shorter than its header says.');
        }

        for (let i = 0; i < pixels; ++i)
        {
            readPixel(buffer, offset + i * bytesPerPixel, bytesPerPixel, rgba, i * 4);
        }
    }

    /*
     * Bit 5 of the descriptor is the origin: set means the first row is the top one, clear — which
     * is the common case — means the image is stored bottom-up and has to be flipped.
     */
    if (!(descriptor & 0x20))
    {
        const stride = width * 4;
        const flipped = Buffer.alloc(rgba.length);

        for (let y = 0; y < height; ++y)
        {
            rgba.copy(flipped, y * stride, (height - 1 - y) * stride, (height - y) * stride);
        }

        return { width, height, rgba: flipped };
    }

    return { width, height, rgba };
}

module.exports = { decode, looksLikeTga };
