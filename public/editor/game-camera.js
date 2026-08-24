'use strict';

/*
 * Framing a model the way the game frames it.
 *
 * The client ships no portrait images: `SetPortraitTexture` renders the unit live, and the shot it
 * frames comes from a camera an artist placed inside the model file. lib/portrait-camera.js digs
 * that camera out of the M2 and serves it; this is the half that points the model viewer at it, so
 * nobody has to aim anything by hand.
 *
 * Two conversions stand between the two.
 *
 * **Space.** The M2 stores an eye and a target as absolute points; the viewer orbits a target at a
 * distance, so the offset between the two has to be re-expressed as an azimuth and a zenith. Both
 * are Z-up, so this is arithmetic rather than a change of convention. Working from the *offset*
 * also means the angles carry over untouched no matter how big the model is - only the distance
 * has to be scaled.
 *
 * **Scale.** The viewer does not draw the client's M2. It draws a converted copy fetched from a
 * remote host, and that copy is not in the client's units - point the M2's camera at it unchanged
 * and you end up inside the model's chest. The ratio of the two heights is the correction, and
 * both are measurable at runtime: the server sends the M2's real vertex bounds, and the viewer's
 * actor will report its own.
 */

const RADIANS_TO_DEGREES = 180 / Math.PI;

/**
 * How far the viewer's copy of a model is turned relative to the M2's own axes.
 *
 * A quarter turn about the up axis. The viewer's renderer applies exactly this to a model's matrix
 * before drawing it, so a camera angle taken straight from the M2 lands a quarter turn away - which
 * on a portrait means looking at the back of the head. Every model is turned the same way, which is
 * what made the symptom uniform across the Lich King, Kel'Thuzad and Anub'arak alike.
 *
 * Confirmed by rendering one model at all four quarter turns and keeping the one that faced front;
 * the other three showed a shoulder or the back of the helm.
 */
const MODEL_TURN = Math.PI / 2;

/**
 * How far back to stand from what the portrait camera says.
 *
 * **One, deliberately: the client uses camera 0 raw.** The API documentation is explicit that
 * camera 0 is the one the system uses when it makes portrait pictures, and the M2 format carries
 * no other portrait data - so a correct conversion needs no correction at all, and any value here
 * other than 1 is covering for a bug elsewhere rather than fixing one.
 *
 * It was briefly 1.8, then 2, then 1.9, each fitted by eye against a single model. That was a
 * mistake twice over: the numbers disagree between models (the Lich King wants about 1.9 where
 * Anub'arak wants roughly 1), which alone proves a constant is the wrong shape of fix - and a
 * plausible-looking picture hides the real error instead of leaving it visible.
 *
 * So it stays at 1 until the residual is measured rather than guessed. Portraits come out tighter
 * than the game's, and that is the honest symptom to chase.
 */
const PORTRAIT_PULLBACK = 1;

/**
 * The vertical field of view, in degrees, for an M2 camera's `fov` field.
 *
 * **The field is a *diagonal* field of view**, which is the single thing that made every attempt at
 * this look wrong, and it is not something rendering comparisons can discover - it is stated in the
 * M2 format documentation. The client converts it by
 *
 *     vfov = dfov / sqrt(1 + aspect^2)
 *
 * so on the square viewport a portrait uses, a human's 45 degrees is 31.8 degrees vertical. Reading
 * it as vertical is 41% too wide.
 *
 * This is also where WoWModelViewer's notorious `fov * 34.5` comes from: `(180/PI) / sqrt(1 + 16/9)`
 * is 34.38, the same conversion with a 4:3 aspect baked in. Copying that constant onto a square
 * viewport is wrong in the other direction, which is why both readings tried by eye missed - the
 * right answer sits between them and depends on the aspect.
 *
 * **Validated against a frame whose framing is already known.** The character sheet's model frame
 * is 233x215 in the client's own FrameXML, an aspect of 1.084, and the character-info camera is
 * shared verbatim across models. Run through this formula it frames 130% of a human's height -
 * a character filling about three quarters of the pane with margin above and below, which is what
 * that pane looks like. The same rule on a square portrait frames 19% of a model, which matches
 * the API documentation describing camera 0 as viewing only the face.
 */
function verticalFov(fovRadians, aspect)
{
    const safe = aspect > 0 ? aspect : 1;

    return (fovRadians * RADIANS_TO_DEGREES) / Math.sqrt(1 + safe * safe);
}

/** How far off the model's own height a measured scale may land before it is not believed. */
const SCALE_LIMITS = [0.05, 20];

/**
 * Asks the server how the game would frame a display id.
 *
 * Returns null rather than throwing: a portrait is a nicety, and a client that cannot answer
 * should leave the manual viewer working rather than break the page.
 */
async function fetchGameCamera(displayId)
{
    const id = Number(displayId) || 0;

    if (!id)
    {
        return null;
    }

    try
    {
        const response = await fetch(`api/portrait-camera?displayId=${id}`);

        if (!response.ok)
        {
            return null;
        }

        const data = await response.json();

        // Either half is usable on its own: an icon needs no camera, a camera needs no icon.
        return data && (data.portrait || data.portraitIcon) ? data : null;
    }
    catch
    {
        return null;
    }
}

