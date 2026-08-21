'use strict';

/*
 * Reads assets straight out of a 3.3.5a client install.
 *
 * The program ships no icon library of its own: 6,307 icons is 25 MB of Blizzard artwork, and the
 * user already has all of it. Pointing at their client is both smaller and cleaner, and it tracks
 * whatever patch level they are on.
 *
 * Indexing means listing every file in thirteen archives — around 210,000 entries, which takes
 * long enough to be annoying on every launch — so the resulting name->location map is cached to
 * disk and re-used until the client's archives change.
 */

const fs = require('fs');
const path = require('path');

const MPQArchive = require('./wow/MPQArchive');
const blp = require('./wow/blp');
const png = require('./wow/png');

// Load order matters: later archives patch earlier ones, matching the client.
const ARCHIVES = [
    'common.MPQ',
    'common-2.MPQ',
    'expansion.MPQ',
    'lichking.MPQ',
    'enUS/locale-enUS.MPQ',
    'enUS/expansion-locale-enUS.MPQ',
    'enUS/lichking-locale-enUS.MPQ',
    'patch.MPQ',
    'patch-2.MPQ',
    'patch-3.MPQ',
    'enUS/patch-enUS.MPQ',
    'enUS/patch-enUS-2.MPQ',
    'enUS/patch-enUS-3.MPQ'
];

const ICON_PREFIX = 'INTERFACE\\ICONS\\';

/*
 * Only these trees get indexed. The archives hold ~196,000 entries, nearly all of them world
 * models and sounds we never touch; indexing everything made the on-disk cache 12.5 MB for no
 * benefit. UI art, fonts and the .dbc tables are all this program reads.
 *
 * DBFilesClient is a couple of hundred entries and holds the data the world database does not:
 * the instance list with its expansion and difficulties, and the achievement definitions.
 */
const INDEX_PREFIXES = ['INTERFACE\\', 'FONTS\\', 'DBFILESCLIENT\\'];

const INDEX_VERSION = 5;

class ClientAssets
{
    constructor(cacheDir)
    {
        this.cacheDir = cacheDir;
        this.iconCacheDir = path.join(cacheDir, 'icons');
        this.indexFile = path.join(cacheDir, 'client-index.json');

        this.clientPath = null;
        this.archives = [];       // open MPQArchive handles, in load order
        this.icons = new Map();   // lowercase name -> archive index
        this.files = new Map();   // uppercase full path -> archive index
        this.ready = false;
        this.error = null;
    }

    /** A client folder is valid if it has the Data directory with the base archive in it. */
    static validate(clientPath)
    {
        if (!clientPath)
        {
            return { ok: false, reason: 'No folder selected.' };
        }

        const data = path.join(clientPath, 'Data');

        if (!fs.existsSync(data))
        {
            return { ok: false, reason: `No "Data" folder inside ${clientPath}.` };
        }

        if (!fs.existsSync(path.join(data, 'common.MPQ')))
        {
            return { ok: false, reason: 'That folder has a Data directory but no common.MPQ — is it a 3.3.5a client?' };
        }

        return { ok: true };
    }

