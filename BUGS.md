# Bugs

Reported and not yet fixed. Each one says what was seen, and what has already been ruled out, so
nobody starts the diagnosis from nothing.

---

## Generating a portrait more than once turns the model

**Seen on 2026-08-25.** Clicking **Generate portrait** repeatedly comes back with the character
turned - facing away, or side on, rather than the three-quarter view. Keep clicking and it comes
back round to the right angle eventually, which is the most useful thing about the report: the
error is an angle that moves in steps, not a broken render.

**Not concurrent re-entrancy.** `autoPortrait` in `public/editor/model-viewer.js` already guards
against a second run starting while the first is going: `autoRunning` is set synchronously before
the first `await`, and a second click is refused with "Still fetching the last portrait." So this
is about *sequential* runs rather than two at once.

**Where suspicion falls: the azimuth, not the renderer.** `public/editor/game-camera.js` sets
`renderer.azimuth = (camera.yaw + Math.PI + MODEL_TURN + 2 * Math.PI) % (2 * Math.PI)`. That is an
absolute angle, so setting it twice should be harmless - unless something downstream applies it as
a *delta*, or the viewer keeps a rotation from the previous run that this then adds to. A fault
that steps round and returns to correct after enough clicks is exactly what accumulating a fixed
turn each run looks like. Check what the renderer does with `azimuth` on a reused instance before
looking anywhere else.

Ruled out by the symptom: WebGL context loss, which was a real problem here once and which
`tearDown` now handles by losing the context explicitly. That failure looks like a white ghost or
nothing at all, not a correctly drawn character facing the wrong way.

**Weigh the fix against the live-portrait plan.** Rendering the client's own M2 rather than a
remote mesh replaces this whole path, camera included, and would retire the bug rather than patch
it. If that work is close, this is not worth chasing; if it is not, the azimuth check above is
cheap. Either way, capture the broken picture first and work back from it.
