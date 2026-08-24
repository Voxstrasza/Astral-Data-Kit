'use strict';

/*
 * The achievement tree: the category headings the in-game Achievements UI shows down its left
 * side, every achievement the client defines, and the criteria hanging off each one.
 *
 * All of this is client-side data. The world database records which character earned what, but
 * the title, description, points, reward text, icon and criteria that make up an achievement all
 * live in the DBCs — so, like the spell search, this needs a configured client and nothing else.
 *
 * Reading it rather than hard-coding a category list keeps the structure honest: "Statistics" is
 * a top-level heading in the data exactly as it is in game, and the Dungeons & Raids sub-headings
 * come out in their real patch order (Ulduar before Trial of the Crusader) without a lookup table
 * here saying so.
 */

const { Dbc, LOCALE_FIELDS } = require('./wow/dbc');

/*
 * Field indices, derived from the localised-column width rather than written as magic numbers,
 * and each table's total asserted against the field count in its own header — the same contract
 * lib/instances.js makes, which is what catches a wrong layout immediately instead of silently
 * reading the neighboring column.
 */
const ACHIEVEMENT = (() =>
{
    const f = { ID: 0, Faction: 1, Instance_Id: 2, Supercedes: 3, Title: 4 };
    f.Description = f.Title + LOCALE_FIELDS;      // 21
    f.Category = f.Description + LOCALE_FIELDS;   // 38
    f.Points = f.Category + 1;
    f.Ui_Order = f.Points + 1;
    f.Flags = f.Ui_Order + 1;
    f.IconID = f.Flags + 1;
    f.Reward = f.IconID + 1;                      // 43
    f.Minimum_Criteria = f.Reward + LOCALE_FIELDS; // 60
    f.Shares_Criteria = f.Minimum_Criteria + 1;
    f.COUNT = f.Shares_Criteria + 1;              // 62
    return f;
})();

const CATEGORY = (() =>
{
    const f = { ID: 0, Parent: 1, Name: 2 };
    f.Ui_Order = f.Name + LOCALE_FIELDS;          // 19
    f.COUNT = f.Ui_Order + 1;                     // 20
    return f;
})();

const CRITERIA = (() =>
{
    const f = {
        ID: 0, Achievement_Id: 1, Type: 2, Asset_Id: 3, Quantity: 4,
        Start_Event: 5, Start_Asset: 6, Fail_Event: 7, Fail_Asset: 8, Description: 9
    };
    f.Flags = f.Description + LOCALE_FIELDS;      // 26
    f.Timer_Start_Event = f.Flags + 1;
    f.Timer_Asset_Id = f.Timer_Start_Event + 1;
    f.Timer_Time = f.Timer_Asset_Id + 1;
    f.Ui_Order = f.Timer_Time + 1;
    f.COUNT = f.Ui_Order + 1;                     // 31
    return f;
})();

/* SpellIcon.dbc: ID, TextureFilename. Same table lib/spells.js reads. */
const ICON = { ID: 0, TextureFilename: 1, COUNT: 2 };

/*
 * Achievement.dbc's Faction column, which is -1 for the great majority. The two sides only
 * differ for PvP and a handful of world events.
 */
const FACTION = { '-1': 'both', 0: 'horde', 1: 'alliance' };

/*
 * The criteria types worth offering in an editor, out of the 102 the client defines.
 *
 * The long tail is almost entirely the Statistics tab — "Gold spent on postage", "Highest auction
 * bid", one row each, tracking a running total that no custom achievement is going to be built
 * around. What is listed here is every type used by more than about twenty achievements plus the
 * ones whose asset this program can already resolve, which is what makes them worth a picker: a
 * creature entry is what the NPC search returns, and an achievement id is what this module lists.
 *
 * `asset` names what Asset_Id points at, so the form knows which picker to attach. `quantity`
 * says whether the count is meaningful — for a kill-creature criterion it is always 1 and the
 * client shows just the creature's name, whereas a reputation criterion carries the standing.
 */
