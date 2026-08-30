'use strict';

/* The icon picker, and the client-supplied art and fonts the renderer draws with. */

import { $, $$ } from './dom.js';
import { state, runtime } from './state.js';
import { takeIcon, wantsIcon } from './raids.js';
import { api, postJson } from './api.js';
import { update } from './preview.js';
import { FILTERS, inCategory } from './icon-categories.js';

/*
 * A custom icon is stored as "custom:folder/name" so one field can hold either source.
 *
 * The alternative — a second state field saying which source the icon came from — means every
 * place that touches an icon has to check two values and can get them out of step. A prefix
 * cannot.
 */
const CUSTOM_PREFIX = 'custom:';

const isCustom = (name) => String(name).startsWith(CUSTOM_PREFIX);

function iconUrl(name)
{
    // Client icons come out of the user's own install; custom ones out of their data folder.
    if (isCustom(name))
    {
        const reference = String(name).slice(CUSTOM_PREFIX.length);
        return `custom/icon/${reference.split('/').map(encodeURIComponent).join('/')}.png`;
    }

    return `client/icon/${encodeURIComponent(name)}.png`;
}

/*
 * Each mode keeps its own icon. Sharing one field meant switching to Spell inherited whatever the
 * item was using, so a spell opened showing a sword. Each mode now remembers its own, and a new
 * spell starts on the game's question-mark placeholder.
 */
const ICON_FIELDS = { spell: 'spellIcon', achievement: 'achIcon' };

function iconField()
{
    return ICON_FIELDS[state.kind] || 'icon';
}

function currentIconName()
{
    return state[iconField()] || '';
}

function setIcon(name, redraw = true)
{
    state[iconField()] = name || '';

    const paint = (img, value) =>
    {
        if (!img)
        {
            return;
        }

        if (value)
        {
            img.src = iconUrl(value);
        }
        else
        {
            img.removeAttribute('src');
        }
    };

    paint($('#icon-preview'), state.icon);
    paint($('#icon-preview-spell'), state.spellIcon);
    paint($('#icon-preview-ach'), state.achIcon);

    const active = currentIconName();

    if (!active)
    {
        runtime.iconImage = null;

        if (redraw)
        {
            update();
        }

        return;
    }

    const loader = new Image();
    loader.onload = () =>
    {
        runtime.iconImage = loader;
        update();
    };
    loader.onerror = () =>
    {
        runtime.iconImage = null;
        update();
    };
    loader.src = iconUrl(active);
}

/*
 * Which chip the picker is on: a category key ('all', 'armor', ...), 'folder:name' for one of
 * your own folders, or the create-a-folder chip.
 */
let activeChip = 'all';

const FOLDER_PREFIX = 'folder:';
const NEW_FOLDER_CHIP = 'new-folder';

const isFolderChip = (key) => key.startsWith(FOLDER_PREFIX);
const chipFolder = (key) => key.slice(FOLDER_PREFIX.length);

/*
 * Custom icons always live in a folder.
 *
 * There used to be a "Custom" chip for everything at once, sitting next to "Create custom folder"
 * and opening the same upload panel — two entries for one idea. Dropping it means an upload has
 * exactly one destination, the folder whose chip you are standing on, and the folder chips are
 * the whole of the custom section.
 */
const showingCustom = () => isFolderChip(activeChip);

function selectChip(key)
{
    activeChip = key;

    for (const button of $$('#icon-categories button'))
    {
        button.classList.toggle('active', button.dataset.chip === key);
    }

    // The upload panel belongs to the custom chips; the name field only to "create".
    $('#icon-upload').hidden = !showingCustom() && key !== NEW_FOLDER_CHIP;
    $('#new-folder-row').hidden = key !== NEW_FOLDER_CHIP;
    $('#upload-row').hidden = key === NEW_FOLDER_CHIP;

    paintFolderControls();
    renderIconGrid($('#icon-search').value);

    if (key === NEW_FOLDER_CHIP)
    {
        $('#new-folder-name').focus();
    }
}

/** Where an upload lands. Empty unless a folder chip is selected, and uploads require one. */
function targetFolder()
{
    return isFolderChip(activeChip) ? chipFolder(activeChip) : '';
}

