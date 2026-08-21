'use strict';

const fs = require('fs');
const zlib = require('zlib');
const crypt = require('./crypt');

const MPQ_MAGIC = 0x1A51504D; // 'MPQ\x1A'

const FLAG_IMPLODE = 0x00000100;
const FLAG_COMPRESS = 0x00000200;
const FLAG_ENCRYPTED = 0x00010000;
const FLAG_FIX_KEY = 0x00020000;
const FLAG_SINGLE_UNIT = 0x01000000;
const FLAG_EXISTS = 0x80000000;

const HASH_ENTRY_EMPTY = 0xFFFFFFFF;
const HASH_ENTRY_DELETED = 0xFFFFFFFE;

/**
 * Minimal reader for MPQ v1/v2 archives — enough to pull files out of a 3.3.5a
 * client. Supports zlib and bzip2-free sector compression, single-unit files
 * and encrypted files; PKWARE-imploded data is reported rather than guessed at.
 */
class MPQArchive
{
    constructor(filePath)
    {
        this.filePath = filePath;
        this.fd = fs.openSync(filePath, 'r');

        try
        {
            this._readHeader();
            this._readTables();
        }
        catch (err)
        {
            fs.closeSync(this.fd);
            throw err;
        }
    }

    close()
    {
        if (this.fd !== null)
        {
            fs.closeSync(this.fd);
            this.fd = null;
        }
    }

    _read(offset, length)
    {
        const buffer = Buffer.alloc(length);
        fs.readSync(this.fd, buffer, 0, length, offset);

        return buffer;
    }

    /** The header is 512-byte aligned but not necessarily at offset 0. */
    _readHeader()
    {
        const size = fs.fstatSync(this.fd).size;

        for (let offset = 0; offset + 32 <= size; offset += 512)
        {
            const probe = this._read(offset, 32);

            if (probe.readUInt32LE(0) !== MPQ_MAGIC)
            {
                continue;
            }

            this.headerOffset = offset;
            this.formatVersion = probe.readUInt16LE(12);
            this.sectorSizeShift = probe.readUInt16LE(14);
            this.sectorSize = 512 << this.sectorSizeShift;
            this.hashTablePos = probe.readUInt32LE(16) + offset;
            this.blockTablePos = probe.readUInt32LE(20) + offset;
            this.hashTableSize = probe.readUInt32LE(24);
            this.blockTableSize = probe.readUInt32LE(28);

            return;
        }

        throw new Error(`${this.filePath}: MPQ header not found`);
    }

    _readTables()
    {
        const hashBytes = crypt.decryptBlock(
            this._read(this.hashTablePos, this.hashTableSize * 16),
            crypt.hashString('(hash table)', crypt.HASH_FILE_KEY)
        );

        this.hashTable = [];

        for (let i = 0; i < this.hashTableSize; ++i)
        {
            this.hashTable.push({
                name1: hashBytes.readUInt32LE(i * 16),
                name2: hashBytes.readUInt32LE(i * 16 + 4),
                locale: hashBytes.readUInt16LE(i * 16 + 8),
                blockIndex: hashBytes.readUInt32LE(i * 16 + 12)
            });
        }

        const blockBytes = crypt.decryptBlock(
            this._read(this.blockTablePos, this.blockTableSize * 16),
            crypt.hashString('(block table)', crypt.HASH_FILE_KEY)
        );

        this.blockTable = [];

        for (let i = 0; i < this.blockTableSize; ++i)
        {
            this.blockTable.push({
                filePos: blockBytes.readUInt32LE(i * 16) + this.headerOffset,
                compressedSize: blockBytes.readUInt32LE(i * 16 + 4),
                fileSize: blockBytes.readUInt32LE(i * 16 + 8),
                flags: blockBytes.readUInt32LE(i * 16 + 12) >>> 0
            });
        }
    }