    /** Signature of the archive set, so a patched client invalidates the cached index. */
    fingerprint(clientPath)
    {
        const parts = [String(INDEX_VERSION), clientPath];

        for (const relative of ARCHIVES)
        {
            const file = path.join(clientPath, 'Data', relative);

            try
            {
                const stat = fs.statSync(file);
                parts.push(`${relative}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
            }
            catch
            {
                parts.push(`${relative}:absent`);
            }
        }

        return parts.join('|');
    }

    open(clientPath, { onProgress } = {})
    {
        this.close();

        const check = ClientAssets.validate(clientPath);

        if (!check.ok)
        {
            this.error = check.reason;
            return { ok: false, reason: check.reason };
        }

        this.clientPath = clientPath;
        const signature = this.fingerprint(clientPath);

        for (const relative of ARCHIVES)
        {
            const file = path.join(clientPath, 'Data', relative);

            if (!fs.existsSync(file))
            {
                continue;
            }

            try
            {
                this.archives.push({ relative, archive: new MPQArchive(file) });
            }
            catch (err)
            {
                // A missing optional patch archive is normal; a broken base one is not, but the
                // index below will simply come up short and the caller can report it.
                console.warn(`skip ${relative}: ${err.message}`);
            }
        }

        const cached = this.readIndexCache(signature);

        if (cached)
        {
            this.icons = cached.icons;
            this.files = cached.files;
        }
        else
        {
            this.buildIndex(onProgress);
            this.writeIndexCache(signature);
        }

        fs.mkdirSync(this.iconCacheDir, { recursive: true });

        this.ready = this.icons.size > 0;
        this.error = this.ready ? null : 'No icons found in that client.';

        return { ok: this.ready, reason: this.error, icons: this.icons.size };
    }

    buildIndex(onProgress)
    {
        this.icons = new Map();
        this.files = new Map();

        this.archives.forEach(({ relative, archive }, index) =>
        {
            if (onProgress)
            {
                onProgress({ archive: relative, done: index, total: this.archives.length });
            }

            for (const entry of archive.listFiles())
            {
                const upper = entry.toUpperCase();

                if (!INDEX_PREFIXES.some((prefix) => upper.startsWith(prefix)))
                {
                    continue;
                }

                // Later archives win, which is exactly the patch behaviour we want.
                this.files.set(upper, index);

                if (upper.startsWith(ICON_PREFIX) && upper.endsWith('.BLP'))
                {
                    this.icons.set(path.basename(entry, path.extname(entry)).toLowerCase(), index);
                }
            }
        });
    }

    readIndexCache(signature)
    {
        try
        {
            const raw = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));

            if (raw.signature !== signature)
            {
                return null;
            }

            return {
                icons: new Map(raw.icons),
                files: new Map(raw.files)
            };
        }
        catch
        {
            return null;
        }
    }

    writeIndexCache(signature)
    {
        try
        {
            fs.mkdirSync(this.cacheDir, { recursive: true });
            fs.writeFileSync(this.indexFile, JSON.stringify({
                signature,
                icons: [...this.icons],
                files: [...this.files]
            }));
        }
        catch (err)
        {
            console.warn(`could not cache client index: ${err.message}`);
        }
    }

    /** Raw bytes of an archive entry, honouring patch order. */
    readEntry(fullPath)
    {
        const index = this.files.get(fullPath.toUpperCase());

        if (index === undefined)
        {
            return null;
        }

        // The index stores the winning archive, but the entry name has to match its real casing;
        // MPQ lookups are case-insensitive so passing the requested path through is fine.
        return this.archives[index].archive.readFile(fullPath);
    }

    /**
     * Reads an icon's BLP, and looks in the other archives if the one the index names does not
     * hold it after all.
     *
     * The index stores an archive *position*, which only means anything for the exact list of
     * archives it was built against — so an index written by an older version of this program, or
     * against a Data folder that has since gained or lost a patch, can point somewhere that does
     * not have the file. Nothing catches that today: readFile returns null, the request 404s, and
     * the picker leaves a gap where the tile should be. inv_shoulder_94.tga was one of those, and
     * rebuilding the index is what fixed it — this makes the rebuild unnecessary.
     *
     * Later archives are searched first, which is the order in which a patch overrides a base file.
     */
    readIconFile(index, file)
    {
        const named = this.archives[index] && this.archives[index].archive.readFile(file);

        if (named && named.length)
        {
            return named;
        }

        for (let i = this.archives.length - 1; i >= 0; --i)
        {
            if (i === index)
            {
                continue;
            }

            const raw = this.archives[i].archive.readFile(file);

            if (raw && raw.length)
            {
                return raw;
            }
        }

        return null;
    }

    /**
     * An icon as PNG bytes. Decoding BLP is not free, so results are cached on disk — a browsing
     * session flicks through hundreds of icons and should not pay for each one twice.
     */
    getIconPng(name)
    {
        /*
         * The index is what makes this safe, not a character filter.
         *
         * Stripping everything outside [a-z0-9_-] was the old approach and it silently broke 24
         * icons: the client ships names containing an apostrophe, a space, a dot or an ampersand —
         * `achievement_dungeon_drak'tharon`, `achievement_leader_cairne bloodhoof`,
         * `ability_druid_mangle.tga` — and the stripped name matched nothing, so the picker showed
         * them as broken images. A name that is not in the index is refused outright, which is a
         * stronger guarantee than any character rule and costs those icons nothing.
         */
        /*
         * Matched exactly first, and only then with the ends trimmed.
         *
         * Trimming up front looks harmless and breaks seven icons: the client really does ship
         * names with a trailing space — "achievement_boss_archimonde ",
         * "inv_thanksgiving_sweetpotato ", "achievement_leader_lorthemar_theron " — and the space
         * is part of the name, so a trimmed key matches nothing. The trimmed attempt stays as a
         * fallback for a name that picked up whitespace on the way in rather than in the archive.
         */
        const exact = String(name).toLowerCase();
        const key = this.icons.has(exact) ? exact : exact.trim();

        if (!key || !this.icons.has(key))
        {
            return null;
        }

        // The cache file still has to be a safe, unique filename, so escape rather than delete.
        const cacheName = key.replace(/[^a-z0-9_-]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
        const cached = path.join(this.iconCacheDir, `${cacheName}.png`);

        try
        {
            return fs.readFileSync(cached);
        }
        catch
        {
            // Not cached yet — decode below.
        }

        const raw = this.readIconFile(this.icons.get(key), `Interface\\Icons\\${key}.blp`);

        if (!raw || !raw.length)
        {
            return null;
        }

        /*
         * A listed icon can still be unusable.
         *
         * inv_shoulder_94.tga is in the archive's file list and reads back as zero bytes, so
         * decoding it throws "not a BLP2 texture" — which reached the client as a 500 and looked
         * like the program was broken rather than that one entry being empty. A bad texture is a
         * missing icon, not a server error.
         */
        let image;

        try
        {
            image = blp.decode(raw);
        }
        catch
        {
            return null;
        }

        const buffer = png.encode(image.width, image.height, image.rgba);

        try
        {
            fs.writeFileSync(cached, buffer);
        }
        catch
        {
            // Caching is best effort; serving the bytes matters more.
        }

        return buffer;
    }

    /** Any BLP in the archives, returned as PNG (used for UI textures). */
    getTexturePng(fullPath)
    {
        const raw = this.readEntry(fullPath);

        if (!raw)
        {
            return null;
        }

        const image = blp.decode(raw);
        return png.encode(image.width, image.height, image.rgba);
    }

    getFont(fileName)
    {
        const safe = String(fileName).replace(/[^A-Za-z0-9_.]/g, '');
        return this.readEntry(`Fonts\\${safe}`);
    }

    listIcons()
    {
        return [...this.icons.keys()].sort();
    }

    status()
    {
        return {
            ready: this.ready,
            clientPath: this.clientPath,
            iconCount: this.icons.size,
            error: this.error
        };
    }

    close()
    {
        for (const { archive } of this.archives)
        {
            try
            {
                archive.close();
            }
            catch
            {
                // Closing a half-open archive is not worth failing over.
            }
        }

        this.archives = [];
        this.icons = new Map();
        this.files = new Map();
        this.ready = false;
    }
}

module.exports = { ClientAssets, ARCHIVES };