const CRITERIA_TYPES = [
    { type: 0, name: 'Kill a creature', asset: 'creature', quantity: true, hint: 'The creature to kill, by entry id.' },
    { type: 8, name: 'Complete an achievement', asset: 'achievement', quantity: false, hint: 'Used by every "Glory of..." meta-achievement.' },
    { type: 27, name: 'Complete a quest', asset: 'quest', quantity: false, hint: 'The quest id.' },
    { type: 28, name: 'Cast a spell', asset: 'spell', quantity: true, hint: 'The spell id.' },
    { type: 29, name: 'Cast a spell (on any target)', asset: 'spell', quantity: true, hint: 'Counts casts rather than a single use.' },
    { type: 36, name: 'Obtain an item', asset: 'item', quantity: true, hint: 'The item entry id.' },
    { type: 41, name: 'Use an item', asset: 'item', quantity: true, hint: 'The item entry id.' },
    { type: 43, name: 'Explore an area', asset: 'area', quantity: false, hint: 'An AreaTable id.' },
    { type: 46, name: 'Reach a reputation', asset: 'faction', quantity: true, hint: 'Quantity is the raw standing - 42,000 is Exalted.' },
    { type: 11, name: 'Complete quests in a zone', asset: 'area', quantity: true, hint: 'Quantity is how many quests.' },
    { type: 9, name: 'Complete a number of quests', asset: 'none', quantity: true, hint: 'Any quests, anywhere.' },
    { type: 14, name: 'Complete daily quests', asset: 'none', quantity: true, hint: '' },
    { type: 5, name: 'Reach a level', asset: 'none', quantity: true, hint: 'Quantity is the level.' },
    { type: 7, name: 'Raise a skill', asset: 'skill', quantity: true, hint: 'Quantity is the skill value.' },
    { type: 34, name: 'Catch a fish', asset: 'item', quantity: true, hint: '' },
    { type: 42, name: 'Loot an item', asset: 'item', quantity: true, hint: '' },
    { type: 57, name: 'Own an item', asset: 'item', quantity: true, hint: '' },
    { type: 68, name: 'Interact with an object', asset: 'object', quantity: true, hint: 'A GameObject entry id.' },
    { type: 1, name: 'Win a battleground', asset: 'map', quantity: true, hint: 'The battleground map id.' },
    { type: 31, name: 'Kill players in a zone', asset: 'area', quantity: true, hint: '' },
    { type: 52, name: 'Kill a player of a class', asset: 'class', quantity: true, hint: '' },
    { type: 53, name: 'Kill a player of a race', asset: 'race', quantity: true, hint: '' },
    { type: 75, name: 'Obtain companion pets', asset: 'none', quantity: true, hint: '' },
    { type: 78, name: 'Kill creatures', asset: 'none', quantity: true, hint: 'Any creature that yields experience.' },
    { type: 112, name: 'Learn recipes in a profession', asset: 'skill', quantity: true, hint: '' },
    { type: 0xFFFF, name: 'Custom', asset: 'none', quantity: true, hint: 'Write the line yourself; nothing is looked up.' }
];

/**
 * Splits an achievement's criteria into the ones the game shows and the ones it does not.
 *
 * A dungeon achievement in the client is not just "kill the boss". Mana-Tombs carries the kill
 * *and* a completed-quest row for "Undercutting the Competition"; the Battle for Mount Hyjal
 * carries Archimonde and then twenty-nine own-this-item rows, one per drop in the raid. They are
 * alternative ways to be credited, added when achievements arrived in 3.0 so that players who had
 * already cleared the content were awarded it retroactively — not a list of things to do.
 *
 * `Minimum_Criteria` is what says so: it is 1 on every one of them, meaning any single row
 * satisfies the achievement. So where an achievement needs one of several criteria and they are
 * not all the same kind, only the first kind is real — which for a dungeon is the boss kill, and
 * that is exactly what the in-game Achievements UI prints.
 *
 * Where `Minimum_Criteria` is anything else the criteria are a genuine list — "Storming the
 * Citadel" wants all four of its bosses, "Total gold acquired" sums several counters — so those
 * are left exactly as the client has them.
 *
 * Nothing is thrown away: what is filtered out comes back as `alternateCriteria`.
 */
function primaryCriteria(achievement)
{
    const list = achievement.criteria;

    if (achievement.minimumCriteria !== 1 || list.length < 2)
    {
        return { criteria: list, alternates: [] };
    }

    const primary = list[0].type;

    if (list.every((c) => c.type === primary))
    {
        return { criteria: list, alternates: [] };
    }

    return {
        criteria: list.filter((c) => c.type === primary),
        alternates: list.filter((c) => c.type !== primary)
    };
}

class Achievements
{
    constructor(assets)
    {
        this.assets = assets;
        this.cache = null;
    }

    /** Drops the parsed tables so the next read picks up a newly configured client. */
    reset()
    {
        this.cache = null;
    }

