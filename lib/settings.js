'use strict';

/* Small JSON settings store: the client folder and the optional world-DB connection. */

const fs = require('fs');
const path = require('path');

const DEFAULTS = {
    clientPath: '',
    db: {
        enabled: false,
        host: '127.0.0.1',
        port: 3306,
        user: 'root',
        password: '',
        database: 'acore_world'
    }
};

class Settings
{
    constructor(file)
    {
        this.file = file;
        this.data = { ...DEFAULTS };
        this.load();
    }

    load()
    {
        try
        {
            const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
            this.data = { ...DEFAULTS, ...raw, db: { ...DEFAULTS.db, ...(raw.db || {}) } };
        }
        catch
        {
            // First run, or the file was hand-edited into something unreadable: defaults stand.
        }

        return this.data;
    }

    save(patch)
    {
        this.data = {
            ...this.data,
            ...patch,
            db: { ...this.data.db, ...(patch && patch.db ? patch.db : {}) }
        };

        try
        {
            fs.mkdirSync(path.dirname(this.file), { recursive: true });
            fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
        }
        catch (err)
        {
            console.warn(`could not save settings: ${err.message}`);
        }

        return this.data;
    }

    /** Never hand the password back to the renderer; it only needs to know one is set. */
    redacted()
    {
        return {
            ...this.data,
            db: { ...this.data.db, password: undefined, hasPassword: !!this.data.db.password }
        };
    }
}

module.exports = { Settings, DEFAULTS };