function paintFolderControls()
{
    const remove = $('#btn-delete-folder');

    if (!remove)
    {
        return;
    }

    const folder = targetFolder();

    remove.hidden = !folder;
    remove.textContent = `Delete "${folder}"`;
    remove.dataset.armed = '';

    const target = $('#upload-target');

    if (target)
    {
        target.textContent = folder ? `Uploading into "${folder}"` : '';
    }
}

/*
 * Rebuilt whenever the folder list changes, because a new folder has to appear here — the chips
 * are the folder list, so there is nowhere else for it to show up.
 */
function buildCategoryChips()
{
    const host = $('#icon-categories');

    if (!host)
    {
        return;
    }

    host.textContent = '';

    const chips = [
        ...FILTERS.map((f) => ({ key: f.key, label: f.label })),
        ...(runtime.customFolders || [])
            .filter(Boolean)
            .map((folder) => ({ key: FOLDER_PREFIX + folder, label: folder, folder: true })),
        { key: NEW_FOLDER_CHIP, label: '+ Create custom folder', create: true }
    ];

    for (const chip of chips)
    {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = chip.label;
        button.dataset.chip = chip.key;
        button.classList.toggle('active', chip.key === activeChip);

        if (chip.folder) { button.classList.add('folder-chip'); }
        if (chip.create) { button.classList.add('create-chip'); }

        button.addEventListener('click', () => selectChip(chip.key));
        host.appendChild(button);
    }
}

/** The names the current chip and search box between them allow. */
function matchingIcons(query)
{
    if (showingCustom())
    {
        const folder = targetFolder();

        return (runtime.customIcons || [])
            .filter((icon) => icon.folder === folder
                && (!query || icon.path.toLowerCase().includes(query)))
            .map((icon) => CUSTOM_PREFIX + icon.path);
    }

    if (activeChip === NEW_FOLDER_CHIP)
    {
        return [];
    }

    return runtime.iconNames.filter((name) =>
        (!query || name.includes(query)) && inCategory(name, activeChip));
}

function iconButton(name)
{
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = isCustom(name) ? name.slice(CUSTOM_PREFIX.length) : name;

    const img = document.createElement('img');

    /*
     * Every match is rendered, all 6,300 of them if you ask for All.
     *
     * The old build stopped at 400 and told you to keep typing, which made browsing for something
     * you could not name impossible. loading="lazy" is what makes the whole set affordable: the
     * buttons are cheap, and the browser only fetches the images that scroll into view.
     */
    img.loading = 'lazy';
    img.decoding = 'async';
    img.src = iconUrl(name);
    img.alt = btn.title;

    /*
     * A tile that cannot load takes itself out of the grid.
     *
     * The index lists what the archives say they hold, and an entry that will not come back as an
     * image leaves a gap you can click on — which is how inv_shoulder_94.tga looked before the
     * archive fallback found it. That fallback is the fix; this is the net under it, so a name
     * that genuinely has no art behind it costs a space rather than a puzzle.
     */
    img.addEventListener('error', () => btn.remove());

    btn.appendChild(img);

    /*
     * A click in the grid is the only place an icon is *chosen*.
     *
     * The raid wizard borrows this dialog for a logo, which belongs to a file rather than a field,
     * so the hand-off lives here rather than in setIcon. setIcon is also what every window calls
     * to repaint the icon it already has - on a mode switch, a search result, a saved sheet - and
     * a hand-off sitting in there swallowed those repaints and quietly wrote them into the raid's
     * logo instead, which is how a picked icon stopped taking effect.
     */
    btn.addEventListener('click', () =>
    {
        if (!(wantsIcon() && takeIcon(name)))
        {
            setIcon(name);
        }

        $('#icon-dialog').close();
    });

    return btn;
}

function renderIconGrid(filter)
{
    const grid = $('#icon-grid');
    const query = String(filter || '').trim().toLowerCase();
    const matches = matchingIcons(query);

    grid.textContent = '';

    if (activeChip === NEW_FOLDER_CHIP)
    {
        $('#icon-count').textContent = 'Name a folder and create it - it joins the row above.';
        return;
    }

    if (showingCustom() && !matches.length)
    {
        $('#icon-count').textContent = query
            ? 'No icons in this folder match that.'
            : 'This folder is empty - upload a PNG below.';
        return;
    }

    $('#icon-count').textContent =
        `${matches.length.toLocaleString()} icon${matches.length === 1 ? '' : 's'}`;

    const frag = document.createDocumentFragment();

    for (const name of matches)
    {
        frag.appendChild(iconButton(name));
    }

    grid.appendChild(frag);
}