    read(name, fields)
    {
        const raw = this.assets.readEntry(`DBFilesClient\\${name}`);

        if (!raw)
        {
            throw new Error(`${name} is not in the client archives`);
        }

        const table = new Dbc(raw, name);

        if (fields && table.fieldCount !== fields.COUNT)
        {
            throw new Error(
                `${name}: expected ${fields.COUNT} fields, client has ${table.fieldCount} - layout changed`);
        }

        return table;
    }

    /**
     * All three tables, parsed once.
     *
     * About 9,500 rows in total and only a handful of columns kept from each, so this is well
     * inside what lib/instances.js does in memory and needs none of the on-disk caching the icon
     * index uses.
     */
    load()
    {
        if (this.cache)
        {
            return this.cache;
        }

        const achievementTable = this.read('Achievement.dbc', ACHIEVEMENT);
        const categoryTable = this.read('Achievement_Category.dbc', CATEGORY);
        const criteriaTable = this.read('Achievement_Criteria.dbc', CRITERIA);

        /*
         * IconID is an index into SpellIcon.dbc, not an icon name — the same table lib/spells.js
         * resolves. The icon's own name is the last path segment lower-cased, which is exactly
         * what the icon picker and iconUrl() take.
         */
        const icons = new Map(this.read('SpellIcon.dbc', ICON).map((r) =>
        {
            const file = r.string(ICON.TextureFilename).replace(/\\/g, '/');
            return [r.int(ICON.ID), file.split('/').pop().toLowerCase()];
        }));

        /* ------------------------------------------------------------------ categories */

        const categories = new Map();

        categoryTable.map((r) =>
        {
            const id = r.int(CATEGORY.ID);

            categories.set(id, {
                id,
                parent: r.int(CATEGORY.Parent),
                name: r.string(CATEGORY.Name),
                order: r.int(CATEGORY.Ui_Order),
                children: [],
                count: 0
            });
        });

        /*
         * A top-level heading is a row whose parent is not itself a category — the nine headings
         * plus Statistics all store -1. Testing for "not a known category" rather than for -1
         * specifically means a stray parent id cannot silently orphan a whole branch.
         */
        const roots = [];

        for (const category of categories.values())
        {
            const parent = categories.get(category.parent);

            if (parent)
            {
                parent.children.push(category);
            }
            else
            {
                roots.push(category);
            }
        }

        const byOrder = (a, b) => a.order - b.order;

        roots.sort(byOrder);

        for (const category of categories.values())
        {
            category.children.sort(byOrder);
        }

        /*
         * The Statistics branch is dropped here rather than left to the caller to skip.
         *
         * Statistics sit in the same DBC and hang off their own root — "Total deaths", "Quests
         * completed", 497 rows of them — but the game keeps them behind their own tab and out of
         * the achievement list, and none of them is something to build a card from. Matched by
         * the root's name rather than its id (1 in a 3.3.5a client) so a renumbered tree still
         * loses the right branch, and by branch rather than by Flags: only 10 of the 497 set the
         * STATISTIC bit, so the flag is not what the client is going on either.
         */
        const statistics = new Set();
        const statisticsRoot = roots.find((category) => category.name === 'Statistics');

        if (statisticsRoot)
        {
            const mark = (category) =>
            {
                statistics.add(category.id);
                category.children.forEach(mark);
            };

            mark(statisticsRoot);
            roots.splice(roots.indexOf(statisticsRoot), 1);
        }

        /* ---------------------------------------------------------------- achievements */

        const achievements = achievementTable.map((r) =>
        {
            const iconId = r.int(ACHIEVEMENT.IconID);

            return {
                id: r.int(ACHIEVEMENT.ID),
                title: r.string(ACHIEVEMENT.Title),
                description: r.string(ACHIEVEMENT.Description),
                reward: r.string(ACHIEVEMENT.Reward),
                category: r.int(ACHIEVEMENT.Category),
                points: r.int(ACHIEVEMENT.Points),
                order: r.int(ACHIEVEMENT.Ui_Order),
                flags: r.int(ACHIEVEMENT.Flags),
                faction: FACTION[r.int(ACHIEVEMENT.Faction)] || 'both',
                // 87 of the 1,817 rows point at a SpellIcon row the client does not ship; the
                // game's own placeholder is the honest answer for those.
                icon: icons.get(iconId) || 'inv_misc_questionmark',
                iconId,
                /*
                 * Minimum_Criteria is how many of the criteria below have to be met. Zero means
                 * all of them, which is the usual case — only progressive achievements like
                 * "Well Read" set it.
                 */
                minimumCriteria: r.int(ACHIEVEMENT.Minimum_Criteria),
                criteria: []
            };
        }).filter((a) => a.title && !statistics.has(a.category));

        const byId = new Map(achievements.map((a) => [a.id, a]));

        /* -------------------------------------------------------------------- criteria */

        criteriaTable.map((r) =>
        {
            const achievement = byId.get(r.int(CRITERIA.Achievement_Id));

            if (!achievement)
            {
                return;
            }

            achievement.criteria.push({
                id: r.int(CRITERIA.ID),
                type: r.int(CRITERIA.Type),
                asset: r.int(CRITERIA.Asset_Id),
                quantity: r.int(CRITERIA.Quantity),
                description: r.string(CRITERIA.Description),
                flags: r.int(CRITERIA.Flags),
                order: r.int(CRITERIA.Ui_Order)
            });
        });

        for (const achievement of achievements)
        {
            achievement.criteria.sort(byOrder);

            const split = primaryCriteria(achievement);
            achievement.criteria = split.criteria;
            achievement.alternateCriteria = split.alternates;

            const category = categories.get(achievement.category);

            if (category)
            {
                ++category.count;
            }
        }

        this.cache = { achievements, byId, categories, roots };

        return this.cache;
    }

