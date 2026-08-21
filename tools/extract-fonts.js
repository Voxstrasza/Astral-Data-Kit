'use strict';

/**
 * Pulls the game fonts out of the 3.3.5a client MPQs into public/fonts.
 *
 * Why this matters beyond the target frame: WoW draws its tooltips in Friz Quadrata
 * (GameTooltipText -> GameFontNormal -> FRIZQT__.TTF), not Arial, so using the real font fixes
 * every tooltip, not just unit frames. Unit-frame numbers — level, health — use Arial Narrow
 * (NumberFontNormal -> ARIALN.TTF), which is why both are extracted.
 *
 * These fonts are licensed to Blizzard, not to us: they come from the user's own client and must
 * not be redistributed. See the note in README.md.
 *
 * Usage: node tools/extract-fonts.js ["C:\World of Warcraft"]
 */

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'public', 'fonts');

const MPQArchive = require('../lib/wow/MPQArchive');

// Interface assets live in the locale archives, not the common ones.
const ARCHIVES = [
    'enUS/locale-enUS.MPQ',
    'enUS/expansion-locale-enUS.MPQ',
    'enUS/lichking-locale-enUS.MPQ',
    'enUS/patch-enUS.MPQ',
    'enUS/patch-enUS-2.MPQ',
    'enUS/patch-enUS-3.MPQ'
];

/** Output name -> the font to look for. */
const WANTED = {
    // Tooltips, unit-frame names, most UI text.
    'FRIZQT__.TTF': /FONTS\\FRIZQT__\.TTF$/,
    // Numbers: unit-frame level and health readouts.
    'ARIALN.TTF': /FONTS\\ARIALN\.TTF$/,
    // Quest titles and other display headings, kept for future use.
    'MORPHEUS.TTF': /FONTS\\MORPHEUS\.TTF$/,
    // Floating combat text.
    'SKURRI.TTF': /FONTS\\SKURRI\.TTF$/
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
            const data = source.archive.readFile(source.entry);

            if (!data || data.length < 1000)
            {
                throw new Error('unreadable or truncated');
            }

            fs.writeFileSync(path.join(OUT, name), data);
            console.log(`${name.padEnd(16)} ${(data.length / 1024).toFixed(0).padStart(4)} KB  <- ${source.entry}`);
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

    console.log(`\n${written}/${Object.keys(WANTED).length} fonts written to public/fonts`);
}

main();
