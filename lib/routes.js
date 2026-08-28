'use strict';

/*
 * The app's data API, served to the window over the app:// scheme. Each handler returns
 * { status, type, body } and never touches transport details, so the routing is testable on its
 * own and the shell is left holding nothing but the protocol.
 */

const { NATIVE_SIZE } = require('./custom-icons');
const { CRITERIA_TYPES } = require('./achievements');
const items = require('./items');
const { chestsFor } = require('./encounter-chests');
const modelHelm = require('./model-helm');

/*
 * Which build this is, read from the one place that already says so.
 *
 * package.json is what the packager stamps onto the exe, so a version shown in the window and a
 * version shown by the file's properties cannot disagree.
 */
const { version: VERSION } = require('../package.json');

const MODEL_CONTENT = 'https://wowgaming.altervista.org/modelviewer/data/get.php?path=';
const MODEL_SCRIPT = 'https://wowgaming.altervista.org/modelviewer/scripts/viewer.min.js';

const LATEST_RELEASE = 'https://api.github.com/repos/Voxstrasza/Astral-Data-Kit/releases/latest';

/*
 * Is there a newer release than the one running?
 *
 * Asked once per run and then remembered, whatever the answer. A release is cut every few
 * weeks and the program is the kind of thing left open all day, so asking again would be
 * hammering someone else's server to learn nothing.
 */
let updateAnswer = null;

/** Numeric compare, so 1.10.0 is above 1.9.0 rather than below it as a string sort has it. */
function isNewer(candidate, current)
{
    const parts = (text) => String(text).replace(/^v/i, '').split('.').map((n) => Number(n) || 0);

    const a = parts(candidate);
    const b = parts(current);

    for (let i = 0; i < Math.max(a.length, b.length); i++)
    {
        const left = a[i] || 0;
        const right = b[i] || 0;

        if (left !== right) { return left > right; }
    }

    return false;
}

/*
 * Every failure here is the same answer: say nothing.
 *
 * No network, a rate limit, GitHub down, a tag that is not a version - none of them are the
 * user's problem and none of them are worth a message. The notice exists to tell someone
 * there is something new, not to report on the health of a website.
 */