/**
 * How much bigger the viewer's copy of a model is than the client's.
 *
 * Heights are compared rather than volumes or widths: a model's height is the one dimension a
 * conversion has no reason to treat specially, while width swings with whatever pose the actor
 * happens to be in. A ratio that comes back absurd means the actor's bounds were not ready, and 1
 * is the safer answer than a camera parked a hundred units away.
 */
function scaleFor(renderer, box)
{
    if (!box || !box.size || !(box.size[2] > 0))
    {
        return 1;
    }

    let bounds = null;

    try
    {
        const [min, max] = renderer.actors[0].getBounds();

        if (min && max)
        {
            bounds = max[2] - min[2];
        }
    }
    catch
    {
        return 1;
    }

    if (!(bounds > 0))
    {
        return 1;
    }

    const scale = bounds / box.size[2];

    return scale >= SCALE_LIMITS[0] && scale <= SCALE_LIMITS[1] ? scale : 1;
}

/** The aspect the renderer is actually projecting with, which the fov conversion depends on. */
function aspectOf(renderer)
{
    return (renderer.viewer && renderer.viewer.aspect)
        || (renderer.height > 0 ? renderer.width / renderer.height : 1);
}

/**
 * Changes the field of view, and makes it take.
 *
 * `renderer.fov` looks like a live setting and is not: the projection matrix is built from it in
 * init and rebuilt only on resize, so writing the field alone changes nothing and every render
 * quietly keeps the viewer's default 30 degrees. Re-running the resize path with the current size
 * is what rebuilds it. This cost a whole comparison pass to notice, because a wrong field of view
 * looks exactly like a wrong distance.
 */
function setFov(renderer, degrees)
{
    renderer.fov = degrees;

    // Resizing to nothing would leave the viewer with a zero-sized buffer it never recovers from.
    if (typeof renderer.onResize === 'function' && renderer.width > 0 && renderer.height > 0)
    {
        renderer.onResize(renderer.width, renderer.height, aspectOf(renderer));
    }
}

/**
 * Points the viewer's camera where an M2 camera points.
 *
 * The renderer rebuilds its eye from azimuth, zenith, distance and target on every frame, so these
 * are the fields to write; setting `eye` directly would last exactly one frame. Three of them need
 * care:
 *
 * - `doUpdateBounds` is what the viewer sets when a model finishes loading, and it overwrites
 *   `distance` with a whole-body framing. Clearing it stops that landing on top of this.
 * - `translationFromModel` is the screen-space nudge that centers a model in the frame. A camera
 *   with a real target does its own centering, and leaving the nudge in place slides the head off
 *   to one side.
 * - `zoom` is a multiplier over `distance`, so it has to be neutral for the distance to mean what
 *   it says. Zeroing the target and the current value together avoids the viewer interpolating
 *   from wherever the wheel had left it.
 */
function applyGameCamera(renderer, camera, scale = 1, pullBack = 1)
{
    if (!renderer || !camera)
    {
        return null;
    }

    renderer.doUpdateBounds = false;

    renderer.translation[0] = 0;
    renderer.translation[1] = 0;
    renderer.translation[2] = 0;

    renderer.translationFromModel[0] = 0;
    renderer.translationFromModel[1] = 0;
    renderer.translationFromModel[2] = 0;

    /*
     * The target is a point on the model, so it turns with the model. Only the angles were wrong
     * on axis-symmetric creatures, which hid this - but a camera aimed off the centre line, like
     * the Arakkoa's, would otherwise end up beside the head rather than on it.
     */
    const turnCos = Math.cos(MODEL_TURN);
    const turnSin = Math.sin(MODEL_TURN);
    const [tx, ty, tz] = camera.target;

    renderer.target[0] = (tx * turnCos - ty * turnSin) * scale;
    renderer.target[1] = (tx * turnSin + ty * turnCos) * scale;
    renderer.target[2] = tz * scale;

    renderer.distance = camera.distance * scale * pullBack;
    setFov(renderer, verticalFov(camera.fov, aspectOf(renderer)));

    /*
     * The M2 gives the direction from target to eye and the viewer's azimuth points the other way,
     * hence the half turn; MODEL_TURN then accounts for the viewer drawing the model a quarter turn
     * from the M2's axes.
     */
    renderer.azimuth = (camera.yaw + Math.PI + MODEL_TURN + 2 * Math.PI) % (2 * Math.PI);
    renderer.zenith = Math.PI / 2 + camera.pitch;

    renderer.zoom.rateCurrent = 0;
    renderer.zoom.target = 0;
    renderer.zoom.current = 0;

    return { scale, pullBack, fov: renderer.fov, distance: renderer.distance };
}

/** Frames a loaded viewer the way the game would, and says whether it managed to. */
function frameLikeTheGame(viewer, data)
{
    const renderer = viewer && viewer.renderer;

    if (!renderer || !data || !data.portrait)
    {
        return null;
    }

    return applyGameCamera(renderer, data.portrait, scaleFor(renderer, data.box), PORTRAIT_PULLBACK);
}

export { fetchGameCamera, applyGameCamera, frameLikeTheGame, scaleFor, verticalFov, PORTRAIT_PULLBACK };
