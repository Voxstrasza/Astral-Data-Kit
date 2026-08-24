'use strict';

const zlib = require('zlib');

/**
 * Minimal PNG writer (8-bit RGBA, no interlacing). Node ships zlib, so encoding
 * needs no third-party image library.
 */

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);

const crcTable = new Int32Array(256);

(function buildCrcTable()
{
    for (let n = 0; n < 256; ++n)
    {
        let c = n;

        for (let k = 0; k < 8; ++k)
        {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }

        crcTable[n] = c;
    }
})();

function crc32(buffer)
{
    let c = 0xFFFFFFFF;

    for (let i = 0; i < buffer.length; ++i)
    {
        c = crcTable[(c ^ buffer[i]) & 0xFF] ^ (c >>> 8);
    }

    return (c ^ 0xFFFFFFFF) >>> 0;
}

function chunk(type, data)
{
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);

    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));

    return Buffer.concat([length, body, crc]);
}

function encode(width, height, rgba)
{
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.writeUInt8(8, 8);   // bit depth
    ihdr.writeUInt8(6, 9);   // color type: truecolor with alpha
    ihdr.writeUInt8(0, 10);  // compression
    ihdr.writeUInt8(0, 11);  // filter
    ihdr.writeUInt8(0, 12);  // interlace

    // Each scanline is prefixed with its filter type; 0 (None) keeps this simple.
    const stride = width * 4;
    const raw = Buffer.alloc((stride + 1) * height);

    for (let y = 0; y < height; ++y)
    {
        raw[y * (stride + 1)] = 0;
        rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    }

    return Buffer.concat([
        SIGNATURE,
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0))
    ]);
}

module.exports = { encode };
