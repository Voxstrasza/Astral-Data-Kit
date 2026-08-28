'use strict';

/**
 * Does every stat an item can carry actually move the character sheet?
 *
 * The Armory's promise is that a piece you invented reads out as a real character. That promise
 * breaks quietly: a stat the editor can write but the pipeline does not read costs nothing, throws
 * nothing and shows up as a number that did not change. You would only catch it by knowing what
 * the number should have been, which is the thing the Armory exists to tell you.
 *
 * So this puts one stat on one item at a time and asks the sheet what moved. It is differential
 * rather than declarative: it compares a geared sheet against a naked one and reports the fields
 * that differ, so a stat cannot pass by being spelled the same as something else. A stat that
 * moves nothing fails, unless it is on the small list below of stats that deliberately do nothing.
 *
 * A red run is the honest state until the gaps recorded in Phase 3 of TODO.md are closed - the
 * four stat types in RATING_CUSTOM reach the editor as free text, so `budgetStats` cannot see
 * them, and they will fail here until they are promoted to presets.
 *
 * Usage: node tools/stat-coverage.js ["C:\path\to\client"]
 *
 * The client is needed because the sheet's conversions are the client's own gt* tables. It is the
 * folder Astral is pointed at in Settings unless one is passed.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ClientAssets } = require('../lib/client-assets');
const { Character } = require('../lib/character');
const M = require('../lib/items');

/*
 * A paladin, because one character has to exercise every branch: it has a mana bar, it parries and
 * it blocks, and it is read for the melee, the spell and the defense groups at once. A warrior
 * would report block value and mana regen as unreachable when they are only inapplicable.
 */
const RACE = 1;
const CLASS = 2;
const LEVEL = 80;

/* Big enough that a rating still moves its number after the core's truncations. */
const VALUE = 100;

/*
 * Stats that are supposed to move nothing, and why.
 *
 * The scope rule decides this list: if Wrath's character sheet does not show it, the Armory does
 * not compute it. Anything not named here has to move something.
 */
const SILENT = {
    46: 'health per 5 sec - the paper doll does not show health regen',
    41: 'the pre-3.0 healing half - priced, but 3.3.5a has no healing line to move',
    47: 'spell penetration - priced, and off the sheet until the paper doll is checked'
};

/** The client folder Astral itself is pointed at, so this and the app read the same files. */
function configuredClient()
{
    const settings = path.join(
        process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
        'astral-data-kit', 'settings.json');

    try
    {
        return JSON.parse(fs.readFileSync(settings, 'utf8')).clientPath || '';
    }
    catch
    {
        return '';
    }
}

/**
 * A sheet as a flat map of name to number, which is what can be compared.
 *
 * The five primaries and the five schools live one level down, and the rating table is a constant
 * for a class and level rather than anything gear moves, so it is left out.
 */
function flatten(sheet)
{
    const out = {};

    for (const [key, value] of Object.entries(sheet))
    {
        if (key === 'ratings')
        {
            continue;
        }

        if (typeof value === 'number')
        {
            out[key] = value;
        }
        else if (key === 'stats' || key === 'resistances')
        {
            for (const [inner, num] of Object.entries(value))
            {
                out[inner] = num;
            }
        }
    }

    return out;
}

/** Which sheet fields this piece of gear moved, naked as the baseline. */
function moved(naked, geared)
{
    const flat = flatten(geared);
    const changed = [];

    for (const [key, value] of Object.entries(flat))
    {
        if (Math.abs(value - (naked[key] || 0)) > 1e-9)
        {
            changed.push(key);
        }
    }

    return changed;
}

/**
 * Every stat the editor can put on an item, as the editor itself holds it.
 *
 * Three shapes, and the difference between the second and the third is the whole point of this
 * tool: a preset line carries its number in a field the program can read, while a custom line has
 * the number baked into a sentence and is prose as far as `budgetStats` is concerned.
 */
function everyStat()
{
    const cases = [];

    for (const [type, label] of Object.entries(M.PRIMARY_STATS))
    {
        cases.push({
            type: Number(type),
            label,
            item: { stats: [{ type: label, value: VALUE }], effects: [] }
        });
    }

    for (const [type, line] of Object.entries(M.RATING_LINES))
    {
        cases.push({
            type: Number(type),
            label: line.replace('{N}', String(VALUE)),
            item: { stats: [], effects: [{ kind: 'Equip', preset: line, value: VALUE, text: '' }] }
        });
    }

    for (const [type, line] of Object.entries(M.RATING_CUSTOM))
    {
        cases.push({
            type: Number(type),
            label: line.replace(/\{N\}/g, String(VALUE)),
            item: {
                stats: [],
                effects: [{
                    kind: 'Equip',
                    preset: 'custom',
                    value: VALUE,
                    text: line.replace(/\{N\}/g, String(VALUE))
                }]
            }
        });
    }

    return cases.sort((a, b) => a.type - b.type);
}

/**
 * The item fields that are not stat rows at all.
 *
 * Armor, the resistance list and a shield's block value sit beside the stats rather than among
 * them, so they never pass through `budgetStats` and it is `equipped()` that has to pick them up.
 * They go in as real editor items for that reason: the point is to test the path the Armory will
 * use, not to hand the sheet a gear object nothing would build.
 */
