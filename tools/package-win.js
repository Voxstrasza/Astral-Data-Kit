'use strict';

/**
 * Packages the Windows build: dist/Astral-win32-x64/Astral.exe plus its runtime.
 *
 * This deliberately does not go through electron-builder. On a machine without Developer Mode
 * or admin rights, electron-builder cannot unpack its winCodeSign toolchain (that archive holds
 * macOS symlinks, and creating symlinks is a privileged operation on Windows), so its NSIS and
 * portable targets fail before they start. Everything those targets do that actually matters
 * here — lay out the Electron runtime, drop the app in, stamp the icon and version onto the exe —
 * is done directly below.
 *
 * If Developer Mode is ever switched on, `npm run dist` will work and produce a real installer;
 * this script stays valid either way.
 *
 * Usage: node tools/package-win.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ELECTRON_DIST = path.join(ROOT, 'node_modules', 'electron', 'dist');
const RCEDIT = path.join(ROOT, 'node_modules', 'rcedit', 'bin', 'rcedit-x64.exe');
const OUT = path.join(ROOT, 'dist', 'Astral-win32-x64');

const pkg = require(path.join(ROOT, 'package.json'));

const PRODUCT = 'Astral';
const DESCRIPTION = 'Astral - 3.3.5a Data Kit';
const EXE = `${PRODUCT}.exe`;

/** Files and folders that make up the app itself, copied into resources/app. */
const APP_CONTENTS = ['electron', 'lib', 'public', 'package.json'];

/**
 * Production dependencies only, resolved by npm rather than guessed.
 *
 * node_modules here is ~350 MB, nearly all of it Electron and the build tooling; shipping it
 * wholesale would double the output. Asking npm for the --omit=dev tree gives the handful of
 * packages the app actually requires at runtime (mysql2 and its dependencies).
 */
function productionDependencies()
{
    const output = execFileSync('npm', ['ls', '--omit=dev', '--parseable', '--all'], {
        cwd: ROOT,
        encoding: 'utf8',
        shell: true
    });

    return output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && line !== ROOT && line.includes('node_modules'));
}

/*
 * Never packaged, whatever it contains.
 *
 * public/fonts is where "npm run extract-fonts" drops the client's own FRIZQT__.TTF and
 * ARIALN.TTF for local inspection. Those are Blizzard's and the program reads them from the
 * user's install at runtime rather than shipping them, so a stray extraction must not end up
 * inside the exe just because it happened to be sitting in public/.
 */
const NEVER_COPY = new Set(['fonts']);

function copyDir(from, to)
{
    fs.mkdirSync(to, { recursive: true });

    for (const entry of fs.readdirSync(from, { withFileTypes: true }))
    {
        const src = path.join(from, entry.name);
        const dest = path.join(to, entry.name);

        if (entry.isDirectory())
        {
            if (NEVER_COPY.has(entry.name)) { continue; }

            copyDir(src, dest);
        }
        else if (entry.isSymbolicLink())
        {
            // Nothing in the Electron runtime needs symlinks on Windows; copy the target instead.
            fs.copyFileSync(fs.realpathSync(src), dest);
        }
        else
        {
            fs.copyFileSync(src, dest);
        }
    }
}

function directorySize(dir)
{
    let total = 0;

    for (const entry of fs.readdirSync(dir, { withFileTypes: true }))
    {
        const full = path.join(dir, entry.name);
        total += entry.isDirectory() ? directorySize(full) : fs.statSync(full).size;
    }

    return total;
}

function main()
{
    if (!fs.existsSync(path.join(ELECTRON_DIST, 'electron.exe')))
    {
        console.error('Electron runtime missing. Run: npm install');
        process.exit(1);
    }

    console.log('cleaning output');
    fs.rmSync(OUT, { recursive: true, force: true });

    console.log('copying Electron runtime');
    copyDir(ELECTRON_DIST, OUT);

    // The stub app Electron ships with would otherwise launch instead of ours.
    const defaultApp = path.join(OUT, 'resources', 'default_app.asar');

    if (fs.existsSync(defaultApp))
    {
        fs.rmSync(defaultApp);
    }

    console.log('installing app into resources/app');
    const appDir = path.join(OUT, 'resources', 'app');
    fs.mkdirSync(appDir, { recursive: true });

    for (const entry of APP_CONTENTS)
    {
        const src = path.join(ROOT, entry);
        const dest = path.join(appDir, entry);

        if (!fs.existsSync(src))
        {
            console.error(`missing ${entry}`);
            process.exit(1);
        }

        if (fs.statSync(src).isDirectory())
        {
            copyDir(src, dest);
        }
        else
        {
            fs.copyFileSync(src, dest);
        }
    }

    console.log('copying production dependencies');

    for (const dep of productionDependencies())
    {
        // Preserve the path under node_modules so nested copies (mysql2's own iconv-lite) land
        // where Node's resolver expects them.
        const relative = path.relative(ROOT, dep);
        copyDir(dep, path.join(appDir, relative));
    }

    console.log(`renaming electron.exe -> ${EXE}`);
    fs.renameSync(path.join(OUT, 'electron.exe'), path.join(OUT, EXE));

    console.log('stamping icon and version info');
    execFileSync(RCEDIT, [
        path.join(OUT, EXE),
        '--set-icon', path.join(ROOT, 'build', 'icon.ico'),
        '--set-version-string', 'ProductName', PRODUCT,
        '--set-version-string', 'FileDescription', DESCRIPTION,
        '--set-version-string', 'CompanyName', 'Vox-WotLK',
        '--set-version-string', 'LegalCopyright', 'Fan-made tool. World of Warcraft assets are property of Blizzard Entertainment.',
        '--set-version-string', 'OriginalFilename', EXE,
        '--set-version-string', 'InternalName', PRODUCT,
        '--set-file-version', pkg.version,
        '--set-product-version', pkg.version
    ], { stdio: 'inherit' });

    createLauncherShortcut();

    const mb = (directorySize(OUT) / 1024 / 1024).toFixed(0);
    console.log(`\ndone: ${path.join(OUT, EXE)}`);
    console.log(`total ${mb} MB`);
}

/**
 * Drops an Astral.lnk in the project root pointing at the built exe.
 *
 * The exe cannot simply be copied somewhere convenient — Electron needs its DLLs and resources
 * sitting beside it — so a shortcut is the way to keep one obvious entry point at the top level.
 */
function createLauncherShortcut()
{
    const target = path.join(OUT, EXE);
    const link = path.join(ROOT, `${PRODUCT}.lnk`);

    const script = [
        '$ws = New-Object -ComObject WScript.Shell',
        `$sc = $ws.CreateShortcut('${link}')`,
        `$sc.TargetPath = '${target}'`,
        `$sc.WorkingDirectory = '${OUT}'`,
        `$sc.IconLocation = '${target},0'`,
        `$sc.Description = '${DESCRIPTION}'`,
        '$sc.Save()'
    ].join('; ');

    try
    {
        execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore' });
        console.log(`launcher: ${link}`);
    }
    catch (err)
    {
        console.warn(`could not create launcher shortcut: ${err.message}`);
    }
}

main();
