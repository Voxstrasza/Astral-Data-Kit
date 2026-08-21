'use strict';

/* Portrait capture from the 3D model viewer — the client ships no creature portrait images. */

import { $ } from './dom.js';
import { state, runtime } from './state.js';
import { status, update } from './preview.js';

let viewerLoaded = false;
let currentModel = null;

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
 * as a hole in the model rather than as a download that failed.
 *
 * Resource timing carries the status code, so this counts them without having to wrap fetch, XHR
 * and Image between them. An engine without responseStatus simply reports nothing.
 */
let proxyFailures = [];
let proxyObserver = null;

/*
 * The status line without the warning on it.
 *
 * Parts of a model keep arriving well after the first frame, so a failure can land after the
 * viewer has already said it is ready. Holding the plain message means the warning can be added
 * to it whenever that happens rather than only at the one moment it was first written.
 */
let baseStatus = '';

function setModelStatus(message)
{
    baseStatus = message;
    $('#model-status').textContent = message + missingPieces();
}

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
            let fresh = false;

            for (const entry of list.getEntries())
            {
                if (entry.name.includes('/proxy/model') && entry.responseStatus >= 400)
                {
                    const query = entry.name.split('path=')[1] || '';
                    proxyFailures.push(decodeURIComponent(query).split('/').pop() || entry.name);
                    fresh = true;
                }
            }

            if (fresh && baseStatus)
            {
                $('#model-status').textContent = baseStatus + missingPieces();
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

    return ` ⚠ ${proxyFailures.length} model file(s) failed to load (${names}) — parts of this model are missing. Close and reopen to try again.`;
}

async function openModelViewer()
{
    const displayId = Number(state.unitDisplayId) || 0;

    if (!displayId)
    {
        status('Set a display ID first, or pick an NPC.');
        return;
    }

    $('#model-dialog').showModal();
    $('#model-status').textContent = 'Loading viewer…';

    // Disable up front, not once the viewer exists — fetching the script and model takes seconds,
    // and capturing during that window is what produced blank portraits.
    $('#btn-capture').disabled = true;

    /*
     * Tear the previous viewer down first. Without this its render loop keeps running against a
     * detached canvas, and a second #model-host appears in the document — jQuery then hands the
     * new viewer the stale one, which is why opening the viewer a second time came up blank.
     */
    if (currentModel)
    {
        try
        {
            if (typeof currentModel.destroy === 'function')
            {
                currentModel.destroy();
            }
        }
        catch
        {
            // A half-initialised viewer can throw on teardown; the DOM reset below still applies.
        }

        currentModel = null;
        window.__astralViewer = null;
    }

    // Clear the previous model but keep the portrait guide overlay.
    for (const child of [...$('#model-stage').children])
    {
        if (child.id !== 'model-guide')
        {
            child.remove();
        }
    }

    // A fresh model starts running again.
    animationPaused = false;
    $('#btn-pause').textContent = 'Pause animation';

    const ok = await loadViewerScript();

    if (!ok || typeof window.ZamModelViewer === 'undefined')
    {
        $('#model-status').textContent = 'Could not load the model viewer — check your internet connection.';
        return;
    }

    $('#model-status').textContent = `Loading model ${displayId}…`;
    watchModelRequests();
    baseStatus = '';

    try
    {
        const stage = document.createElement('div');
        stage.id = 'model-host';
        $('#model-stage').appendChild(stage);

        currentModel = new window.ZamModelViewer({
            type: 2,
            contentPath: 'proxy/model?path=',
            container: window.jQuery('#model-host'),
            aspect: 1,
            hd: false,
            // MODEL_TYPE.NPC is 8 in the viewer's own enum.
            models: { type: 8, id: displayId }
        });

        // Exposed so the pause control (and diagnostics) can reach the instance.
        window.__astralViewer = currentModel;
        waitForFirstFrame();
    }
    catch (err)
    {
        $('#model-status').textContent = `Model failed: ${err.message}`;
    }
}

/* --------------------------------------------------------------- animation pause */

let animationPaused = false;
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