    /** Locates the hash entry for a filename, preferring the neutral locale. */
    _findHashEntry(fileName)
    {
        const start = crypt.hashString(fileName, crypt.HASH_TABLE_OFFSET) & (this.hashTableSize - 1);
        const nameA = crypt.hashString(fileName, crypt.HASH_NAME_A);
        const nameB = crypt.hashString(fileName, crypt.HASH_NAME_B);

        let fallback = null;

        for (let i = 0; i < this.hashTableSize; ++i)
        {
            const entry = this.hashTable[(start + i) % this.hashTableSize];

            if (entry.blockIndex === HASH_ENTRY_EMPTY)
            {
                break;
            }

            if (entry.blockIndex === HASH_ENTRY_DELETED)
            {
                continue;
            }

            if (entry.name1 === nameA && entry.name2 === nameB)
            {
                if (entry.locale === 0)
                {
                    return entry;
                }

                fallback = fallback || entry;
            }
        }

        return fallback;
    }

    hasFile(fileName)
    {
        return this._findHashEntry(fileName) !== null;
    }

    readFile(fileName)
    {
        const hashEntry = this._findHashEntry(fileName);

        if (!hashEntry)
        {
            return null;
        }

        const block = this.blockTable[hashEntry.blockIndex];

        if (!block || !(block.flags & FLAG_EXISTS))
        {
            return null;
        }

        const encrypted = (block.flags & FLAG_ENCRYPTED) !== 0;
        const key = encrypted
            ? crypt.fileKey(fileName, block.filePos - this.headerOffset, block.fileSize,
                (block.flags & FLAG_FIX_KEY) !== 0)
            : 0;

        if (block.flags & FLAG_SINGLE_UNIT)
        {
            let data = this._read(block.filePos, block.compressedSize);

            if (encrypted)
            {
                crypt.decryptBlock(data, key);
            }

            if ((block.flags & (FLAG_COMPRESS | FLAG_IMPLODE)) && block.compressedSize < block.fileSize)
            {
                data = decompress(data, block.fileSize);
            }

            return data.subarray(0, block.fileSize);
        }

        return this._readSectored(block, encrypted, key);
    }

    _readSectored(block, encrypted, key)
    {
        const sectorCount = Math.ceil(block.fileSize / this.sectorSize);
        const compressed = (block.flags & (FLAG_COMPRESS | FLAG_IMPLODE)) !== 0;

        let offsets;

        if (compressed)
        {
            const tableBytes = this._read(block.filePos, (sectorCount + 1) * 4);

            if (encrypted)
            {
                crypt.decryptBlock(tableBytes, (key - 1) >>> 0);
            }

            offsets = [];

            for (let i = 0; i <= sectorCount; ++i)
            {
                offsets.push(tableBytes.readUInt32LE(i * 4));
            }
        }
        else
        {
            offsets = [];

            for (let i = 0; i <= sectorCount; ++i)
            {
                offsets.push(Math.min(i * this.sectorSize, block.fileSize));
            }
        }

        const chunks = [];

        for (let i = 0; i < sectorCount; ++i)
        {
            const rawLength = offsets[i + 1] - offsets[i];
            const expected = Math.min(this.sectorSize, block.fileSize - (i * this.sectorSize));

            let sector = this._read(block.filePos + offsets[i], rawLength);

            if (encrypted)
            {
                crypt.decryptBlock(sector, (key + i) >>> 0);
            }

            if (compressed && rawLength < expected)
            {
                sector = decompress(sector, expected);
            }

            chunks.push(sector.subarray(0, expected));
        }

        return Buffer.concat(chunks, block.fileSize);
    }

    /**
     * Filenames are not stored in the tables, so enumeration relies on the
     * archive's own (listfile).
     */
    listFiles()
    {
        const raw = this.readFile('(listfile)');

        if (!raw)
        {
            return [];
        }

        return raw
            .toString('latin1')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(Boolean);
    }
}

/** Sector payloads start with a mask naming the compression used. */
function decompress(buffer, expectedSize)
{
    const mask = buffer[0];
    const payload = buffer.subarray(1);

    // 0x02 = zlib, which is what Blizzard uses for essentially all BLP art.
    if (mask === 0x02)
    {
        return zlib.inflateSync(payload);
    }

    if (mask === 0x08)
    {
        throw new Error('PKWARE-imploded sector is not supported');
    }

    if (mask === 0x10)
    {
        throw new Error('bzip2 sector is not supported');
    }

    // No compression bits set: the sector is stored verbatim.
    if (mask === 0x00)
    {
        return payload;
    }

    throw new Error(`unsupported compression mask 0x${mask.toString(16)} (expected ${expectedSize} bytes)`);
}

module.exports = MPQArchive;
