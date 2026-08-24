'use strict';

/*
 * Raids, kept as files you own.
 *
 * A raid is a document — a name, a logo and a list of bosses — and it lives in the app's data
 * folder beside the custom icons rather than in a database. That is the same decision, for the
 * same reason: `dist\` is rewritten wholesale by every repackage and the client index is thrown
 * away whenever the client changes, so anything the user made has to sit outside both. A raid
 * survives a reinstall because nothing the installer touches knows about it.
 *
 * One JSON file per raid, named by its id. There is no index file: a folder listing is the index,
 * and a folder cannot disagree with itself the way an index and its contents can.
 *
 * Nothing here validates the shape of a boss beyond giving it an id. The wizard is a design
 * document, and half-finished designs are the normal case — a boss with a name and nothing else is
 * a boss someone is still thinking about, not a file to reject.
 */

const fs = require('fs');
const path = require('path');

const { newId, safeId } = require('./ids.js');

/*
 * The four difficulties a Wrath raid boss can be built for.
 *
 * A boss is not required to have all four — a Classic or TBC raid has one, and a five-man has
 * Normal and Heroic — so these are slots rather than a schema. Whichever ones have a frame in them
 * are the ones the boss offers.
 */
const DIFFICULTIES = [
    { id: '10n', name: '10 Normal' },
    { id: '25n', name: '25 Normal' },
    { id: '10h', name: '10 Heroic' },
    { id: '25h', name: '25 Heroic' }
];

/** An empty difficulty: the fight at one size, with nothing in it yet. */
function newDifficulty(id, name)
{
    return {
        id,
        name,

        /*
         * The creatures in the fight, not the creature. A council is four, a twin fight two, and a
         * fight with summoned adds has the boss plus whatever it brings — each with its own frame
         * and its own spells, because "what does this one cast" is a question about a creature
         * rather than about the encounter.
         */
        npcs: [],

        /* Named moments. A spell says which one it belongs to; the sheet groups by them. */
        phases: [],

        loot: [],
        achievements: [],
        lines: []
    };
}

/** A boss as it is stored: a name, and the difficulties it has been built for. */
function newBoss(id, { name, note, frame, difficulty })
{
    const boss = {
        id,
        name: (name || '').trim() || (frame && frame.unitName) || 'Unnamed boss',
        note: note || '',
        difficulties: [],

        /* Kept for the roster's summary line, and for raids written before difficulties existed. */
        frame: frame || null
    };

    /*
     * A boss added from the dungeon browser arrives at a difficulty already, so that difficulty is
     * created for it with the creature in place — the common path should not need setting up.
     */
    if (frame)
    {
        const chosen = DIFFICULTIES.find((d) => d.id === (difficulty || '10n')) || DIFFICULTIES[0];
        const built = newDifficulty(chosen.id, chosen.name);

        built.npcs.push({
            id: newId('npc'),
            name: frame.unitName || boss.name,
            role: 'boss',
            frame,
            spells: []
        });

        boss.difficulties.push(built);
    }

    return boss;
}

class Raids
{
    constructor(rootDir)
    {
        this.root = rootDir;
    }

    ensure()
    {
        fs.mkdirSync(this.root, { recursive: true });
    }

    file(id)
    {
        const safe = safeId(id);

        return safe ? path.join(this.root, `${safe}.json`) : '';
    }

    /**
     * Every raid, newest first, without their bosses.
     *
     * The list only needs enough to draw a card, and a raid with forty bosses in it would make the
     * list a megabyte of JSON for a name and a logo.
     */
    list()
    {
        this.ensure();

        const raids = [];

        for (const entry of fs.readdirSync(this.root))
        {
            if (!entry.endsWith('.json'))
            {
                continue;
            }

            const raid = this.read(entry.replace(/\.json$/, ''));

            if (raid)
            {
                raids.push({
                    id: raid.id,
                    name: raid.name,
                    icon: raid.icon,
                    note: raid.note || '',
                    bosses: (raid.bosses || []).length,
                    updated: raid.updated || 0
                });
            }
        }

        return raids.sort((a, b) => b.updated - a.updated);
    }

