'use strict';

/**
 * Pulls the socket and money textures out of the 3.3.5a client MPQs and writes them as PNGs
 * into public/ui, so tooltips can use the real gem-slot and coin art instead of drawn shapes.
 *
 * Uses this repository's own MPQ and BLP readers in lib/wow.
 *
 * Usage: node tools/extract-ui-art.js ["C:\World of Warcraft"]
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'ui');

const MPQArchive = require('../lib/wow/MPQArchive');
const blp = require('../lib/wow/blp');
const png = require('../lib/wow/png');

// Later archives patch earlier ones, same load order the client uses.
const ARCHIVES = [
    'common.MPQ', 'common-2.MPQ', 'expansion.MPQ', 'lichking.MPQ',
    'enUS/locale-enUS.MPQ', 'enUS/expansion-locale-enUS.MPQ', 'enUS/lichking-locale-enUS.MPQ',
    'patch.MPQ', 'patch-2.MPQ', 'patch-3.MPQ',
    'enUS/patch-enUS.MPQ', 'enUS/patch-enUS-2.MPQ', 'enUS/patch-enUS-3.MPQ'
];

/** Output name -> the texture to look for, matched case-insensitively on the full archive path. */
const WANTED = {
    'socket-red': /ITEMSOCKETINGFRAME\\UI-EMPTYSOCKET-RED\.BLP$/,
    'socket-yellow': /ITEMSOCKETINGFRAME\\UI-EMPTYSOCKET-YELLOW\.BLP$/,
    'socket-blue': /ITEMSOCKETINGFRAME\\UI-EMPTYSOCKET-BLUE\.BLP$/,
    'socket-meta': /ITEMSOCKETINGFRAME\\UI-EMPTYSOCKET-META\.BLP$/,
    // 3.3.5a ships no dedicated prismatic art — the client falls back to the generic empty
    // socket for them, so that is what we extract and reuse for prismatic.
    'socket-generic': /ITEMSOCKETINGFRAME\\UI-EMPTYSOCKET\.BLP$/,
    'coin-gold': /MONEYFRAME\\UI-GOLDICON\.BLP$/,
    'coin-silver': /MONEYFRAME\\UI-SILVERICON\.BLP$/,
    'coin-copper': /MONEYFRAME\\UI-COPPERICON\.BLP$/,

    // Target frame: one border texture per classification, plus the bar fill and level plate.
    'unit-frame': /TARGETINGFRAME\\UI-TARGETINGFRAME\.BLP$/,
    'unit-frame-nomana': /TARGETINGFRAME\\UI-TARGETINGFRAME-NOMANA\.BLP$/,
    'unit-frame-elite': /TARGETINGFRAME\\UI-TARGETINGFRAME-ELITE\.BLP$/,
    'unit-frame-rare': /TARGETINGFRAME\\UI-TARGETINGFRAME-RARE\.BLP$/,
    'unit-frame-rare-elite': /TARGETINGFRAME\\UI-TARGETINGFRAME-RARE-ELITE\.BLP$/,
    'unit-frame-boss': /TARGETINGFRAME\\UI-UNITFRAME-BOSS\.BLP$/,
    'unit-bar-fill': /TARGETINGFRAME\\UI-TARGETINGFRAME-BARFILL\.BLP$/,
    'unit-level-bg': /TARGETINGFRAME\\UI-TARGETINGFRAME-LEVELBACKGROUND\.BLP$/,
    'unit-skull': /TARGETINGFRAME\\UI-TARGETINGFRAME-SKULL\.BLP$/,
    'unit-statusbar': /TARGETINGFRAME\\UI-STATUSBAR\.BLP$/,

    /*
     * Achievement frame. The card is drawn from these; the geometry that places them comes from
     * the client's own Blizzard_AchievementUI.xml rather than from measuring the textures, since
     * unlike the target frame the achievement UI ships its FrameXML in the archives.
     *
     * PARCHMENT-HORIZONTAL is the card background — the plain PARCHMENT is the vertical one the
     * summary page uses, which is not the same texture at a different rotation.
     */
    'ach-parchment': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-PARCHMENT-HORIZONTAL\.BLP$/,
    'ach-parchment-desaturated': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-PARCHMENT-HORIZONTAL-DESATURATED\.BLP$/,
    'ach-title': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-TITLE\.BLP$/,
    'ach-iconframe': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-ICONFRAME\.BLP$/,
    // One sheet, two shields: the left half is earned and the right half is not.
    'ach-shields': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-SHIELDS\.BLP$/,
    'ach-shields-nopoints': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-SHIELDS-NOPOINTS\.BLP$/,
    'ach-reward-bg': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-REWARD-BACKGROUND\.BLP$/,
    'ach-criteria-check': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-CRITERIA-CHECK\.BLP$/,
    'ach-progressbar-border': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-PROGRESSBAR-BORDER\.BLP$/,
    // The faint glow along the card's edges, drawn at low alpha over the parchment.
    'ach-tsunami-corners': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-TSUNAMI-CORNERS\.BLP$/,
    'ach-tsunami-horizontal': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-TSUNAMI-HORIZONTAL\.BLP$/,

    // For the category tree and panel the multi-achievement layout will need.
    'ach-category-bg': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-CATEGORY-BACKGROUND\.BLP$/,
    'ach-category-highlight': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-CATEGORY-HIGHLIGHT\.BLP$/,
    'ach-wood-border': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-WOODBORDER\.BLP$/,
    'ach-wood-border-corner': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-WOODBORDER-CORNER\.BLP$/,
    'ach-background': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-ACHIEVEMENTBACKGROUND\.BLP$/,
    'ach-watermark': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-ACHIEVEMENTWATERMARK\.BLP$/,
    'ach-plusminus': /ACHIEVEMENTFRAME\\UI-ACHIEVEMENT-PLUSMINUS\.BLP$/
};

