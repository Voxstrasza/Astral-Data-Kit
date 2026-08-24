'use strict';

/*
 * Portraits for the target frame.
 *
 * Nearly every unit is rendered live from its model, framed by a camera inside the model file, so
 * most of this drives the 3D viewer - off screen, with nothing to aim and one button to press. The
 * exception is the handful of displays that name a portrait icon in the client data and are drawn
 * as that image instead; those never reach the viewer at all.
 */

import { $ } from './dom.js';
import { runtime } from './state.js';
import { status, update } from './preview.js';
import { fetchGameCamera, frameLikeTheGame } from './game-camera.js';

let viewerLoaded = false;

/**
 * Loads the model-viewer script once. It and all model data come through our own proxy so the
 * WebGL canvas stays same-origin — a cross-origin texture would taint it and make the capture
 * below throw instead of returning an image.
 */
function loadViewerScript()
{
    if (viewerLoaded)
    {
        return Promise.resolve(true);
    }

    // The viewer is built against jQuery and expects a global WH namespace for logging,
    // animation defaults and image format detection. Same shims the Keira editor uses.
    if (!window.WH)
    {
        window.WH = {
            debug: () => {},
            defaultAnimation: 'Stand',
            WebP: { getImageExtension: () => '.webp' }
        };
    }

    return new Promise((resolve) =>
    {
        const script = document.createElement('script');
        script.src = 'proxy/viewer.js';
        script.onload = () => { viewerLoaded = true; resolve(true); };
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
}

/* ------------------------------------------------- missing pieces of a model */

/*
 * Which of a model's parts failed to arrive.
 *
 * The viewer treats a failed request as an absent part: nothing is logged and nothing is drawn.
 * That is how a model comes up looking wrong rather than broken — a helmet that never arrives
 * leaves a head whose hair and face geosets were already hidden to make room for it, which reads
 * as a hole in the model rather than as a download that failed. It is worth saying out loud on
 * the status line, since there is nothing else to look at.
 *
 * Resource timing carries the status code, so this counts them without having to wrap fetch, XHR
 * and Image between them. An engine without responseStatus simply reports nothing.
 */
let proxyFailures = [];
let proxyObserver = null;

function watchModelRequests()
{
    proxyFailures = [];

    if (proxyObserver || typeof PerformanceObserver === 'undefined')
    {
        return;
    }

    try
    {
        proxyObserver = new PerformanceObserver((list) =>
        {
            for (const entry of list.getEntries())
            {
                if (entry.name.includes('/proxy/model') && entry.responseStatus >= 400)
                {
                    const query = entry.name.split('path=')[1] || '';
                    proxyFailures.push(decodeURIComponent(query).split('/').pop() || entry.name);
                }
            }
        });

        proxyObserver.observe({ type: 'resource', buffered: false });
    }
    catch
    {
        proxyObserver = null;
    }
}

/** The sentence to hang off the status line when parts of the model went missing. */
function missingPieces()
{
    if (!proxyFailures.length)
    {
        return '';
    }

    const names = [...new Set(proxyFailures)].slice(0, 3).join(', ');

    return ` ⚠ ${proxyFailures.length} model file(s) failed to load (${names}) - parts of this model are missing. Try again.`;
}

/* --------------------------------------------------------------- animation pause */

let frozenTime = 0;

/**
 * Freezes the animation by slowing the renderer's clock to a crawl.
 *
 * The viewer exposes no play/pause, but every frame advances from renderer.getTime(). Returning a
 * flat constant is the obvious approach and it is wrong twice over: the loop sees no elapsed time
 * and stops drawing, so the canvas goes black, and restoring the real clock to take a capture
 * makes the animation leap forward by the whole pause duration — capturing a pose you never saw.
 *
 * Advancing by a hair each call keeps the loop drawing (so the model can still be rotated, and
 * capture reads exactly what is on screen) while the pose stays put.
 */
const PAUSED_TICK = 0.0001;

/**
 * Stops or starts a model moving.
 *
 * A portrait wants a settled pose rather than whatever frame the idle animation happened to be on,
 * so this runs on every render - there is no button, and nothing ever asks for it to be undone.
 * The unpause half stays because a freeze with no way back is the kind of thing that bites later.
 */
function setPaused(viewer, paused)
{
    const renderer = viewer && viewer.renderer;

    if (!renderer || typeof renderer.getTime !== 'function')
    {
        return false;
    }

    if (!paused)
    {
        if (renderer.__astralGetTime)
        {
            renderer.getTime = renderer.__astralGetTime;
            delete renderer.__astralGetTime;
        }

        return true;
    }

    if (renderer.__astralGetTime)
    {
        return true;
    }

    renderer.__astralGetTime = renderer.getTime;
    frozenTime = renderer.getTime();
    renderer.getTime = () =>
    {
        frozenTime += PAUSED_TICK;
        return frozenTime;
    };

    return true;
}

/** Cheap "is anything drawn" test — samples a downscale rather than every pixel. */
function canvasHasContent(canvas)
{
    try
    {
        const probe = document.createElement('canvas');
        probe.width = 48;
        probe.height = 48;

        const ctx = probe.getContext('2d');
        ctx.drawImage(canvas, 0, 0, 48, 48);

        const data = ctx.getImageData(0, 0, 48, 48).data;

        for (let i = 0; i < data.length; i += 4)
        {
            if (data[i] > 16 || data[i + 1] > 16 || data[i + 2] > 16)
            {
                return true;
            }
        }
    }
    catch
    {
        // Unreadable canvas counts as not ready.
    }

    return false;
}

/**
 * Reads the viewer's canvas, from inside an animation frame, retrying until a frame has content.
 *
 * This is the crux of the intermittent blank renders and empty captures. The WebGL context has no
 * preserved drawing buffer, so the pixels only exist between the viewer's draw and the browser's
 * composite — a read at an arbitrary moment usually lands outside that window and comes back
 * empty, at random. Measuring the same loaded, actively-drawing model gave 0 pixels eighteen times
 * running in one probe and 68% coverage in the next.
 *
 * Registering our callback during a frame puts it after the viewer's own draw for that frame, so
 * the buffer is still intact when we read it.
 */
function readCanvasFrame(canvas, maxFrames = 240)
{
    return new Promise((resolve) =>
    {
        let frames = 0;

        const attempt = () =>
        {
            frames++;

            if (canvasHasContent(canvas))
            {
                try
                {
                    resolve(canvas.toDataURL('image/png'));
                }
                catch (err)
                {
                    resolve({ error: err.message });
                }

                return;
            }

            if (frames >= maxFrames)
            {
                resolve(null);
                return;
            }

            requestAnimationFrame(attempt);
        };

        requestAnimationFrame(attempt);
    });
}

/**
 * What the framing actually did, in one line.
 *
 * Put on the status line rather than kept in a console because a portrait that looks wrong is
 * diagnosed from a screenshot, and the two numbers that matter are which model was drawn and what
 * scale was used. The client's own scale sits beside the measured one: a gap between them means
 * the viewer's copy is not the size the client would draw, which is the thing worth knowing first.
 */
function framingSummary(applied, data)
{
    const file = (data.path || '').split('\\').pop() || 'unknown model';
    const measured = applied.scale.toFixed(3);
    const client = data.dbcScale ? data.dbcScale.toFixed(3) : '?';
    const agrees = data.dbcScale
        && Math.abs(applied.scale - data.dbcScale) / data.dbcScale < 0.05;

    return `${file} - scale ${measured} (client ${client})${agrees ? '' : ' ⚠ disagree'}`
        + ` - fov ${applied.fov.toFixed(1)}°`;
}


/* ----------------------------------------------------- the portrait, start to finish */

/*
 * The game does not ask anyone to aim a camera at a unit to get its portrait, and neither does
 * this. Load the model, frame it, hold the pose, read the pixels - all of it without showing any
 * of it, because the framing is not a judgement call: it is the camera the model was shipped with.
 *
 * There used to be a viewer dialog beside this, with a manual camera and a capture button, kept
 * while the automatic framing was still being trusted. It is gone: aiming by hand could only
 * produce a worse portrait than the artist's own camera, and every part of it that mattered - the
 * pause, the canvas read, the missing-part warning - lives here now.
 *
 * Hiding the stage is where this gets particular. Three things have to survive it: the host needs
 * a size for the viewer to build its canvas against, the page has to keep running animation frames
 * for it, and - the one that is easy to miss - the browser has to keep *painting* it. A canvas the
 * compositor has decided is not on screen still runs its render loop and still reports the right
 * camera, but comes back a white ghost of the model: textures and skinning never make it to the
 * GPU, so what is captured is a deformed, untextured shell. That is what a portrait taken off the
 * left edge of the page looked like, next to a correct one from a painted stage with identical
 * camera values.
 *
 * Measured on the Lich King, one viewer at a time, same size and settle, capture at the end:
 *
 *   left:-1024px          broken     opacity:0             broken
 *   transform:translateX  broken     opacity:0.01          fine
 *   on screen             fine       z-index:-1            fine
 *                                    clip-path:inset(100%) fine
 *
 * The split is not "off screen" but "painted": anything the compositor skips entirely takes the
 * model with it. So the stage sits at the top left corner at full size, where it is painted, and
 * is clipped away to nothing - invisible, no layout of its own, and rendering exactly as a stage
 * in plain sight does.
 */
const AUTO_SIZE = 512;
const AUTO_TIMEOUT = 60000;

let autoRunning = false;

/*
 * The label the button wears when it is not working, read off the button rather than written here
 * so the wording lives in one place - the markup.
 */
let idleLabel = '';

/**
 * Says a portrait is being made, for as long as it takes.
 *
 * The status line clears itself after four seconds and a model the browser has never fetched can
 * take longer than that, so on its own it leaves a page that looks idle in the middle of the work.
 * The button is the thing that was just pressed, which makes it the honest place to say so - and
 * disabling it also stops the second press that would only be told to wait its turn.
 */
function setBusy(busy)
{
    const button = $('#btn-auto-portrait');

    if (!button)
    {
        return;
    }

    idleLabel = idleLabel || button.textContent;
    button.disabled = busy;
    button.textContent = busy ? 'Generating…' : idleLabel;
}

function autoHost()
{
    const host = document.createElement('div');

    host.id = 'auto-model-stage';
    host.setAttribute('aria-hidden', 'true');
    host.style.cssText =
        `position:fixed;left:0;top:0;width:${AUTO_SIZE}px;height:${AUTO_SIZE}px;`
        + 'background:#000;pointer-events:none;clip-path:inset(100%);';

    const inner = document.createElement('div');

    inner.id = 'auto-model-host';
    inner.style.cssText = 'width:100%;height:100%;';
    host.appendChild(inner);
    document.body.appendChild(host);

    return host;
}

/**
 * Loads a display id's model out of sight, frames it as the game does and keeps the picture.
 *
 * Only one runs at a time. Two viewers alive at once produced blank renders back when the dialog
 * could have one open beside this, and there is no reason to risk it for a second portrait nobody
 * asked for yet.
 */
async function autoPortrait(displayId)
{
    const id = Number(displayId) || 0;

    if (!id)
    {
        status('Set a display ID first, or pick an NPC.');
        return false;
    }

    if (autoRunning)
    {
        status('Still fetching the last portrait.');
        return false;
    }

    autoRunning = true;
    setBusy(true);
    watchModelRequests();
    status(`Rendering the portrait for ${id}…`);

    let viewer = null;
    let host = null;

    try
    {
        /*
         * Ask the client first. It answers off local disk in a moment, and it can answer outright:
         * a display naming a PortraitTextureName is drawn by the game as that icon and never
         * rendered at all, so there is nothing to load, frame or capture. Doing this before the
         * viewer exists also avoids fetching a model that would only be thrown away - which is the
         * whole of what an invisible-model creature would have cost.
         */
        const camera = await fetchGameCamera(id);

        if (camera && camera.portraitIcon)
        {
            const used = await usePortrait(`client/icon/${encodeURIComponent(camera.portraitIcon)}.png`);

            status(used
                ? `Portrait is the client's own icon for this display: ${camera.portraitIcon}.`
                : `This display names the icon ${camera.portraitIcon}, which your client does not have.`);

            return used;
        }

        if (!camera || !camera.portrait)
        {
            status(`Display ${id} has neither a portrait camera nor a portrait icon.`);
            return false;
        }

        if (!await loadViewerScript() || typeof window.ZamModelViewer === 'undefined')
        {
            status('Could not load the model viewer - check your internet connection.');
            return false;
        }

        host = autoHost();
        viewer = new window.ZamModelViewer({
            type: 2,
            contentPath: 'proxy/model?path=',
            container: window.jQuery('#auto-model-host'),
            aspect: 1,
            hd: false,
            models: { type: 8, id }
        });

        // Reachable while it exists: there is no other way to look at what an off-screen render
        // is doing.
        window.__astralAutoViewer = viewer;

        const canvas = await waitForCanvas(host);

        if (!canvas)
        {
            status(`Model ${id} did not load.${missingPieces()}`);
            return false;
        }

        const applied = frameLikeTheGame(viewer, camera);

        if (!applied)
        {
            status(`Model ${id} carries no portrait camera.`);
            return false;
        }

        // Hold the pose so the capture is repeatable rather than whatever frame it landed on.
        setPaused(viewer, true);

        await settleUntilStill(viewer, camera, host);

        // Ask for the canvas again rather than reusing the one waited on: see liveCanvas.
        const shot = await readCanvasFrame(liveCanvas(viewer, host) || canvas);

        if (typeof shot !== 'string')
        {
            status(`The portrait came back empty.${missingPieces()}`);
            return false;
        }

        await usePortrait(shot);
        status(`Portrait rendered as the game frames it: ${framingSummary(applied, camera)}`
            + missingPieces());

        return true;
    }
    catch (err)
    {
        status(`Portrait failed: ${err.message}`);

        return false;
    }
    finally
    {
        tearDown(viewer, host);

        window.__astralAutoViewer = null;

        autoRunning = false;
        setBusy(false);
    }
}

/**
 * Gets rid of a viewer, including the part its own teardown leaves behind.
 *
 * `destroy()` detaches the canvas and drops the actors, and that is all: the WebGL context stays
 * alive, held by a canvas nobody can reach any more. A browser allows a limited number at once -
 * sixteen in Chromium - and past that it starts killing the oldest to make room. Twenty portraits
 * in a row is enough to reach it, and the console says so plainly:
 *
 *     14. WARNING: Too many active WebGL contexts. Oldest context will be lost.
 *
 * Once that starts, a portrait can be drawing into a context the browser has decided to reclaim,
 * which is the "it just stops loading after a few" that gets reported. Losing the context on
 * purpose returns it immediately, and `WEBGL_lose_context` is the only way to say so - there is no
 * close() for a WebGL context and dropping the reference only frees it whenever a collection
 * happens to run.
 *
 * The canvases are collected before `destroy()` because it is what detaches them: afterwards the
 * renderer's handle is null and the host is empty, so there would be nothing left to release.
 */
function tearDown(viewer, host)
{
    const canvases = new Set();
    const handle = viewer && viewer.renderer && viewer.renderer.canvas;

    if (handle && handle[0])
    {
        canvases.add(handle[0]);
    }

    for (const canvas of host ? host.querySelectorAll('canvas') : [])
    {
        canvases.add(canvas);
    }

    if (viewer && typeof viewer.destroy === 'function')
    {
        try
        {
            viewer.destroy();
        }
        catch
        {
            // A viewer that never finished initialising can throw here; the rest still happens.
        }
    }

    for (const canvas of canvases)
    {
        try
        {
            // The viewer asks for either name, and a second getContext returns the same context.
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            const lose = gl && gl.getExtension('WEBGL_lose_context');

            if (lose)
            {
                lose.loseContext();
            }
        }
        catch
        {
            // A canvas that never got a context, or a browser without the extension.
        }
    }

    if (host)
    {
        host.remove();
    }
}

/**
 * The canvas the viewer is drawing into right now.
 *
 * Asked for at capture time rather than held from earlier. Applying a field of view has to go
 * through the viewer's resize path, and a resize is entitled to replace the canvas; a stale
 * reference would still be a canvas with pixels in it, so reading one returns a picture of an
 * older frame instead of failing. Traces of the off-screen render show the element surviving in
 * practice, which is exactly why this is worth not depending on. The renderer's own handle is the
 * authoritative answer, and the host is only searched if it is missing.
 */
function liveCanvas(viewer, host)
{
    const handle = viewer && viewer.renderer && viewer.renderer.canvas;

    if (handle && handle[0])
    {
        return handle[0];
    }

    const all = host ? host.querySelectorAll('canvas') : [];

    return all.length ? all[all.length - 1] : null;
}

/*
 * How long the picture has to stop changing before it counts as finished.
 *
 * Three samples a quarter of a second apart, and never less than a second in total. A model with
 * nothing left to load is pixel-for-pixel identical between frames once the pose is frozen, so
 * the only thing this waits out is the model still arriving.
 */
const STILL_SAMPLES = 3;
const STILL_EVERY = 250;
const STILL_FLOOR = 1000;

/** How far a channel may drift and still count as the same picture. */
const STILL_TOLERANCE = 8;

/** A small thumbprint of what is on the canvas, read from inside a frame (see readCanvasFrame). */
function frameFingerprint(canvas)
{
    return new Promise((resolve) =>
    {
        if (!canvas)
        {
            resolve(null);
            return;
        }

        requestAnimationFrame(() =>
        {
            try
            {
                const probe = document.createElement('canvas');

                probe.width = 32;
                probe.height = 32;

                const ctx = probe.getContext('2d', { willReadFrequently: true });

                ctx.drawImage(canvas, 0, 0, 32, 32);
                resolve(ctx.getImageData(0, 0, 32, 32).data);
            }
            catch
            {
                resolve(null);
            }
        });
    });
}

function sameFrame(a, b)
{
    if (!a || !b || a.length !== b.length)
    {
        return false;
    }

    for (let i = 0; i < a.length; i++)
    {
        // Alpha too: a mesh that has not arrived leaves the background showing through.
        if (Math.abs(a[i] - b[i]) > STILL_TOLERANCE)
        {
            return false;
        }
    }

    return true;
}

/**
 * When the last piece of a model arrived, so a lull in the picture can be told from a finished one.
 *
 * Read from a live observer rather than by counting `getEntriesByType`, because the resource
 * timing buffer stops recording at 250 entries and a session that has already viewed a few models
 * would sit past that - leaving the count frozen and every moment looking quiet.
 */
function watchModelTraffic()
{
    let last = Date.now();

    if (typeof PerformanceObserver === 'undefined')
    {
        return { quietFor: () => Infinity, stop: () => {} };
    }

    const observer = new PerformanceObserver((list) =>
    {
        for (const entry of list.getEntries())
        {
            if (entry.name.includes('/proxy/model'))
            {
                last = Date.now();
                return;
            }
        }
    });

    try
    {
        observer.observe({ type: 'resource', buffered: false });
    }
    catch
    {
        return { quietFor: () => Infinity, stop: () => {} };
    }

    return { quietFor: () => Date.now() - last, stop: () => observer.disconnect() };
}

/**
 * Holds the framing until the model has stopped arriving.
 *
 * A fixed wait was what this used to be, and it is not enough: a model the browser has never
 * fetched draws its first frame long before its last part lands. What came out was a white ghost
 * with two glowing eyes - Orbaz Bloodbane cold, then perfect on the second press. Guessing a
 * longer wait would only move the line.
 *
 * Two things have to agree before a frame counts as the finished one, and the ghost is why it
 * takes both. Traced through a cold load at five samples a second:
 *
 *     600ms   2 lit pixels, unchanged   32 parts fetched so far
 *    1800ms   2 lit pixels, unchanged   73 parts fetched so far
 *    2000ms   806 lit pixels            78 parts, and no more after this
 *
 * The eye glow draws before anything else and then sits perfectly still for over a second, so the
 * picture alone says "finished" while most of the model is still on the wire. The requests alone
 * are no better - they go quiet during a stall. Together they are solid: the frame has to be
 * identical across three samples *and* nothing may have arrived for the model during them.
 *
 * The framing is re-applied on every sample because each part that lands asks the renderer to
 * re-fit the camera to the model's bounds, which would throw the portrait framing away and replace
 * it with a whole-body shot some time after it was set. Re-applying is idempotent, so the scale
 * settling as the bounds grow folds into the same wait.
 */
async function settleUntilStill(viewer, camera, host, timeout = AUTO_TIMEOUT)
{
    const until = Date.now() + timeout;
    const floor = Date.now() + STILL_FLOOR;
    const quiet = STILL_SAMPLES * STILL_EVERY;
    const traffic = watchModelTraffic();

    let previous = null;
    let stable = 0;

    try
    {
        while (Date.now() < until)
        {
            frameLikeTheGame(viewer, camera);

            const thumb = await frameFingerprint(liveCanvas(viewer, host));

            stable = sameFrame(previous, thumb) ? stable + 1 : 0;
            previous = thumb;

            if (stable >= STILL_SAMPLES && traffic.quietFor() >= quiet && Date.now() >= floor)
            {
                return true;
            }

            await new Promise((resolve) => setTimeout(resolve, STILL_EVERY));
        }
    }
    finally
    {
        traffic.stop();
    }

    return false;
}

/**
 * Waits for the off-screen viewer to draw something, or gives up.
 *
 * Readiness is probed with readCanvasFrame rather than canvasHasContent directly, for the same
 * reason waitForFirstFrame does: without a preserved drawing buffer the pixels only exist inside
 * the frame that drew them, so a poll from a timer reads an empty canvas off a model that is
 * drawing perfectly well.
 */
function waitForCanvas(host)
{
    const started = Date.now();

    return new Promise((resolve) =>
    {
        const poll = async () =>
        {
            const canvas = host.querySelector('canvas');

            if (canvas && await readCanvasFrame(canvas, 20))
            {
                resolve(canvas);
                return;
            }

            if (Date.now() - started > AUTO_TIMEOUT)
            {
                resolve(null);
                return;
            }

            setTimeout(poll, 300);
        };

        poll();
    });
}

/** Puts a captured PNG in the portrait ring and redraws. */
function usePortrait(dataUrl)
{
    return new Promise((resolve) =>
    {
        const image = new Image();

        image.onload = () =>
        {
            runtime.portraitImage = image;
            update();
            resolve(true);
        };

        image.onerror = () => resolve(false);
        image.src = dataUrl;
    });
}

export { autoPortrait };