    /** One raid in full, or null when the file is missing or unreadable. */
    read(id)
    {
        const file = this.file(id);

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
            /*
             * A file that will not parse is left alone rather than repaired or deleted. It is the
             * user's work, and a half-written raid is worth more to them than a tidy folder.
             */
            return null;
        }
    }

    create({ name, icon, note })
    {
        this.ensure();

        const raid = {
            id: newId('raid'),
            name: (name || '').trim() || 'New raid',
            icon: icon || 'inv_misc_questionmark',
            note: note || '',
            bosses: [],
            created: Date.now(),
            updated: Date.now()
        };

        this.write(raid);

        return raid;
    }

    /** Writes a raid back, stamping it so the list can order by what was touched last. */
    write(raid)
    {
        this.ensure();

        const file = this.file(raid.id);

        if (!file)
        {
            return null;
        }

        raid.updated = Date.now();
        fs.writeFileSync(file, JSON.stringify(raid, null, 2));

        return raid;
    }

    /**
     * Merges a patch into a raid.
     *
     * A patch rather than a whole document, because two things edit a raid at once — the list
     * renames it while the boss panel is adding to it — and sending the whole thing back from
     * either would drop what the other just did.
     */
    update(id, patch)
    {
        const raid = this.read(id);

        if (!raid)
        {
            return null;
        }

        for (const [key, value] of Object.entries(patch || {}))
        {
            if (key !== 'id' && key !== 'created')
            {
                raid[key] = value;
            }
        }

        return this.write(raid);
    }

    remove(id)
    {
        const file = this.file(id);

        if (!file || !fs.existsSync(file))
        {
            return false;
        }

        fs.unlinkSync(file);

        return true;
    }

    /**
     * Adds a boss to a raid from whatever was copied out of the NPC window.
     *
     * The frame arrives as the editor's own unit fields, so a boss carries its health, its power,
     * its classification and its portrait id — everything needed to draw the frame again without
     * asking the database a second time. A raid built from a database that later goes away still
     * reads correctly.
     */
    addBoss(id, { name, frame, note, difficulty })
    {
        const raid = this.read(id);

        if (!raid)
        {
            return null;
        }

        raid.bosses = raid.bosses || [];
        raid.bosses.push(newBoss(newId('boss'), { name, note, frame, difficulty }));

        return this.write(raid);
    }

    /** Replaces one boss wholesale; the boss panel owns everything inside a boss. */
    updateBoss(id, bossId, patch)
    {
        const raid = this.read(id);

        if (!raid)
        {
            return null;
        }

        const boss = (raid.bosses || []).find((b) => b.id === bossId);

        if (!boss)
        {
            return null;
        }

        for (const [key, value] of Object.entries(patch || {}))
        {
            if (key !== 'id')
            {
                boss[key] = value;
            }
        }

        return this.write(raid);
    }

    removeBoss(id, bossId)
    {
        const raid = this.read(id);

        if (!raid)
        {
            return null;
        }

        raid.bosses = (raid.bosses || []).filter((boss) => boss.id !== bossId);

        return this.write(raid);
    }

    /** Moves a boss up or down the roster, which is the order a raid is run in. */
    moveBoss(id, bossId, delta)
    {
        const raid = this.read(id);

        if (!raid)
        {
            return null;
        }

        const bosses = raid.bosses || [];
        const from = bosses.findIndex((boss) => boss.id === bossId);
        const to = from + Number(delta);

        if (from === -1 || to < 0 || to >= bosses.length)
        {
            return raid;
        }

        const [moved] = bosses.splice(from, 1);
        bosses.splice(to, 0, moved);

        return this.write(raid);
    }
}

module.exports = { Raids };
