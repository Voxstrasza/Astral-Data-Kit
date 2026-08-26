'use strict';

/**
 * Prints what the Armory believes about a character, so it can be put beside the real one.
 *
 * The whole point of the Armory is that its numbers are checkable: you have the client and a
 * server, so a character standing in Dalaran is the reference. This prints the same quantities the
 * character sheet shows, in the same units, for comparing column by column.
 *
 * Phase 1 covers base stats and the conversions. Health, mana, attack power and the defensive
 * percentages arrive with the pipeline in phase 2 and will print here too.
 *
 * Usage: node tools/character-probe.js [race] [class] [level] ["C:\path\to\client"]
 *        node tools/character-probe.js 1 1 80
 *
 * With no arguments it prints the conversion tables for every class at 80, which is the form to
 * check against a gear planner rather than against one character.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ClientAssets } = require('../lib/client-assets');
const { Character, RATING } = require('../lib/character');

const RACES = {
    1: 'Human', 2: 'Orc', 3: 'Dwarf', 4: 'Night Elf', 5: 'Undead',
    6: 'Tauren', 7: 'Gnome', 8: 'Troll', 10: 'Blood Elf', 11: 'Draenei'
};

const CLASSES = {
    1: 'Warrior', 2: 'Paladin', 3: 'Hunter', 4: 'Rogue', 5: 'Priest',
    6: 'Death Knight', 7: 'Shaman', 8: 'Mage', 9: 'Warlock', 11: 'Druid'
};

/** The client folder Astral itself is pointed at, so the probe and the app read the same files. */
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

function main()
{
    const [race, cls, level] = process.argv.slice(2, 5).map(Number);
    const clientPath = process.argv[5] || configuredClient();

    if (!clientPath)
    {
        console.error('No client folder. Pass one, or point Astral at one in Settings first.');
        process.exit(1);
    }

    const assets = new ClientAssets(path.join(os.tmpdir(), 'astral-character-probe'));
    const opened = assets.open(clientPath);

    if (!opened.ok)
    {
        console.error(opened.reason);
        process.exit(1);
    }

    const character = new Character(assets);

    if (!race || !cls || !level)
    {
        everyClassAt80(character);
    }
    else
    {
        oneCharacter(character, race, cls, level);
    }

    assets.close();
}

/** The conversions, which do not depend on a character beyond its class and level. */
function everyClassAt80(character)
{
    console.log('Rating points for one percent, at level 80');
    console.log('');

    const shown = ['defense', 'dodge', 'parry', 'block', 'meleeHit', 'spellHit',
        'meleeCrit', 'spellCrit', 'meleeHaste', 'spellHaste', 'expertise', 'armorPen', 'resilience'];

    console.log(['class'.padEnd(13), ...shown.map((s) => s.padStart(11))].join(''));

    for (const [id, name] of Object.entries(CLASSES))
    {
        const table = character.ratingTable(Number(id), 80);
        const cells = shown.map((s) => (table[s] ? table[s].toFixed(2) : '-').padStart(11));

        console.log([name.padEnd(13), ...cells].join(''));
    }

    console.log('');
    console.log('Stats for one percent of crit, at level 80');
    console.log('');
    console.log(['class'.padEnd(13), 'agi/melee'.padStart(12), 'base melee'.padStart(12),
        'int/spell'.padStart(12), 'base spell'.padStart(12)].join(''));

    for (const [id, name] of Object.entries(CLASSES))
    {
        const perAgi = character.meleeCritFromAgility(Number(id), 80, 1)
            - character.meleeCritFromAgility(Number(id), 80, 0);
        const perInt = character.spellCritFromIntellect(Number(id), 80, 1)
            - character.spellCritFromIntellect(Number(id), 80, 0);

        console.log([
            name.padEnd(13),
            (perAgi ? (1 / perAgi).toFixed(2) : '-').padStart(12),
            `${character.meleeCritFromAgility(Number(id), 80, 0).toFixed(3)}%`.padStart(12),
            (perInt ? (1 / perInt).toFixed(2) : '-').padStart(12),
            `${character.spellCritFromIntellect(Number(id), 80, 0).toFixed(3)}%`.padStart(12)
        ].join(''));
    }
}

/** One character, naked, as the sheet would show it. */
function oneCharacter(character, race, cls, level)
{
    const base = character.base(race, cls, level);

    if (!base)
    {
        console.error(`No such character: ${RACES[race] || race} ${CLASSES[cls] || cls} at level ${level}.`);
        process.exit(1);
    }

    console.log(`${RACES[race] || race} ${CLASSES[cls] || cls}, level ${level}, nothing equipped`);
    console.log('');
    console.log(`  strength   ${base.str}`);
    console.log(`  agility    ${base.agi}`);
    console.log(`  stamina    ${base.sta}`);
    console.log(`  intellect  ${base.int}`);
    console.log(`  spirit     ${base.spi}`);
    console.log('');
    console.log(`  base health ${base.baseHealth}   base mana ${base.baseMana}`);
    console.log('   (base health excludes what stamina adds; that arrives with phase 2)');
    console.log('');
    console.log(`  melee crit from agility   ${character.meleeCritFromAgility(cls, level, base.agi).toFixed(2)}%`);
    console.log(`  spell crit from intellect ${character.spellCritFromIntellect(cls, level, base.int).toFixed(2)}%`);
    console.log(`  mana regen from spirit    ${character.manaRegenPer5(cls, level, base.spi, base.int).toFixed(1)} per 5s`);
    console.log('');

    const table = character.ratingTable(cls, level);

    console.log('  rating points for one percent');

    for (const name of Object.keys(RATING))
    {
        console.log(`    ${name.padEnd(12)} ${table[name] ? table[name].toFixed(2) : '-'}`);
    }
}

main();