async function checkForUpdate(current)
{
    if (updateAnswer) { return updateAnswer; }

    updateAnswer = { available: false, current, latest: '' };

    try
    {
        const response = await fetch(LATEST_RELEASE, {
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Astral/${current}` },
            signal: AbortSignal.timeout(8000)
        });

        if (!response.ok) { return updateAnswer; }

        const release = await response.json();
        const latest = String(release.tag_name || '').replace(/^v/i, '');

        if (latest && isNewer(latest, current))
        {
            updateAnswer = { available: true, current, latest, url: release.html_url || '' };
        }
    }
    catch
    {
        /* Offline is the common case and is not a fault. */
    }

    return updateAnswer;
}

const json = (value, status = 200) => ({ status, type: 'application/json; charset=utf-8', body: JSON.stringify(value) });

/**
 * One piece of model data as parsed JSON, for the rewrites that need to read a second file.
 *
 * Customization data is a few hundred kilobytes and is asked for once per model loaded, so it is
 * held for the life of the process rather than fetched again for every NPC of the same race.
 */
const modelJsonCache = new Map();

async function fetchModelJson(target)
{
    if (modelJsonCache.has(target))
    {
        return modelJsonCache.get(target);
    }

    const response = await fetchModelPart(MODEL_CONTENT + encodeURIComponent(target));

    if (!response.ok)
    {
        return null;
    }

    const data = JSON.parse(await response.text());
    modelJsonCache.set(target, data);

    return data;
}

/**
 * Fetches one model part, with a single retry.
 *
 * A model is dozens of separate requests — the model file, every armor piece, every texture — and
 * the viewer treats a failed one as an absent one rather than an error: the piece is simply not
 * drawn. A helmet lost that way leaves a head whose hair and face geosets were already hidden for
 * it, which looks like a hole in the model rather than a failed download. One retry costs nothing
 * against a hiccup upstream and removes the commonest way that happens.
 */
async function fetchModelPart(url)
{
    try
    {
        const response = await fetch(url);

        // 4xx is an answer — the part genuinely is not there, and asking twice will not change it.
        if (response.status < 500)
        {
            return response;
        }
    }
    catch
    {
        // Connection-level failure: worth one more go.
    }

    return fetch(url);
}
const notFound = () => ({ status: 404, type: 'text/plain', body: 'Not found' });

/**
 * @param {object} ctx  { assets, settings, worldDb, reopenClient }
 */
async function handle(ctx, pathname, params, requestBody)
{
    const { assets, settings, worldDb, itemDisplay, itemBudget, character, raids, saved, portraitCameras, spells } = ctx;

    /* ---------------------------------------------------------------- status & settings */

    /** Whether a newer release is out. Answered once per run; silent about every failure. */
    if (pathname === '/api/update')
    {
        return json(await checkForUpdate(VERSION));
    }

    if (pathname === '/api/status')
    {
        return json({
            version: VERSION,
            client: assets.status(),
            db: { connected: worldDb.connected, error: worldDb.lastError },
            settings: settings.redacted()
        });
    }

    if (pathname === '/api/settings' && requestBody)
    {
        const patch = JSON.parse(requestBody);
        settings.save(patch);

        const result = { saved: true };

        if (patch.clientPath !== undefined)
        {
            result.client = ctx.reopenClient();
        }

        if (patch.db !== undefined)
        {
            result.db = settings.data.db.enabled
                ? await worldDb.connect(settings.data.db)
                : (worldDb.disconnect(), { ok: false, reason: 'disabled' });
        }

        return json(result);
    }

    /* ------------------------------------------------------------------------- client assets */

    if (pathname === '/api/client/icons')
    {
        return assets.ready ? json(assets.listIcons()) : json([], 200);
    }

    if (pathname.startsWith('/client/icon/'))
    {
        const name = decodeURIComponent(pathname.slice('/client/icon/'.length)).replace(/\.png$/i, '');
        const buffer = assets.ready ? assets.getIconPng(name) : null;

        return buffer
            ? { status: 200, type: 'image/png', body: buffer, cache: 'public, max-age=86400' }
            : notFound();
    }

    if (pathname.startsWith('/client/font/'))
    {
        const file = decodeURIComponent(pathname.slice('/client/font/'.length));
        const buffer = assets.ready ? assets.getFont(file) : null;

        return buffer
            ? { status: 200, type: 'font/ttf', body: buffer, cache: 'public, max-age=86400' }
            : notFound();
    }

    if (pathname.startsWith('/client/texture/'))
    {
        const file = decodeURIComponent(pathname.slice('/client/texture/'.length));
        const buffer = assets.ready ? assets.getTexturePng(file) : null;

        return buffer
            ? { status: 200, type: 'image/png', body: buffer, cache: 'public, max-age=86400' }
            : notFound();
    }

    /* ----------------------------------------------------------------------------- NPC search */

    if (pathname === '/api/npc/search')
    {
        if (!worldDb.connected)
        {
            return json({ error: 'not-connected', results: [] });
        }

        const query = (params.get('q') || '').trim();

        if (query.length < 2)
        {
            return json({ results: [] });
        }

        try
        {
            return json({ results: await worldDb.searchCreatures(query) });
        }
        catch (err)
        {
            return json({ error: err.code || err.message, results: [] });
        }
    }

    /* ---------------------------------------------------------------------- saved work */

    /*
     * Items and achievements you have kept, so a set of them can be drawn as one sheet. Files in
     * the app's own folder, so none of this needs a client or a database.
     */
    if (pathname === '/api/saved')
    {
        return json({ saved: saved.list(params.get('kind')) });
    }

    if (pathname === '/api/saved/save' && requestBody)
    {
        const body = JSON.parse(requestBody);
        const entry = saved.save(body.kind, body);

        return entry ? json({ entry }) : json({ error: 'unknown-kind' });
    }

    if (pathname === '/api/saved/delete' && requestBody)
    {
        const body = JSON.parse(requestBody);

        return json({ deleted: saved.remove(body.kind, body.id) });
    }

    /* ---------------------------------------------------------------------- raid wizard */

    /*
     * Raids are files in the app's own data folder, so none of this needs a client or a database —
     * a raid opens whether or not either is configured.
     */
    if (pathname === '/api/raids')
    {
        return json({ raids: raids.list() });
    }

    if (pathname === '/api/raids/get')
    {
        const raid = raids.read(params.get('id'));

        return raid ? json({ raid }) : json({ error: 'not-found' });
    }

    if (pathname === '/api/raids/create' && requestBody)
    {
        const body = JSON.parse(requestBody);

        return json({ raid: raids.create(body) });
    }

    if (pathname === '/api/raids/update' && requestBody)
    {
        const body = JSON.parse(requestBody);
        const raid = raids.update(body.id, body.patch);

        return raid ? json({ raid }) : json({ error: 'not-found' });
    }

    if (pathname === '/api/raids/delete' && requestBody)
    {
        const body = JSON.parse(requestBody);

        return json({ deleted: raids.remove(body.id) });
    }

    if (pathname === '/api/raids/boss/add' && requestBody)
    {
        const body = JSON.parse(requestBody);
        const raid = raids.addBoss(body.id, body);

        return raid ? json({ raid }) : json({ error: 'not-found' });
    }

    if (pathname === '/api/raids/boss/update' && requestBody)
    {
        const body = JSON.parse(requestBody);
        const raid = raids.updateBoss(body.id, body.bossId, body.patch);

        return raid ? json({ raid }) : json({ error: 'not-found' });
    }

    if (pathname === '/api/raids/boss/delete' && requestBody)
    {
        const body = JSON.parse(requestBody);
        const raid = raids.removeBoss(body.id, body.bossId);

        return raid ? json({ raid }) : json({ error: 'not-found' });
    }

    if (pathname === '/api/raids/boss/move' && requestBody)
    {
        const body = JSON.parse(requestBody);
        const raid = raids.moveBoss(body.id, body.bossId, body.delta);

        return raid ? json({ raid }) : json({ error: 'not-found' });
    }

    /* ---------------------------------------------------------------------- item finder */

    /*
     * Item search and loot both need the client for icons and the database for the items
     * themselves, so each degrades on its own: no database means no results, no client means
     * results without icons rather than no results at all.
     */
    if (pathname === '/api/item/search')
    {
        if (!worldDb.connected)
        {
            return json({ error: 'not-connected', results: [] });
        }

        const query = (params.get('q') || '').trim();

        if (query.length < 2)
        {
            return json({ results: [] });
        }

        try
        {
            /* A search opened from an Armory slot is filtered to what fits it, so looking for a
               helm from the boots slot cannot answer. Absent, the search is the Item window's. */
            const rows = await worldDb.searchItems(query, 40, items.slotTypes(params.get('slot')));

            return json({ results: rows.map((row) => items.toResult(row, itemDisplay.icon(row.displayid))) });
        }
        catch (err)
        {
            return json({ error: err.code || err.message, results: [] });
        }
    }

    /** One item, in the shape the item editor's fields take. */
    if (pathname === '/api/item/get')
    {
        if (!worldDb.connected)
        {
            return json({ error: 'not-connected' });
        }

        const entry = Number(params.get('entry'));

        try
        {
            const [row] = await worldDb.itemsByEntry([entry]);

            if (!row)
            {
                return json({ error: 'not-found' });
            }

            /*
             * An item's Equip and Use lines are the attached spell's description, which only
             * the client has. Without one the lines are left out rather than printed empty.
             */
            const spellText = assets.ready ? (id) => spells.describe(id) : null;

            return json({
                item: items.toEditor(
                    row,
                    itemDisplay.icon(row.displayid),
                    itemDisplay.enchantName(row.socketBonus),
                    spellText)
            });
        }
        catch (err)
        {
            return json({ error: err.code || err.message });
        }
    }

    /** Everything one boss drops, references followed. */
    if (pathname === '/api/item/loot')
    {
        if (!worldDb.connected)
        {
            return json({ error: 'not-connected', results: [] });
        }

        const asked = Number(params.get('creature'));
        const also = (params.get('also') || '').split(',').map(Number).filter(Boolean);
        const chests = (params.get('chests') || '').split(',').map(Number).filter(Boolean);

        /*
         * An encounter can be all members and no creature of its own.
         *
         * The Assembly of Iron credits nobody in instance_encounters, so the roster sends its
         * three bosses as `also` with no `creature` at all - and this returned an empty list
         * for a fight that drops eighteen items. Whichever of them arrives first stands in as
         * the creature asked about; the loot is merged across all of them either way.
         */
        const entry = asked || also[0] || 0;
        const rest = asked ? also : also.slice(1);

        if (!entry && !chests.length)
        {
            return json({ results: [] });
        }

        try
        {
            /*
             * A fight can pay out both ways — the Twin Val'kyr drop from both sisters, Valithria
             * pays entirely through a cache — so both sources are read and merged on item id.
             */
            const fromCreature = entry ? await worldDb.lootForCreature(entry, { also: rest }) : [];
            const fromChests = chests.length ? await worldDb.lootForGameObjects(chests) : [];

            const merged = new Map();

            for (const row of [...fromCreature, ...fromChests])
            {
                if (!merged.has(row.entry))
                {
                    merged.set(row.entry, row);
                }
            }

            const rows = [...merged.values()]
                .sort((a, b) => b.Quality - a.Quality || b.ItemLevel - a.ItemLevel || a.name.localeCompare(b.name));

            /*
             * Currency and crafting materials are dropped from the per-boss list on purpose. Every
             * boss in a tier hands out the same emblem and the same orbs, so repeating them under
             * each one says nothing about that boss — they live under Misc instead, once per
             * expansion. Mounts stay: a mount really is one boss's drop.
             */
            return json({
                results: rows
                    .map((row) => items.toResult(row, itemDisplay.icon(row.displayid)))
                    .filter((row) => row.category !== 'currency' && row.category !== 'material')
            });
        }
        catch (err)
        {
            return json({ error: err.code || err.message, results: [] });
        }
    }

    /** Emblems and mounts, listed once per expansion rather than under every boss. */
    if (pathname === '/api/item/misc')
    {
        if (!worldDb.connected)
        {
            return json({ error: 'not-connected', results: [] });
        }

        const kind = ['mounts', 'materials', 'currency'].includes(params.get('kind'))
            ? params.get('kind') : 'currency';
        const expansion = Number(params.get('xpac') || 0);

        try
        {
            const rows = await worldDb.miscLoot(kind, expansion);

            return json({ results: rows.map((row) => items.toResult(row, itemDisplay.icon(row.displayid))) });
        }
        catch (err)
        {
            return json({ error: err.code || err.message, results: [] });
        }
    }

    /* ---------------------------------------------------------------------- item budget */

    /*
     * The tier maths. All client-side — RandPropPoints.dbc and the measured tables in
     * lib/item-budget.js — so these answer with no database configured.
     */
    if (pathname === '/api/budget/describe')
    {
        try
        {
            return json(itemBudget.describe());
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    if (pathname === '/api/budget/generate')
    {
        try
        {
            /* The slot arrives as either an InventoryType or the editor's own label. */
            const slot = params.get('slot');
            const inventoryType = /^d+$/.test(slot || '') ? Number(slot) : items.inventoryTypeFor(slot);

            /*
             * A weapon spends part of its budget on damage, so it has to say it is one — and
             * whether it is a caster weapon, which is the difference between a staff that hits
             * hard and one that carries three times the stats.
             */
            const weapon = params.get('weapon') === '1'
                ? {
                    caster: params.get('caster') === '1',
                    wand: params.get('wand') === '1',
                    thrown: params.get('thrown') === '1',
                    speed: Number(params.get('speed')) || 2.6
                }
                : null;

            const secondaries = (params.get('secondaries') || '')
                .split(',').map((name) => name.trim()).filter(Boolean);

            const made = itemBudget.generate({
                ilvl: Number(params.get('ilvl')),
                quality: Number(params.get('quality') || 4),
                inventoryType,
                role: params.get('role') || 'melee-str',
                sockets: Number(params.get('sockets') || 0),
                socketBonus: params.get('socketBonus') === '1',
                weapon,
                secondaries: secondaries.length ? secondaries : null
            });

            return made
                ? json({ ...made, editor: items.editorLines(made.stats) })
                : json({ error: 'no-budget' });
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    if (pathname === '/api/budget/identify' && requestBody)
    {
        try
        {
            const body = JSON.parse(requestBody);

            /*
             * Two shapes are accepted: the budget's own {str: 209} block, or the editor's stat
             * rows and green lines. The editor sends the latter, since that is what it holds.
             */
            const stats = Array.isArray(body.stats)
                ? items.budgetStats({ stats: body.stats, effects: body.effects })
                : (body.stats || {});

            const inventoryType = body.slot
                ? items.inventoryTypeFor(body.slot)
                : Number(body.inventoryType);

            const answer = itemBudget.identify({
                stats,
                quality: Number(body.quality || 4),
                inventoryType,
                sockets: Number(body.sockets || 0),
                socketBonus: !!body.socketBonus,
                weapon: body.weapon || null
            });

            return json(answer ? { ...answer, priced: stats, inventoryType } : { error: 'no-budget' });
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    if (pathname === '/api/budget/weapon')
    {
        try
        {
            return json(itemBudget.weaponDamage(
                params.get('kind') || 'oneHand',
                Number(params.get('ilvl')),
                Number(params.get('speed') || 2.6)
            ) || { error: 'no-curve' });
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    /* -------------------------------------------------------------------------- armory */

    /*
     * The character sheet's numbers. Client-side like the budget above: the conversion tables are
     * the client's own gt* files and the base stats are baked into lib/character-stats.js, so the
     * Armory answers with no database configured.
     */
    if (pathname === '/api/character/setup')
    {
        try
        {
            /* The slot table travels with the setup so the panel can filter saved work itself
               without keeping a second copy of what each slot accepts. */
            return json({ ...character.setup(), slots: items.slotNameTable() });
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    /*
     * One race's racials, with what each is worth on the sheet.
     *
     * Derived from the client's own skill lines rather than listed, so a race this program has
     * never heard of still answers, and the ones that change nothing come back saying so instead
     * of being dropped.
     */
    if (pathname === '/api/character/racials')
    {
        try
        {
            const byId = assets.ready ? spells.load().byId : null;

            return json({
                racials: character.racials(
                    Number(params.get('race')), (id) => spells.info(id), byId)
            });
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    /*
     * One class's three trees, for the talent calculator.
     *
     * The words and the art are the spells behind each rank, so this needs the client and nothing
     * else - a character's talents are readable with no database configured, the same as the rest
     * of the Armory.
     */
    if (pathname === '/api/character/talents')
    {
        try
        {
            return json({
                tabs: character.talents(
                    Number(params.get('class')), (id) => spells.info(id))
            });
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    /*
     * The sheet, naked on a GET and wearing something on a POST.
     *
     * Equipped items travel whole rather than as references, because half of them will not have an
     * entry to refer to: a piece invented in the Item window and never saved is exactly the case
     * the Armory exists for, and it has no id anywhere.
     */
    if (pathname === '/api/character/sheet')
    {
        try
        {
            const body = requestBody ? JSON.parse(requestBody) : {};
            const gear = body.items ? items.equipped(body.items) : {};
            const race = Number(body.race || params.get('race'));
            const cls = Number(body.class || params.get('class'));

            /*
             * Racials and talents are the same thing to the client - passive spells whose effects
             * apply auras - so they are read the same way and handed over as one list. Which of a
             * racial's auras count is decided further in, where the weapons are known.
             */
            const byId = assets.ready ? spells.load().byId : null;
            const auras = [];

            if (byId)
            {
                for (const racial of character.racials(race, (id) => spells.info(id), byId))
                {
                    auras.push(...racial.stats);
                }

                auras.push(...character.talentAuras(cls, body.talents, byId));
            }

            const sheet = character.sheet(
                race,
                cls,
                Number(body.level || params.get('level')) || 80,
                gear,
                auras);

            return json(sheet || { error: 'no such race, class and level' });
        }
        catch (err)
        {
            return json({ error: err.message });
        }
    }

    /* --------------------------------------------------------------------- custom icons */

    /*
     * Icons the user supplies. These work with no client configured at all — they are the one
     * source of art this program does own, so the picker can still offer something useful before
     * anyone points it at a WoW install.
     */
    if (pathname === '/api/custom/icons')
    {
        return json({
            folders: ctx.customIcons.folders(),
            icons: ctx.customIcons.list(),
            nativeSize: NATIVE_SIZE
        });
    }

    if (pathname === '/api/custom/folder' && requestBody)
    {
        return json(ctx.customIcons.createFolder(JSON.parse(requestBody).name));
    }

    if (pathname === '/api/custom/folder/delete' && requestBody)
    {
        return json(ctx.customIcons.removeFolder(JSON.parse(requestBody).name));
    }

    if (pathname === '/api/custom/upload' && requestBody)
    {
        const { folder, name, data } = JSON.parse(requestBody);

        // The page sends a data URL; only the base64 payload after the comma is the file.
        const base64 = String(data || '').replace(/^data:[^,]*,/, '');
        const buffer = Buffer.from(base64, 'base64');

        if (buffer.length > 2 * 1024 * 1024)
        {
            return json({ ok: false, reason: 'That file is larger than 2 MB.' });
        }

        return json(ctx.customIcons.save(folder, name, buffer));
    }

    if (pathname === '/api/custom/delete' && requestBody)
    {
        return json(ctx.customIcons.remove(JSON.parse(requestBody).path));
    }

    if (pathname.startsWith('/custom/icon/'))
    {
        const reference = decodeURIComponent(pathname.slice('/custom/icon/'.length)).replace(/\.png$/i, '');
        const buffer = ctx.customIcons.read(reference);

        return buffer
            ? { status: 200, type: 'image/png', body: buffer, cache: 'no-cache' }
            : notFound();
    }

    /* --------------------------------------------------------------------- spell search */

    /*
     * Spells come out of the client, not the database — the name, rank, description, cast time,
     * range and icon a tooltip shows all live in Spell.dbc. So this needs a client and nothing
     * else, unlike the NPC search beside it.
     */
    if (pathname === '/api/spells/search')
    {
        if (!assets.ready)
        {
            return json({ error: 'no-client', results: [] });
        }

        const query = (params.get('q') || '').trim();

        if (query.length < 2)
        {
            return json({ results: [] });
        }

        try
        {
            return json({ results: ctx.spells.search(query) });
        }
        catch (err)
        {
            return json({ error: err.message, results: [] });
        }
    }

    /* --------------------------------------------------------------------- achievements */

    /*
     * Achievements are client data for the same reason spells are: the world database records who
     * earned what, but the title, description, points, reward, icon and criteria that make up the
     * definition all live in the DBCs. So this needs a client and no database at all.
     */
    if (pathname === '/api/achievements/categories')
    {
        if (!assets.ready)
        {
            return json({ error: 'no-client', categories: [], criteriaTypes: CRITERIA_TYPES });
        }

        try
        {
            return json({ categories: ctx.achievements.tree(), criteriaTypes: CRITERIA_TYPES });
        }
        catch (err)
        {
            return json({ error: err.message, categories: [], criteriaTypes: CRITERIA_TYPES });
        }
    }

    if (pathname === '/api/achievements/search')
    {
        if (!assets.ready)
        {
            return json({ error: 'no-client', results: [] });
        }

        const query = (params.get('q') || '').trim();

        if (query.length < 2)
        {
            return json({ results: [] });
        }

        try
        {
            return json({ results: ctx.achievements.search(query) });
        }
        catch (err)
        {
            return json({ error: err.message, results: [] });
        }
    }

    /* The list behind one category, for browsing the tree instead of searching it. */
    if (pathname === '/api/achievements/category')
    {
        if (!assets.ready)
        {
            return json({ error: 'no-client', achievements: [] });
        }

        try
        {
            const id = params.get('id');

            return json({
                path: ctx.achievements.categoryPath(id),
                achievements: ctx.achievements.inCategory(id)
            });
        }
        catch (err)
        {
            return json({ error: err.message, achievements: [] });
        }
    }

    /*
     * One achievement, whole.
     *
     * The category list carries only what a row shows — title, points, icon — so picking one out
     * of the tree needs its description, reward and criteria fetched separately. A search result
     * already arrives in the full shape, which is why only the browse path comes through here.
     */
    if (pathname === '/api/achievements/get')
    {
        if (!assets.ready)
        {
            return json({ error: 'no-client', achievement: null });
        }

        try
        {
            return json({ achievement: ctx.achievements.get(params.get('id')) });
        }
        catch (err)
        {
            return json({ error: err.message, achievement: null });
        }
    }

    /* ------------------------------------------------------------------------ instances */

    /*
     * The instance tree comes from the client's own DBCs, so it works with no database at all —
     * you get the dungeon and raid lists and their difficulty buttons, just no creatures behind
     * them. The bosses need the database, and are fetched per instance.
     */
    if (pathname === '/api/instances')
    {
        if (!assets.ready)
        {
            return json({ error: 'no-client', expansions: [] });
        }

        try
        {
            return json({ expansions: ctx.instances.tree() });
        }
        catch (err)
        {
            return json({ error: err.message, expansions: [] });
        }
    }

    if (pathname === '/api/instances/bosses')
    {
        if (!assets.ready)
        {
            return json({ error: 'no-client', bosses: [] });
        }

        const instance = ctx.instances.instance(params.get('map'));

        if (!instance)
        {
            return json({ error: 'unknown-map', bosses: [] });
        }

        if (!worldDb.connected)
        {
            // The roster is still worth showing; only the creature behind each name is missing.
            return json({
                instance: { ...instance, encounters: undefined },
                bosses: instance.encounters.map((e) => ({ ...e, entry: 0, difficulties: [] })),
                error: 'not-connected'
            });
        }

        try
        {
            const bosses = await worldDb.bossesForEncounters(instance.encounters, instance.mapId);

            /*
             * Chests ride along with the roster.
             *
             * Four of these encounters have no creature to hang loot on — Tribunal of Ages, the
             * Grand Champions, the Faction Champions and Escape from Arthas are events — so
             * without this they come back as a name with nothing behind it.
             */
            return json({
                instance: { ...instance, encounters: undefined },
                bosses: bosses.map((boss) => ({
                    ...boss,
                    chests: chestsFor(instance.mapId, boss.encounterName, boss.name)
                }))
            });
        }
        catch (err)
        {
            return json({ error: err.code || err.message, bosses: [] });
        }
    }

    /* -------------------------------------------------------------------- portrait camera */

    /*
     * How the game itself would frame this unit's portrait, read out of the model file.
     *
     * The angles are what matter and they are scale-free; the distance is in the M2's own units,
     * so the box is sent alongside for the viewer to work out the scale of the copy it is
     * actually drawing. See lib/portrait-camera.js.
     */
    if (pathname === '/api/portrait-camera')
    {
        if (!assets.ready)
        {
            return json({ reason: 'no client configured' });
        }

        const info = portraitCameras.forDisplayId(params.get('displayId'));

        return json({
            path: info.path || null,
            portraitIcon: info.portraitIcon || null,
            box: info.box || null,
            dbcScale: info.dbcScale || null,
            geometryBox: info.geometryBox || null,
            portrait: info.portrait || null,
            characterInfo: info.characterInfo || null,
            reason: info.reason || null
        });
    }

    /* ------------------------------------------------------------------------- model proxy */

    /*
     * The 3D model viewer pulls its models and textures from a remote host. Feeding those
     * straight into WebGL would taint the canvas and make the portrait un-capturable, so every
     * byte is fetched here and re-served from our own origin. Same-origin in, clean canvas out.
     */
    if (pathname === '/proxy/model')
    {
        const target = params.get('path');

        if (!target)
        {
            return notFound();
        }

        try
        {
            const response = await fetchModelPart(MODEL_CONTENT + encodeURIComponent(target));

            if (!response.ok)
            {
                return { status: response.status, type: 'text/plain', body: `Upstream ${response.status}` };
            }

            const buffer = Buffer.from(await response.arrayBuffer());

            // A helm that hides the wearer's hair leaves the bald scalp, not a hole in the head.
            const body = await modelHelm.rewrite(target, buffer, fetchModelJson);

            return {
                status: 200,
                type: response.headers.get('content-type') || 'application/octet-stream',
                body,
                cache: 'public, max-age=86400'
            };
        }
        catch (err)
        {
            return { status: 502, type: 'text/plain', body: `Proxy failed: ${err.message}` };
        }
    }

    if (pathname === '/proxy/viewer.js')
    {
        try
        {
            const response = await fetch(MODEL_SCRIPT);

            if (!response.ok)
            {
                return { status: response.status, type: 'text/plain', body: `Upstream ${response.status}` };
            }

            return {
                status: 200,
                type: 'text/javascript; charset=utf-8',
                body: Buffer.from(await response.arrayBuffer()),
                cache: 'public, max-age=86400'
            };
        }
        catch (err)
        {
            return { status: 502, type: 'text/plain', body: `Proxy failed: ${err.message}` };
        }
    }

    return null; // not an API path — caller falls through to static files
}

module.exports = { handle };