/* ------------------------------------------------------------- custom icons */

async function loadCustomIcons()
{
    try
    {
        const result = await api('api/custom/icons');
        runtime.customIcons = result.icons || [];
        runtime.customFolders = result.folders || [''];
        runtime.iconNativeSize = result.nativeSize || 64;
    }
    catch
    {
        runtime.customIcons = [];
        runtime.customFolders = [''];
    }

    buildCategoryChips();
    paintFolderControls();
}

function customStatus(message)
{
    const el = $('#custom-status');

    if (el)
    {
        el.textContent = message || '';
    }
}

/**
 * Redraws an already-decoded image at the icon size, as a PNG data URL.
 *
 * Straight to 64x64 rather than fitted inside it: icon art is square, and the one case where it is
 * not — a sprite sheet or a screenshot picked by mistake — is better off looking obviously squashed
 * than quietly letterboxed into something that passes for an icon.
 *
 * Smoothing is asked for explicitly. Most of these are downscales from 128 or 256, where the
 * browser's default nearest-ish path leaves the edges crawling.
 */
function redrawAtIconSize(image, size)
{
    const canvas = document.createElement('canvas');

    canvas.width = size;
    canvas.height = size;

    const ctx = canvas.getContext('2d');

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, size, size);

    return canvas.toDataURL('image/png');
}

/**
 * Reads a chosen icon and hands it to the server, at 64x64.
 *
 * The resize happens here rather than server-side because this is where the browser decodes the
 * file for free — there is no PNG decoder in lib/, only an encoder, and adding one to scale a
 * picture the window has already got in memory would be work for its own sake.
 *
 * A file the browser cannot decode goes up untouched and is dealt with on the other side: that is
 * TGA, which no browser reads and which lib/custom-icons.js already converts. It resizes there.
 */
async function uploadFiles(files)
{
    const folder = targetFolder();

    // Every custom icon belongs to a folder, so there is nowhere to put these without one.
    if (!folder)
    {
        customStatus('Choose a folder first, or create one.');
        return;
    }

    const native = runtime.iconNativeSize || 64;
    const resized = [];
    let saved = 0;

    for (const file of files)
    {
        let dataUrl = await new Promise((resolve) =>
        {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(file);
        });

        if (!dataUrl)
        {
            continue;
        }

        const decoded = await new Promise((resolve) =>
        {
            const probe = new Image();
            probe.onload = () => resolve(probe);
            probe.onerror = () => resolve(null);
            probe.src = dataUrl;
        });

        if (decoded && (decoded.naturalWidth !== native || decoded.naturalHeight !== native))
        {
            resized.push(`${file.name} was ${decoded.naturalWidth}x${decoded.naturalHeight}`);
            dataUrl = redrawAtIconSize(decoded, native);
        }

        const result = await postJson('api/custom/upload', {
            folder,
            name: file.name.replace(/\.[^.]+$/, ''),
            data: dataUrl
        });

        if (result.ok)
        {
            saved++;
        }
        else
        {
            customStatus(result.reason || 'Upload failed.');
        }
    }

    await loadCustomIcons();
    renderIconGrid($('#icon-search').value);

    /* Said rather than warned about. The file is already the right size by the time this reads,
       so the only thing left worth knowing is which ones were not and what they were. */
    const note = resized.length
        ? ` Scaled to ${native}x${native}: ${resized.join(', ')}.`
        : '';

    customStatus(`${saved} icon${saved === 1 ? '' : 's'} added.${note}`);
}

/**
 * Deleting a folder takes two clicks when it has icons in it.
 *
 * A browser confirm() would block the window and cannot be used here, so the button arms itself
 * instead: the first click says how many icons would go with it, the second does it. An empty
 * folder goes on the first click, because there is nothing to lose.
 */