function togglePause()
{
    const renderer = currentModel && currentModel.renderer;

    if (!renderer || typeof renderer.getTime !== 'function')
    {
        $('#model-status').textContent = 'No model loaded to pause.';
        return;
    }

    if (animationPaused)
    {
        renderer.getTime = renderer.__astralGetTime;
        delete renderer.__astralGetTime;
        animationPaused = false;
        $('#btn-pause').textContent = 'Pause animation';
        $('#model-status').textContent = 'Animation running.';
        return;
    }

    renderer.__astralGetTime = renderer.getTime;
    frozenTime = renderer.getTime();
    renderer.getTime = () =>
    {
        frozenTime += PAUSED_TICK;
        return frozenTime;
    };

    animationPaused = true;
    $('#btn-pause').textContent = 'Resume animation';
    $('#model-status').textContent = 'Animation paused — rotate and zoom, then capture.';
}

/* ------------------------------------------------------------ readiness & zoom */

/**
 * Waits for the first frame with anything drawn in it.
 *
 * The first open has to fetch the viewer script, the model and its textures, which takes long
 * enough that a silent black square reads as a failure. Subsequent opens are near-instant from
 * cache. Capture stays disabled until there is something to capture.
 */
function waitForFirstFrame()
{
    const capture = $('#btn-capture');
    capture.disabled = true;

    const started = Date.now();

    const poll = async () =>
    {
        const canvas = $('#model-stage').querySelector('canvas');

        // Probe from inside animation frames; a plain read is unreliable (see readCanvasFrame).
        if (canvas && await readCanvasFrame(canvas, 20))
        {
            capture.disabled = false;
            relaxZoomLimit();
            setModelStatus('Drag to rotate, scroll to zoom, then capture.');
            return;
        }

        if (Date.now() - started > 60000)
        {
            capture.disabled = false;
            setModelStatus('Model is taking unusually long — check your connection.');
            return;
        }

        const seconds = Math.round((Date.now() - started) / 1000);
        $('#model-status').textContent = `Loading model… ${seconds}s`;
        setTimeout(poll, 400);
    };

    poll();
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
 * Lets the camera get as close as it does in game.
 *
 * The viewer clamps wheel zoom to renderer.zoom.range, whose upper bound sits only slightly above
 * the starting position — so the model stops well short of a portrait framing. Widening the bound
 * removes the stop without touching how zooming behaves.
 */
function relaxZoomLimit()
{
    const renderer = currentModel && currentModel.renderer;
    const zoom = renderer && renderer.zoom;

    if (zoom && Array.isArray(zoom.range) && zoom.range.length === 2)
    {
        zoom.range = [zoom.range[0] - 20, zoom.range[1] + 25];
    }
}

/** Snapshots whatever the viewer is currently showing and uses it as the portrait. */
function capturePortrait()
{
    const canvas = $('#model-stage').querySelector('canvas');

    if (!canvas)
    {
        $('#model-status').textContent = 'Nothing rendered yet.';
        return;
    }

    const renderer = currentModel && currentModel.renderer;
    let settled = false;

    const finish = (dataUrl) =>
    {
        if (settled || !dataUrl || dataUrl.length < 128)
        {
            return;
        }

        settled = true;

        const image = new Image();
        image.onload = () =>
        {
            runtime.portraitImage = image;
            update();
            $('#model-dialog').close();
            status('Portrait captured from the 3D model.');
        };
        image.src = dataUrl;
    };

    /*
     * Read the canvas directly. The renderer keeps its drawing buffer readable, so this returns
     * the pose on screen.
     *
     * Two things that look like fixes are not: renderer.draw() throws when called outside the
     * render loop, and setting renderer.makeDataURL / screenshotCallback makes it throw on every
     * frame — that API does not take a plain callback. Leave both alone.
     *
     * A frozen clock stops the loop producing frames, and the buffer goes black, so a paused
     * capture has to let one real frame through first and then freeze again on the same pose.
     */
    /*
     * Read from inside an animation frame so the drawing buffer is still intact. Because a paused
     * clock still ticks (see togglePause), the loop keeps drawing and this is exactly the pose on
     * screen — no restoring the real clock, which used to jump the animation forward and capture
     * a frame that was never displayed.
     */
    $('#model-status').textContent = 'Capturing…';

    readCanvasFrame(canvas).then((result) =>
    {
        if (typeof result === 'string')
        {
            finish(result);
            return;
        }

        $('#model-status').textContent = result && result.error
            ? `Capture blocked: ${result.error}`
            : 'Capture came back empty — let the model finish loading, then try again.';
    });
}

export { openModelViewer, capturePortrait, togglePause };
