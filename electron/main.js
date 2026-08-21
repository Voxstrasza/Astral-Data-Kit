'use strict';

/*
 * Desktop shell.
 *
 * The page is served over a registered `app://` scheme rather than `file://` or a localhost
 * server. That matters for three reasons: `file://`-loaded images taint the canvas, which would
 * break PNG export outright; a listening socket would trip the Windows Defender Firewall prompt
 * on first launch; and having our own scheme lets the same handler serve the data API, including
 * the model proxy that keeps remote 3D assets same-origin so portraits stay capturable.
 */

const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const url = require('url');

const { ClientAssets } = require('../lib/client-assets');
const { Settings } = require('../lib/settings');
const { WorldDb } = require('../lib/world-db');
const { Instances } = require('../lib/instances');
const { CustomIcons } = require('../lib/custom-icons');
const { Spells } = require('../lib/spells');
const { Achievements } = require('../lib/achievements');
const { ItemDisplay } = require('../lib/items');
const { ItemBudget } = require('../lib/item-budget');
const routes = require('../lib/routes');

const PUBLIC = path.join(__dirname, '..', 'public');

let settings = null;
let assets = null;
let worldDb = null;
let instances = null;
let customIcons = null;
let spells = null;
let achievements = null;
let itemDisplay = null;
let itemBudget = null;

protocol.registerSchemesAsPrivileged([
    {
        scheme: 'app',
        privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
]);

function readWindowState(file)
{
    try
    {
        const saved = JSON.parse(fs.readFileSync(file, 'utf8'));

        if (Number.isFinite(saved.width) && Number.isFinite(saved.height))
        {
            return saved;
        }
    }
    catch
    {
        // First run, or the file was removed — fall through to the defaults.
    }

    return { width: 1440, height: 960 };
}

function saveWindowState(file, win)
{
    try
    {
        const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
        fs.writeFileSync(file, JSON.stringify({ ...bounds, maximized: win.isMaximized() }));
    }
    catch
    {
        // Remembering the window size is a convenience, never worth failing a quit over.
    }
}

function createWindow()
{
    const stateFile = path.join(app.getPath('userData'), 'window-state.json');
    const saved = readWindowState(stateFile);

    const win = new BrowserWindow({
        width: saved.width,
        height: saved.height,
        x: saved.x,
        y: saved.y,
        minWidth: 940,
        minHeight: 640,
        backgroundColor: '#0d0f16',
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            // The model viewer runs third-party script; keep it sandboxed with no Node access.
            sandbox: true,
            preload: path.join(__dirname, 'preload.js')
        }
    });

    if (saved.maximized)
    {
        win.maximize();
    }

    win.once('ready-to-show', () => win.show());
    win.on('close', () => saveWindowState(stateFile, win));

    win.webContents.setWindowOpenHandler(({ url: target }) =>
    {
        shell.openExternal(target);
        return { action: 'deny' };
    });

    // "Download PNG" should ask where to put the file rather than silently dropping it
    // into the downloads folder.
    win.webContents.session.on('will-download', (_event, item) =>
    {
        item.setSaveDialogOptions({
            defaultPath: item.getFilename(),
            filters: [{ name: 'PNG Image', extensions: ['png'] }]
        });
    });

    win.loadURL('app://forge/index.html');

    return win;
}

function buildMenu()
{
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        { label: 'File', submenu: [{ role: 'quit' }] },
        {
            label: 'View',
            submenu: [
                { role: 'reload' },
                { role: 'toggleDevTools' },
                { type: 'separator' },
                { role: 'resetZoom' },
                { role: 'zoomIn' },
                { role: 'zoomOut' },
                { type: 'separator' },
                { role: 'togglefullscreen' }
            ]
        }
    ]));
}

function reopenClient()
{
    // A different client means a different set of DBCs behind the instance tree.
    if (instances) { instances.reset(); }
    if (spells) { spells.reset(); }
    if (achievements) { achievements.reset(); }
    if (itemDisplay) { itemDisplay.reset(); }
    if (itemBudget) { itemBudget.reset(); }

    return assets.open(settings.data.clientPath);
}

function serveStatic(pathname)
{
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(PUBLIC, rel);

    if (file !== PUBLIC && !file.startsWith(PUBLIC + path.sep))
    {
        return new Response('Forbidden', { status: 403 });
    }

    return net.fetch(url.pathToFileURL(file).toString());
}

app.whenReady().then(() =>
{
    const userData = app.getPath('userData');

    settings = new Settings(path.join(userData, 'settings.json'));
    assets = new ClientAssets(path.join(userData, 'cache'));
    worldDb = new WorldDb();
    instances = new Instances(assets);
    customIcons = new CustomIcons(path.join(userData, 'custom'));
    spells = new Spells(assets);
    achievements = new Achievements(assets);
    itemDisplay = new ItemDisplay(assets);
    itemBudget = new ItemBudget(assets);

    if (settings.data.clientPath)
    {
        reopenClient();
    }

    if (settings.data.db.enabled)
    {
        worldDb.connect(settings.data.db).catch(() => {});
    }

    protocol.handle('app', async (request) =>
    {
        const parsed = new URL(request.url);
        const body = request.method === 'POST' ? await request.text() : null;

        const result = await routes.handle(
            {
            assets, settings, worldDb, instances, customIcons, spells, achievements,
            itemDisplay, itemBudget, reopenClient
        },
            parsed.pathname,
            parsed.searchParams,
            body
        );

        if (result)
        {
            return new Response(result.body, {
                status: result.status,
                headers: {
                    'Content-Type': result.type,
                    'Cache-Control': result.cache || 'no-cache'
                }
            });
        }

        return serveStatic(parsed.pathname);
    });

    ipcMain.handle('choose-client-folder', async () =>
    {
        const result = await dialog.showOpenDialog({
            title: 'Select your World of Warcraft 3.3.5a folder',
            properties: ['openDirectory'],
            defaultPath: settings.data.clientPath || undefined
        });

        if (result.canceled || !result.filePaths.length)
        {
            return { canceled: true };
        }

        const chosen = result.filePaths[0];
        const check = ClientAssets.validate(chosen);

        if (!check.ok)
        {
            return { canceled: false, ok: false, path: chosen, reason: check.reason };
        }

        settings.save({ clientPath: chosen });
        const opened = reopenClient();

        return { canceled: false, ok: opened.ok, path: chosen, reason: opened.reason, icons: opened.icons };
    });

    buildMenu();
    createWindow();

    app.on('activate', () =>
    {
        if (BrowserWindow.getAllWindows().length === 0)
        {
            createWindow();
        }
    });
});

app.on('window-all-closed', () =>
{
    if (process.platform !== 'darwin')
    {
        app.quit();
    }
});
