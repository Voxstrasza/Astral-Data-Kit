'use strict';

// Browser mode. Shares the same route handlers as the desktop shell so both behave identically.
// Serving over http:// rather than file:// also keeps the canvas untainted, which PNG export
// depends on.

const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const { ClientAssets } = require('./lib/client-assets');
const { Settings } = require('./lib/settings');
const { WorldDb } = require('./lib/world-db');
const { Instances } = require('./lib/instances');
const { CustomIcons } = require('./lib/custom-icons');
const { Spells } = require('./lib/spells');
const { Achievements } = require('./lib/achievements');
const { ItemDisplay } = require('./lib/items');
const { ItemBudget } = require('./lib/item-budget');
const routes = require('./lib/routes');

const PORT = Number(process.env.PORT) || 4173;
const ROOT = path.join(__dirname, 'public');
const DATA = path.join(os.homedir(), '.astral-data-kit');

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf'
};

const settings = new Settings(path.join(DATA, 'settings.json'));
const assets = new ClientAssets(path.join(DATA, 'cache'));
const worldDb = new WorldDb();
const instances = new Instances(assets);
const customIcons = new CustomIcons(path.join(DATA, 'custom'));
const spells = new Spells(assets);
const achievements = new Achievements(assets);
const itemDisplay = new ItemDisplay(assets);
const itemBudget = new ItemBudget(assets);

const reopenClient = () =>
{
    // A different client means a different set of DBCs behind the instance tree.
    instances.reset();
    spells.reset();
    achievements.reset();
    itemDisplay.reset();
    itemBudget.reset();
    return assets.open(settings.data.clientPath);
};

if (settings.data.clientPath)
{
    reopenClient();
}

if (settings.data.db.enabled)
{
    worldDb.connect(settings.data.db).catch(() => {});
}

function readBody(req)
{
    return new Promise((resolve) =>
    {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
}

const server = http.createServer(async (req, res) =>
{
    const parsed = new URL(req.url, `http://localhost:${PORT}`);
    const body = req.method === 'POST' ? await readBody(req) : null;

    let result = null;

    try
    {
        result = await routes.handle(
            {
                assets, settings, worldDb, instances, customIcons, spells, achievements,
                itemDisplay, itemBudget, reopenClient
            },
            parsed.pathname,
            parsed.searchParams,
            body
        );
    }
    catch (err)
    {
        res.writeHead(500, { 'Content-Type': 'text/plain' }).end(`Error: ${err.message}`);
        return;
    }

    if (result)
    {
        res.writeHead(result.status, {
            'Content-Type': result.type,
            'Cache-Control': result.cache || 'no-cache'
        }).end(result.body);
        return;
    }

    // Static files, resolved inside public/ with anything escaping it refused.
    const rel = parsed.pathname === '/' ? 'index.html' : decodeURIComponent(parsed.pathname).replace(/^\/+/, '');
    const file = path.resolve(ROOT, rel);

    if (file !== ROOT && !file.startsWith(ROOT + path.sep))
    {
        res.writeHead(403).end('Forbidden');
        return;
    }

    fs.readFile(file, (err, content) =>
    {
        if (err)
        {
            res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found');
            return;
        }

        res.writeHead(200, {
            'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-cache'
        }).end(content);
    });
});

server.listen(PORT, () =>
{
    const url = `http://localhost:${PORT}/`;
    console.log(`Astral — a 3.3.5a Data Kit running at ${url}`);
    console.log(assets.ready
        ? `client: ${settings.data.clientPath} (${assets.icons.size} icons)`
        : 'client: not configured');

    if (process.argv.includes('--open'))
    {
        const { spawn } = require('child_process');
        const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
            : process.platform === 'darwin' ? ['open', [url]]
                : ['xdg-open', [url]];
        spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref();
    }
});
