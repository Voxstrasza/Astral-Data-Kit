'use strict';

/*
 * Icons you supply yourself, kept alongside the client's.
 *
 * The client's 6,300 icons cover the game; these cover everything it does not — a custom item for
 * your own server, artwork that has no in-game equivalent. They live in a `custom` folder under
 * the app's data directory rather than in the program folder, so reinstalling or repackaging
 * cannot delete them, and they survive the client index being rebuilt.
 *
 * Sub-folders are one level deep on purpose. A flat list stops being browsable at a few dozen
 * icons and a deep tree turns the picker into a file manager; one level is enough to separate
 * "bosses" from "trinkets" and keeps every path two segments long.
 */

const fs = require('fs');
const path = require('path');

const png = require('./wow/png');
const tga = require('./wow/tga');

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** WotLK icon art is 64x64; anything else is scaled by the game and looks it. */
const NATIVE_SIZE = 64;

/*
 * Names are reduced to a safe alphabet rather than escaped.
 *
 * These strings become file paths and also URL segments, so anything that could climb out of the
 * folder or confuse a path join is simply removed — there is no legitimate icon name that needs a
 * dot, a slash or a backslash in it.
 */
function safeSegment(value)
{
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

class CustomIcons
{
    constructor(rootDir)
    {
        this.root = rootDir;
    }

    ensure()
    {
        fs.mkdirSync(this.root, { recursive: true });
    }

    /** Sub-folder names, with '' first for icons sitting directly in `custom`. */
    folders()
    {
        this.ensure();

        const found = fs.readdirSync(this.root, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort((a, b) => a.localeCompare(b));

        return ['', ...found];
    }

    createFolder(name)
    {
        const safe = safeSegment(name);

        if (!safe)
        {
            return { ok: false, reason: 'That name has no usable characters in it.' };
        }

        const dir = path.join(this.root, safe);

        if (fs.existsSync(dir))
        {
            return { ok: false, reason: `"${safe}" already exists.`, folder: safe };
        }

        fs.mkdirSync(dir, { recursive: true });
        return { ok: true, folder: safe };
    }

    /** Every custom icon, as { name, folder, path } where path is what the URL uses. */
    list()
    {
        this.ensure();

        const out = [];

        for (const folder of this.folders())
        {
            const dir = folder ? path.join(this.root, folder) : this.root;

            let entries;

            try
            {
                entries = fs.readdirSync(dir, { withFileTypes: true });
            }
            catch
            {
                continue;
            }

            for (const entry of entries)
            {
                if (!entry.isFile() || !/\.png$/i.test(entry.name))
                {
                    continue;
                }

                const name = entry.name.replace(/\.png$/i, '');
                out.push({ name, folder, path: folder ? `${folder}/${name}` : name });
            }
        }

        return out.sort((a, b) => a.path.localeCompare(b.path));
    }

    /**
     * Resolves a `folder/name` reference to a file, refusing anything that escapes the root.
     *
     * The segments are already reduced to a safe alphabet, so this is belt and braces — but it is
     * the check that actually matters, because it is the one thing standing between a crafted URL
     * and the rest of the disk.
     */
    resolve(reference)
    {
        const parts = String(reference || '').split('/').map(safeSegment).filter(Boolean);

        if (!parts.length || parts.length > 2)
        {
            return null;
        }

        const file = path.resolve(this.root, `${parts.join(path.sep)}.png`);
        const root = path.resolve(this.root);

        if (file !== root && !file.startsWith(root + path.sep))
        {
            return null;
        }

        return file;
    }

    read(reference)
    {
        const file = this.resolve(reference);

        if (!file || !fs.existsSync(file))
        {
            return null;
        }

        return fs.readFileSync(file);
    }

    /**
     * Stores an icon. `buffer` is the decoded file, not a data URL.
     *
     * PNG is kept as it arrives. TGA is converted, because that is what icon art tends to be
     * exported as around WoW and no browser will decode one — a .tga picked in the icon window
     * used to be rejected for not being a PNG, which is a poor answer to a file that plainly
     * holds an icon.
     *
     * The format is decided by what the bytes say rather than by the file's name: a mis-named
     * file would otherwise be accepted by the picker and then fail to decode in the canvas, which
     * is a confusing way to find out.
     */
    save(folder, name, buffer)
    {
        this.ensure();

        if (!buffer || buffer.length < 8)
        {
            return { ok: false, reason: 'That file is empty.' };
        }

        if (!buffer.subarray(0, 8).equals(PNG_MAGIC))
        {
            if (!tga.looksLikeTga(buffer))
            {
                return { ok: false, reason: 'That file is not a PNG or a TGA.' };
            }

            try
            {
                const image = tga.decode(buffer);
                buffer = png.encode(image.width, image.height, image.rgba);
            }
            catch (err)
            {
                return { ok: false, reason: err.message };
            }
        }

        const safeName = safeSegment(name);

        if (!safeName)
        {
            return { ok: false, reason: 'That file name has no usable characters in it.' };
        }

        const safeFolder = safeSegment(folder);
        const dir = safeFolder ? path.join(this.root, safeFolder) : this.root;

        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, `${safeName}.png`), buffer);

        return {
            ok: true,
            name: safeName,
            folder: safeFolder,
            path: safeFolder ? `${safeFolder}/${safeName}` : safeName
        };
    }

    /**
     * Deletes a folder and everything in it.
     *
     * Recursive on purpose — a folder you cannot delete without emptying it first is a chore, and
     * the page asks for a second click before calling this when the folder is not empty.
     */
    removeFolder(name)
    {
        const safe = safeSegment(name);

        if (!safe)
        {
            return { ok: false, reason: 'That name has no usable characters in it.' };
        }

        const dir = path.resolve(this.root, safe);
        const root = path.resolve(this.root);

        // Never step outside the custom folder, whatever the name decoded to.
        if (!dir.startsWith(root + path.sep) || dir === root)
        {
            return { ok: false, reason: 'Not a folder inside custom.' };
        }

        if (!fs.existsSync(dir))
        {
            return { ok: false, reason: 'No such folder.' };
        }

        const removed = fs.readdirSync(dir).filter((f) => /\.png$/i.test(f)).length;

        fs.rmSync(dir, { recursive: true, force: true });

        return { ok: true, folder: safe, removed };
    }

    remove(reference)
    {
        const file = this.resolve(reference);

        if (!file || !fs.existsSync(file))
        {
            return { ok: false, reason: 'No such icon.' };
        }

        fs.unlinkSync(file);
        return { ok: true };
    }
}

module.exports = { CustomIcons, NATIVE_SIZE, safeSegment };