/*
 * The client path comes from the app's own settings file — the one Settings writes when you point
 * at your 3.3.5a folder — so this needs no configuration of its own. Pass a path as the first
 * argument to override it.
 */
function clientPath()
{
    const fromArgument = process.argv[2];

    if (fromArgument)
    {
        return fromArgument;
    }

    const settingsFile = path.join(require('os').homedir(), '.astral-data-kit', 'settings.json');

    try
    {
        const saved = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));

        if (saved.clientPath)
        {
            return saved.clientPath;
        }
    }
    catch
    {
        // Falls through to the message below.
    }

    console.error('No client configured. Open Settings in Astral and point at your 3.3.5a folder,');
    console.error('or pass the folder as an argument:  node tools/%s "C:\\World of Warcraft"',
        path.basename(__filename));
    process.exit(1);
}

function main()
{
    const dataDir = path.join(clientPath(), 'Data');

    if (!fs.existsSync(dataDir))
    {
        console.error(`Client data folder not found: ${dataDir}`);
        process.exit(1);
    }

    const found = new Map();
    const opened = [];

    for (const relative of ARCHIVES)
    {
        const archivePath = path.join(dataDir, relative);

        if (!fs.existsSync(archivePath))
        {
            continue;
        }

        let archive;

        try
        {
            archive = new MPQArchive(archivePath);
        }
        catch (err)
        {
            console.warn(`skip ${relative}: ${err.message}`);
            continue;
        }

        opened.push(archive);

        for (const entry of archive.listFiles())
        {
            const upper = entry.toUpperCase();

            for (const [name, pattern] of Object.entries(WANTED))
            {
                if (pattern.test(upper))
                {
                    found.set(name, { archive, entry });
                }
            }
        }
    }

    fs.mkdirSync(OUT, { recursive: true });

    let written = 0;

    for (const name of Object.keys(WANTED))
    {
        const source = found.get(name);

        if (!source)
        {
            console.warn(`MISSING  ${name}`);
            continue;
        }

        try
        {
            const image = blp.decode(source.archive.readFile(source.entry));
            fs.writeFileSync(path.join(OUT, `${name}.png`), png.encode(image.width, image.height, image.rgba));
            console.log(`${name.padEnd(18)} ${image.width}x${image.height}  <- ${source.entry}`);
            ++written;
        }
        catch (err)
        {
            console.warn(`FAILED   ${name}: ${err.message}`);
        }
    }

    for (const archive of opened)
    {
        archive.close();
    }

    console.log(`\n${written}/${Object.keys(WANTED).length} textures written to public/ui`);
}

main();
