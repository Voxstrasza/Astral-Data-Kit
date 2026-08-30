'use strict';

/*
 * Saved work: items, achievements, and whatever else earns it later.
 *
 * Each window builds one thing at a time and exports it as a picture, which is the wrong unit for
 * most of the work. A tier set, a boss's drop table, the achievements for a wing — these are *sets*,
 * and building one meant exporting eight PNGs and arranging them by hand afterwards. So anything
 * built can be saved, and a saved set can be drawn as one sheet.
 *
 * One store, not one per kind: an item and an achievement are both "the fields of a window, kept",
 * and the only thing that differs is which folder they land in and which fields carry the name and
 * the icon. Writing it twice would mean fixing every bug twice.
 *
 * Same storage decision as the raids beside them: one JSON per entry in the app's own data folder,
 * outside anything the installer or the client index touches, so saved work survives a repackage
 * and a reinstall. The folder listing is the index — there is no separate file to disagree with it.
 */

const fs = require('fs');
const path = require('path');
const { newId, safeId } = require('./ids.js');

/**
 * What each kind is called on disk, and where its name and icon live.
 *
 * The summary fields are lifted out of the saved payload so a list can be drawn without every
 * caller knowing that an achievement keeps its title in `achTitle` and an item in `name`.
 */
const KINDS = {
    item: { folder: 'items', name: 'name', icon: 'icon' },
    achievement: { folder: 'achievements', name: 'achTitle', icon: 'achIcon' },
    spell: { folder: 'spells', name: 'spellName', icon: 'spellIcon' },
    unit: { folder: 'units', name: 'unitName', icon: 'icon' },

    /*
     * Armory gear is item fields, but it is not saved work.
     *
     * It shared the items folder at first, on the reasoning that a piece is a piece and one store
     * is cheaper than two. What that missed is what the items folder is *for*: it is the list the
     * Item window draws underneath, ticked and counted and built into a sheet. A piece kept only so
     * the Armory can equip it was never going into a PNG, and it arrived in that list anyway,
     * padding the count and asking to be ticked.
     *
     * So the two are separate folders now. Same shape, same code, different question — one is
     * "what am I drawing", the other is "what can I wear".
     */
    armory: { folder: 'armory', name: 'name', icon: 'icon' }
};

class Saved
{
    constructor(rootDir)
    {
        this.root = rootDir;
    }

    /** The folder for one kind, or empty for a kind that has no store. */
    dir(kind)
    {
        const known = KINDS[kind];

        return known ? path.join(this.root, known.folder) : '';
    }

    ensure(kind)
    {
        const dir = this.dir(kind);

        if (dir)
        {
            fs.mkdirSync(dir, { recursive: true });
        }

        return dir;
    }

    file(kind, id)
    {
        const dir = this.dir(kind);
        const safe = safeId(id);

        return dir && safe ? path.join(dir, `${safe}.json`) : '';
    }

    /**
     * Everything saved of one kind, newest first.
     *
     * The whole entry comes back rather than a summary: these are a few hundred bytes each, and a
     * sheet needs all of it anyway, so a second round trip per entry would buy nothing.
     */
    list(kind)
    {
        const dir = this.ensure(kind);

        if (!dir)
        {
            return [];
        }

        const entries = [];

        for (const file of fs.readdirSync(dir))
        {
            if (!file.endsWith('.json'))
            {
                continue;
            }

            const entry = this.read(kind, file.replace(/\.json$/, ''));

            if (entry)
            {
                entries.push(entry);
            }
        }

        return entries.sort((a, b) => (b.updated || 0) - (a.updated || 0));
    }

    read(kind, id)
    {
        const file = this.file(kind, id);

        if (!file || !fs.existsSync(file))
        {
            return null;
        }

        try
        {
            return JSON.parse(fs.readFileSync(file, 'utf8'));
        }
        catch
        {
            /* A file that will not parse is left alone: it is the user's work, not ours to tidy. */
            return null;
        }
    }

    /**
     * Saves a window's fields.
     *
     * Passing an id updates that entry rather than making a second one, which is what lets the same
     * item be corrected without collecting duplicates of itself.
     */
    save(kind, { id, fields })
    {
        const known = KINDS[kind];

        if (!known)
        {
            return null;
        }

        this.ensure(kind);

        const existing = id ? this.read(kind, id) : null;
        const payload = fields || {};

        const entry = {
            id: existing ? existing.id : newId(kind),
            kind,
            name: (payload[known.name] || '').trim() || `Unnamed ${kind}`,
            icon: payload[known.icon] || '',
            fields: payload,
            created: existing ? existing.created : Date.now(),
            updated: Date.now()
        };

        fs.writeFileSync(this.file(kind, entry.id), JSON.stringify(entry, null, 2));

        return entry;
    }

    remove(kind, id)
    {
        const file = this.file(kind, id);

        if (!file || !fs.existsSync(file))
        {
            return false;
        }

        fs.unlinkSync(file);

        return true;
    }
}

module.exports = { Saved };
