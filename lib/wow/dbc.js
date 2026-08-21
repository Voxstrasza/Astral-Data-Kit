'use strict';

/*
 * Reader for the client's .dbc tables.
 *
 * A DBC is a fixed-width table and nothing more: a 20-byte header, then `recordCount` rows of
 * `recordSize` bytes, then a string block. Every field is exactly 4 bytes. The file does not say
 * whether a given field is an int, a float or an offset into the string block — that comes from
 * knowing the table's layout, which is why callers name their field indices explicitly rather
 * than this module guessing.
 *
 * Localised text is not one field but seventeen: sixteen locale slots followed by a bitmask of
 * which are populated. enUS is the first slot, and the only one read here.
 *
 * Field indices for a table can be recovered without a reference: an AzerothCore world database
 * carries the same layouts as the column order of its `<name>_dbc` tables, which are present even
 * when empty.
 */

const HEADER_SIZE = 20;
const FIELD_SIZE = 4;

/** 16 locale slots plus the trailing mask, so a localised column advances the index by 17. */
const LOCALE_FIELDS = 17;

class Dbc
{
    constructor(buffer, label)
    {
        this.label = label || 'dbc';

        if (!buffer || buffer.length < HEADER_SIZE)
        {
            throw new Error(`${this.label}: too short to be a DBC`);
        }

        if (buffer.toString('ascii', 0, 4) !== 'WDBC')
        {
            throw new Error(`${this.label}: not a DBC (bad magic)`);
        }

        this.recordCount = buffer.readUInt32LE(4);
        this.fieldCount = buffer.readUInt32LE(8);
        this.recordSize = buffer.readUInt32LE(12);
        this.stringSize = buffer.readUInt32LE(16);

        this.recordsAt = HEADER_SIZE;
        this.stringsAt = HEADER_SIZE + this.recordCount * this.recordSize;

        const expected = this.stringsAt + this.stringSize;

        if (buffer.length < expected)
        {
            throw new Error(`${this.label}: truncated — expected ${expected} bytes, got ${buffer.length}`);
        }

        // A record whose size is not a whole number of fields means the layout is misread.
        if (this.recordSize !== this.fieldCount * FIELD_SIZE)
        {
            throw new Error(
                `${this.label}: recordSize ${this.recordSize} does not match ${this.fieldCount} 4-byte fields`);
        }

        this.buffer = buffer;
    }

    get length()
    {
        return this.recordCount;
    }

    offset(row, field)
    {
        if (row < 0 || row >= this.recordCount)
        {
            throw new Error(`${this.label}: row ${row} out of range (${this.recordCount})`);
        }

        if (field < 0 || field >= this.fieldCount)
        {
            throw new Error(`${this.label}: field ${field} out of range (${this.fieldCount})`);
        }

        return this.recordsAt + row * this.recordSize + field * FIELD_SIZE;
    }

    int(row, field)
    {
        return this.buffer.readInt32LE(this.offset(row, field));
    }

    float(row, field)
    {
        return this.buffer.readFloatLE(this.offset(row, field));
    }

    /** A string field holds a byte offset into the string block; 0 means empty. */
    string(row, field)
    {
        const at = this.buffer.readUInt32LE(this.offset(row, field));

        if (!at || at >= this.stringSize)
        {
            return '';
        }

        const start = this.stringsAt + at;
        let end = start;

        while (end < this.buffer.length && this.buffer[end] !== 0)
        {
            end++;
        }

        return this.buffer.toString('utf8', start, end);
    }

    /** Maps every row through `fn`, which receives a small accessor bound to that row. */
    map(fn)
    {
        const out = [];

        for (let row = 0; row < this.recordCount; row++)
        {
            out.push(fn({
                int: (field) => this.int(row, field),
                float: (field) => this.float(row, field),
                string: (field) => this.string(row, field)
            }, row));
        }

        return out;
    }
}

module.exports = { Dbc, LOCALE_FIELDS, HEADER_SIZE, FIELD_SIZE };
