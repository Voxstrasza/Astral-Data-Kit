'use strict';

/**
 * MPQ encryption primitives. The archive format hashes filenames into its hash
 * table and encrypts the hash/block tables with keys derived from fixed strings.
 */

const HASH_TABLE_OFFSET = 0;
const HASH_NAME_A = 1;
const HASH_NAME_B = 2;
const HASH_FILE_KEY = 3;

// Storm's 0x500-entry crypt table, generated from a fixed linear congruential seed.
const cryptTable = new Uint32Array(0x500);

(function buildCryptTable()
{
    let seed = 0x00100001;

    for (let index1 = 0; index1 < 0x100; ++index1)
    {
        for (let index2 = index1, i = 0; i < 5; ++i, index2 += 0x100)
        {
            seed = (seed * 125 + 3) % 0x2AAAAB;
            const temp1 = (seed & 0xFFFF) << 0x10;

            seed = (seed * 125 + 3) % 0x2AAAAB;
            const temp2 = (seed & 0xFFFF);

            cryptTable[index2] = (temp1 | temp2) >>> 0;
        }
    }
})();

/** Normalises a path the way Storm does: uppercase, backslash separators. */
function normalise(name)
{
    return name.toUpperCase().replace(/\//g, '\\');
}

function hashString(name, hashType)
{
    const text = normalise(name);
    let seed1 = 0x7FED7FED;
    let seed2 = 0xEEEEEEEE;

    for (let i = 0; i < text.length; ++i)
    {
        const ch = text.charCodeAt(i) & 0xFF;
        const value = cryptTable[(hashType << 8) + ch];

        seed1 = (value ^ ((seed1 + seed2) >>> 0)) >>> 0;
        seed2 = (ch + seed1 + seed2 + (seed2 << 5) + 3) >>> 0;
    }

    return seed1 >>> 0;
}

/** Decrypts a buffer of uint32s in place and returns it. */
function decryptBlock(buffer, key)
{
    let seed1 = key >>> 0;
    let seed2 = 0xEEEEEEEE;
    const count = Math.floor(buffer.length / 4);

    for (let i = 0; i < count; ++i)
    {
        seed2 = (seed2 + cryptTable[0x400 + (seed1 & 0xFF)]) >>> 0;

        const encrypted = buffer.readUInt32LE(i * 4);
        const decrypted = (encrypted ^ (((seed1 + seed2) >>> 0))) >>> 0;

        // Both halves of the key update read the *previous* key value.
        const previous = seed1;
        seed1 = (((((~previous >>> 0) << 0x15) >>> 0) + 0x11111111) >>> 0) | (previous >>> 0x0B);
        seed1 = seed1 >>> 0;
        seed2 = (decrypted + seed2 + (seed2 << 5) + 3) >>> 0;

        buffer.writeUInt32LE(decrypted, i * 4);
    }

    return buffer;
}

/**
 * The per-file key is derived from the base filename; FIX_KEY additionally
 * mixes in the file's position and size.
 */
function fileKey(fileName, blockOffset, fileSize, fixKey)
{
    const base = normalise(fileName).split('\\').pop();
    let key = hashString(base, HASH_FILE_KEY);

    if (fixKey)
    {
        key = (((key + blockOffset) >>> 0) ^ (fileSize >>> 0)) >>> 0;
    }

    return key;
}

module.exports = {
    HASH_TABLE_OFFSET,
    HASH_NAME_A,
    HASH_NAME_B,
    HASH_FILE_KEY,
    hashString,
    decryptBlock,
    fileKey
};