    /**
     * The category tree as the page draws it, without the parent back-references that would make
     * it un-serializable.
     */
    tree()
    {
        const strip = (category) => ({
            id: category.id,
            name: category.name,
            order: category.order,
            count: category.count,
            children: category.children.map(strip)
        });

        return this.load().roots.map(strip);
    }

    /** One achievement in the shape the editor fills its fields from, or null. */
    get(id)
    {
        const achievement = this.load().byId.get(Number(id));

        return achievement ? Achievements.toEditor(achievement, this.load().categories) : null;
    }

    /** Every achievement in one category, in the order the in-game list shows them. */
    inCategory(id)
    {
        const target = Number(id);

        return this.load().achievements
            .filter((a) => a.category === target)
            .sort((a, b) => a.order - b.order || a.id - b.id)
            .map((a) => ({ id: a.id, title: a.title, points: a.points, icon: a.icon }));
    }

    /**
     * The path from a top-level heading down to a category, as names — "Dungeons & Raids /
     * Secrets of Ulduar 10-Player Raid". Loading an existing achievement should say where in the
     * tree it sits, and the id on its own says nothing.
     */
    categoryPath(id)
    {
        const { categories } = this.load();
        const parts = [];

        let category = categories.get(Number(id));

        // Guarded against a cycle in the data rather than trusting Parent to terminate.
        for (let depth = 0; category && depth < 8; ++depth)
        {
            parts.unshift(category.name);
            category = categories.get(category.parent);
        }

        return parts;
    }

    /** The editor shape: flat, named as the form's fields are, criteria already rendered. */
    static toEditor(achievement, categories)
    {
        const category = categories && categories.get(achievement.category);

        return {
            id: achievement.id,
            title: achievement.title,
            description: achievement.description,
            reward: achievement.reward,
            points: achievement.points,
            icon: achievement.icon,
            faction: achievement.faction,
            category: achievement.category,
            categoryName: category ? category.name : '',
            minimumCriteria: achievement.minimumCriteria,
            criteria: achievement.criteria.map((c) => ({
                type: c.type,
                asset: c.asset,
                quantity: c.quantity,
                // The DBC description is the line the game prints beside the tick. Plenty are
                // developer shorthand ("30 hks in arathi"), which is exactly why the editor lets
                // it be typed over rather than deriving the sentence from type and asset.
                text: c.description
            }))
        };
    }

    /**
     * Search by title, or by id when the query is a number.
     *
     * Same shape as the spell search beside it: exact id wins outright, then titles that start
     * with the query, then titles that merely contain it.
     */
    search(query, limit = 40)
    {
        const text = String(query || '').trim().toLowerCase();

        if (text.length < 2)
        {
            return [];
        }

        const { achievements, byId, categories } = this.load();

        if (/^\d+$/.test(text) && byId.has(Number(text)))
        {
            return [Achievements.toEditor(byId.get(Number(text)), categories)];
        }

        const starts = [];
        const contains = [];

        for (const achievement of achievements)
        {
            const lower = achievement.title.toLowerCase();

            if (lower.startsWith(text)) { starts.push(achievement); }
            else if (lower.includes(text)) { contains.push(achievement); }

            if (starts.length >= limit) { break; }
        }

        return [...starts, ...contains]
            .slice(0, limit)
            .map((a) => Achievements.toEditor(a, categories));
    }
}

module.exports = { Achievements, ACHIEVEMENT, CATEGORY, CRITERIA, CRITERIA_TYPES };