async function deleteFolder()
{
    const folder = targetFolder();

    if (!folder)
    {
        return;
    }

    const button = $('#btn-delete-folder');
    const count = (runtime.customIcons || []).filter((i) => i.folder === folder).length;

    if (count && button.dataset.armed !== 'yes')
    {
        button.dataset.armed = 'yes';
        button.textContent = `Delete "${folder}" and ${count} icon${count === 1 ? '' : 's'}?`;
        customStatus('Click again to confirm.');
        return;
    }

    const result = await postJson('api/custom/folder/delete', { name: folder });

    if (!result.ok)
    {
        customStatus(result.reason || 'Could not delete that folder.');
        return;
    }

    await loadCustomIcons();

    // Stay in the custom section: the next folder along, or the create chip if that was the last.
    const remaining = (runtime.customFolders || []).filter(Boolean);
    selectChip(remaining.length ? FOLDER_PREFIX + remaining[0] : NEW_FOLDER_CHIP);

    customStatus(`Deleted "${folder}"${result.removed ? ` and ${result.removed} icon${result.removed === 1 ? '' : 's'}` : ''}.`);
}

function bindCustomIcons()
{
    const file = $('#custom-file');

    if (!file)
    {
        return;
    }

    file.addEventListener('change', async () =>
    {
        if (file.files && file.files.length)
        {
            customStatus('Uploading…');
            await uploadFiles([...file.files]);
            file.value = '';
        }
    });

    $('#btn-new-folder').addEventListener('click', async () =>
    {
        const name = $('#new-folder-name').value.trim();

        if (!name)
        {
            customStatus('Type a folder name first.');
            return;
        }

        const result = await postJson('api/custom/folder', { name });

        if (!result.ok)
        {
            customStatus(result.reason || 'Could not create that folder.');
            return;
        }

        $('#new-folder-name').value = '';
        await loadCustomIcons();

        // Straight into the folder just made, which is also where uploads will now go.
        selectChip(FOLDER_PREFIX + result.folder);
        customStatus(`Created "${result.folder}".`);
    });

    $('#btn-delete-folder').addEventListener('click', deleteFolder);
}

const UI_ART = [
    'socket-red', 'socket-yellow', 'socket-blue', 'socket-meta', 'socket-generic',
    'coin-gold', 'coin-silver', 'coin-copper',
    'unit-frame', 'unit-frame-nomana', 'unit-frame-elite', 'unit-frame-rare',
    'ach-parchment', 'ach-parchment-desaturated', 'ach-title', 'ach-iconframe',
    'ach-shields', 'ach-shields-nopoints', 'ach-reward-bg', 'ach-criteria-check',
    'ach-tsunami-corners', 'ach-tsunami-horizontal',
    'unit-frame-rare-elite', 'unit-frame-boss', 'unit-skull', 'unit-level-bg'
];

/**
 * Preloads the client-extracted socket and coin textures. The renderer draws synchronously, so
 * these have to be decoded before the first paint or the first frame would silently fall back.
 */
function loadAssets()
{
    window.TooltipAssets = window.TooltipAssets || {};

    return Promise.all(UI_ART.map((name) => new Promise((resolve) =>
    {
        const image = new Image();
        image.onload = () => { window.TooltipAssets[name] = image; resolve(); };
        image.onerror = resolve;
        image.src = `ui/${name}.png`;
    })));
}

async function loadIcons()
{
    try
    {
        runtime.iconNames = await api('api/client/icons');
    }
    catch
    {
        runtime.iconNames = [];
    }

    // Custom icons are independent of the client, so a missing install does not stop them.
    await loadCustomIcons();
}

/*
 * Registers the client's own fonts. Canvas measures text synchronously, so these have to be
 * loaded and added to document.fonts before the first render or the layout would be computed
 * against the fallback and then never recalculated.
 */
async function loadGameFonts()
{
    if (!runtime.clientStatus.ready)
    {
        return;
    }

    const faces = [
        ['AstralGame', 'FRIZQT__.TTF'],
        ['AstralNumber', 'ARIALN.TTF']
    ];

    await Promise.all(faces.map(async ([family, file]) =>
    {
        try
        {
            const face = new FontFace(family, `url("client/font/${file}")`);
            await face.load();
            document.fonts.add(face);
        }
        catch
        {
            // Missing font just means the fallback stack is used.
        }
    }));
}

export {
    iconUrl, iconField, currentIconName, setIcon, renderIconGrid,
    loadAssets, loadIcons, loadGameFonts, loadCustomIcons, bindCustomIcons
};