const FIELDS = [
    { label: 'armor', item: { armor: VALUE } },
    { label: 'shield block value', item: { block: VALUE } },
    {
        label: 'resistances',
        item: {
            resistances: [
                { type: 'Arcane', value: VALUE }, { type: 'Fire', value: VALUE },
                { type: 'Frost', value: VALUE }, { type: 'Nature', value: VALUE },
                { type: 'Shadow', value: VALUE }
            ]
        }
    },
    { label: 'holy resistance', item: { resistances: [{ type: 'Holy', value: VALUE }] }, silent: 'players have no holy resistance and the sheet has no line for it' }
];

const PENDING = [
    'weapon damage (dmgMin, dmgMax) - no sheet line and no pipeline yet',
    'weapon speed - the same, and the two together are what a DPS number would be built from'
];

/**
 * The sentences the editor actually offers, read out of the browser's own copy.
 *
 * `EQUIP_PRESETS` in public/tooltip.js is what a user picks from; `RATING_LINES` in lib/items.js
 * is what `budgetStats` can price. They are two lists with nothing joining them, so a sentence
 * added to one and not the other is a stat you can choose and the sheet will never see. That is
 * the same failure this tool is for, one step earlier, and it costs no client to check.
 */
function editorPresets()
{
    const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'tooltip.js'), 'utf8');
    const found = src.match(/const EQUIP_PRESETS = \[([\s\S]*?)\n\];/);

    if (!found)
    {
        return null;
    }

    /* The closing bracket goes on its own line: the list ends with a `//` comment, which would
       otherwise swallow it. */
    return require('vm').runInNewContext(`[${found[1]}\n]`);
}

function main()
{
    const clientPath = process.argv[2] || configuredClient();

    if (!clientPath)
    {
        console.error('No client folder. Pass one, or point Astral at one in Settings first.');
        process.exit(1);
    }

    const assets = new ClientAssets(path.join(os.tmpdir(), 'astral-stat-coverage'));
    const opened = assets.open(clientPath);

    if (!opened.ok)
    {
        console.error(opened.reason);
        process.exit(1);
    }

    const character = new Character(assets);
    const naked = flatten(character.sheet(RACE, CLASS, LEVEL));

    console.log(`Every stat an item can carry, on a human paladin at 80, ${VALUE} of each`);
    console.log('');
    console.log(['', 'type'.padEnd(6), 'budget'.padEnd(13), 'moves'].join(''));

    let failures = 0;

    for (const one of everyStat())
    {
        const gear = M.equipped([one.item]);
        const names = Object.keys(gear.stats);
        const changed = moved(naked, character.sheet(RACE, CLASS, LEVEL, gear));
        const silent = SILENT[one.type];
        const ok = changed.length > 0 || silent !== undefined;

        if (!ok)
        {
            failures++;
        }

        console.log([
            ok ? '  ' : '! ',
            String(one.type).padEnd(6),
            (names.join(',') || '-').padEnd(13),
            changed.length ? changed.join(', ') : (silent || 'NOTHING')
        ].join(''));

        if (!ok)
        {
            console.log(`        ${one.label}`);
        }
    }

    console.log('');
    console.log('Item fields that are not stat rows');
    console.log('');

    for (const field of FIELDS)
    {
        const gear = M.equipped([field.item]);
        const changed = moved(naked, character.sheet(RACE, CLASS, LEVEL, gear));
        const ok = changed.length > 0 || field.silent !== undefined;

        if (!ok)
        {
            failures++;
        }

        console.log([
            ok ? '  ' : '! ',
            field.label.padEnd(21),
            changed.length ? changed.join(', ') : (field.silent || 'NOTHING')
        ].join(''));
    }

    console.log('');
    console.log('The editor\'s own preset list against the one budgetStats can price');
    console.log('');

    const presets = editorPresets();

    if (!presets)
    {
        console.log('! could not read EQUIP_PRESETS out of public/tooltip.js');
        failures++;
    }
    else
    {
        const priced = new Set(Object.values(M.RATING_LINES));
        const orphans = presets.filter((line) => !priced.has(line));

        failures += orphans.length;

        console.log(`  ${presets.length} offered, ${priced.size} priced`);

        for (const line of orphans)
        {
            console.log(`! offered and unpriced: ${line}`);
        }
    }

    console.log('');
    console.log('Not wired to anything yet, and tracked in Phase 3 rather than tested here:');

    for (const note of PENDING)
    {
        console.log(`    ${note}`);
    }

    console.log('');

    if (failures)
    {
        console.log(`${failures} stat${failures === 1 ? '' : 's'} the editor can write and the sheet cannot read.`);
        console.log('Each one is a stat you could put on an item and never see, which is the failure');
        console.log('this exists to catch. See "Every stat the sheet is read for" in TODO.md.');
    }
    else
    {
        console.log('Every stat the editor can write moves a number, or is on the silent list.');
    }

    assets.close();
    process.exit(failures ? 1 : 0);
}

main();
