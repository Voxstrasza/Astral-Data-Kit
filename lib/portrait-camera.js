'use strict';

/*
 * The camera the game frames a unit portrait with.
 *
 * Almost no unit has a portrait image. `SetPortraitTexture` renders the unit live each frame, and
 * the framing it uses - the three-quarter head shot everyone recognises - is not a rule in the UI
 * code but a camera stored inside the model file itself. Every playable race and nearly every
 * creature carries one, hand-placed by an artist, which is why a murloc, a dragon and a human all
 * read correctly at the same portrait size.
 *
 * The exception is `CreatureDisplayInfo.PortraitTextureName`, which 138 displays fill in with an
 * icon name. Those are drawn as that icon and never rendered - which is how a creature built on a
 * deliberately invisible model still shows something. Where it is set it is the exact answer and
 * beats anything a camera could produce, so it is checked first.
 *
 * That means the app never has to ask a user to aim anything: the answer already exists in the
 * client they pointed us at. The chain is entirely offline.
 *
 *   CreatureDisplayInfo.dbc   display id -> ModelID
 *   CreatureModelData.dbc     id         -> model path (stored .mdx, shipped .m2)
 *   the M2 itself             camera type 0
 *
 * Cameras come in two types: 0 is the portrait, 1 is the character-info framing used by the
 * dressing room and character sheet. A creature that never appears in a character sheet carries
 * only type 0. Both are read here so a caller can pick; the portrait is the default.
 */

const { Dbc } = require('./wow/dbc');

/* M2 header (MD20 version 264). Counts are followed by their offset, so each is 8 bytes. */
const HEADER = {
    vertices: 0x3c,
    vertexBox: 0xa0,
    nCameras: 0x110
};

/* A vertex is 48 bytes: position, bone weights and indices, normal, two texture coordinates. */
const VERTEX_SIZE = 48;

/*
 * One camera record, 100 bytes. The position and target are each an animation track followed by
 * the static value the track falls back to, so the base vec3 sits 20 bytes into its own block.
 */
const CAMERA_SIZE = 100;
const CAMERA = {
    type: 0,
    fov: 4,
    farClip: 8,
    nearClip: 12,
    positionBase: 36,
    targetBase: 68
};

/*
 * CreatureDisplayInfo.PortraitTextureName. After the id, model, sound and extended-info columns,
 * the model scale and alpha, and the three texture variations.
 */
const PORTRAIT_TEXTURE_FIELD = 9;

const TYPE_PORTRAIT = 0;
const TYPE_CHARACTER_INFO = 1;

const vec3 = (buf, at) => [buf.readFloatLE(at), buf.readFloatLE(at + 4), buf.readFloatLE(at + 8)];

/**
 * A model's cameras, expressed the way an orbit viewer wants them.
 *
 * The eye and target are absolute points in model space; what a viewer needs is where the eye sits
 * *relative* to what it is looking at. Distance, yaw and pitch are that same offset in spherical
 * form, and are what actually survive being moved onto a differently-scaled copy of the model -
 * the angles are scale-free and only the distance has to be adjusted.
 */
function readCameras(buf)
{
    if (!buf || buf.length < 0x140 || buf.toString('ascii', 0, 4) !== 'MD20')
    {
        return [];
    }

    const count = buf.readUInt32LE(HEADER.nCameras);
    const offset = buf.readUInt32LE(HEADER.nCameras + 4);
    const out = [];

    for (let i = 0; i < count; i++)
    {
        const at = offset + i * CAMERA_SIZE;

        if (at < 0 || at + CAMERA_SIZE > buf.length)
        {
            continue;
        }

        const eye = vec3(buf, at + CAMERA.positionBase);
        const target = vec3(buf, at + CAMERA.targetBase);
        const dx = eye[0] - target[0];
        const dy = eye[1] - target[1];
        const dz = eye[2] - target[2];
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (!(distance > 0) || !Number.isFinite(distance))
        {
            continue;
        }

        out.push({
            type: buf.readUInt32LE(at + CAMERA.type),
            fov: buf.readFloatLE(at + CAMERA.fov),
            nearClip: buf.readFloatLE(at + CAMERA.nearClip),
            farClip: buf.readFloatLE(at + CAMERA.farClip),
            eye,
            target,
            distance,
            yaw: Math.atan2(dy, dx),
            pitch: Math.asin(dz / distance)
        });
    }

    return out;
}

/** The bounding box in the header, which is not the model's size. Kept only for diagnostics. */
function readVertexBox(buf)
{
    if (!buf || buf.length < HEADER.vertexBox + 24)
    {
        return null;
    }

    return { min: vec3(buf, HEADER.vertexBox), max: vec3(buf, HEADER.vertexBox + 12) };
}

/**
 * How big the model actually is, measured from its vertices.
 *
 * The header carries a bounding box and it is the wrong one to reach for: HumanMale's says the
 * model is 4.25 tall and starts below the floor, while its vertices span 0 to 2.13. It bounds
 * something else - every geoset the file can draw, in whatever poses the animations reach - and
 * using it put the portrait camera in the middle of the model's chest. Walking 5,000 vertices
 * takes a millisecond and gives the real answer, so that is what is done.
 *
 * This is the number the whole scale calibration hangs off: the viewer draws a converted copy of
 * the model, and the ratio of its height to this one is how far the M2's distances have to be
 * stretched to mean the same thing there.
 */
function readGeometryBox(buf)
{
    if (!buf || buf.length < HEADER.vertices + 8)
    {
        return null;
    }

    const count = buf.readUInt32LE(HEADER.vertices);
    const offset = buf.readUInt32LE(HEADER.vertices + 4);

    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];

    for (let i = 0; i < count; i++)
    {
        const at = offset + i * VERTEX_SIZE;

        if (at < 0 || at + 12 > buf.length)
        {
            break;
        }

        for (let axis = 0; axis < 3; axis++)
        {
            const v = buf.readFloatLE(at + axis * 4);

            if (v < min[axis]) { min[axis] = v; }
            if (v > max[axis]) { max[axis] = v; }
        }
    }

    if (!Number.isFinite(min[2]) || !Number.isFinite(max[2]))
    {
        return null;
    }

    return { min, max, size: max.map((v, i) => v - min[i]) };
}

/**
 * Resolves display ids to models, and models to their cameras.
 *
 * The two DBC tables are read once and indexed on first use rather than at startup: a client with
 * no portrait ever requested should not pay for them. `ClientAssets`' index deliberately covers
 * only Interface, Fonts and DBFilesClient, so the M2s themselves are read straight out of the
 * archives.
 */
class PortraitCameras
{
    constructor(assets)
    {
        this.assets = assets;
        this.modelPathById = null;
        this.modelIdByDisplay = null;
        this.modelById = null;
        this.displayScaleById = null;
        this.portraitIconByDisplay = null;
        this.cache = new Map();
        this.error = null;
    }

    /** Forgets everything, for when the client path changes underneath us. */
    reset()
    {
        this.modelPathById = null;
        this.modelIdByDisplay = null;
        this.modelById = null;
        this.displayScaleById = null;
        this.portraitIconByDisplay = null;
        this.cache.clear();
        this.error = null;
    }

    /*
     * CreatureModelData columns. Only the id and the path were used at first, and the model's size
     * was worked out by walking every vertex in the M2 - which over-measured any model carrying
     * geometry the client does not draw, by 12% on an Arakkoa and 22% on a proto-drake. Those were
     * exactly the two models whose portraits came out wrong.
     *
     * Fields 17-22 are the client's own bounding box for the model. Using it makes the scale
     * derived at runtime agree with the DBC scale below, which walking vertices did not.
     */
    static get FIELDS()
    {
        return { id: 0, path: 2, modelScale: 4, geoBox: 17 };
    }

    index()
    {
        if (this.modelPathById || this.error)
        {
            return !this.error;
        }

        try
        {
            const displayInfo = new Dbc(
                this.assets.readEntry('DBFilesClient\\CreatureDisplayInfo.dbc'),
                'CreatureDisplayInfo.dbc');
            const modelData = new Dbc(
                this.assets.readEntry('DBFilesClient\\CreatureModelData.dbc'),
                'CreatureModelData.dbc');

            const F = PortraitCameras.FIELDS;

            this.modelPathById = new Map();
            this.modelById = new Map();

            for (let i = 0; i < modelData.recordCount; i++)
            {
                const id = modelData.int(i, F.id);

                this.modelPathById.set(id, modelData.string(i, F.path));

                // The box is six floats: min x,y,z then max x,y,z.
                const box = [];

                for (let axis = 0; axis < 6; axis++)
                {
                    box.push(modelData.float(i, F.geoBox + axis));
                }

                this.modelById.set(id, {
                    scale: modelData.float(i, F.modelScale),
                    geoBox: {
                        min: box.slice(0, 3),
                        max: box.slice(3),
                        size: [box[3] - box[0], box[4] - box[1], box[5] - box[2]]
                    }
                });
            }

            this.modelIdByDisplay = new Map();
            this.displayScaleById = new Map();
            this.portraitIconByDisplay = new Map();

            for (let i = 0; i < displayInfo.recordCount; i++)
            {
                const id = displayInfo.int(i, 0);

                this.modelIdByDisplay.set(id, displayInfo.int(i, 1));
                this.displayScaleById.set(id, displayInfo.float(i, 4));

                /*
                 * PortraitTextureName. 138 displays name an icon here, and the client draws that
                 * instead of rendering anything - which is how a creature whose model is
                 * deliberately invisible still gets a portrait. Every one of them resolves to an
                 * icon the client ships, so this is an exact answer where it is present.
                 */
                const icon = displayInfo.string(i, PORTRAIT_TEXTURE_FIELD);

                if (icon && /^[\x20-\x7e]{3,}$/.test(icon) && /[a-zA-Z]/.test(icon))
                {
                    this.portraitIconByDisplay.set(id, icon);
                }
            }
        }
        catch (err)
        {
            this.error = err.message;
            this.modelPathById = null;

            return false;
        }

        return true;
    }

    /** The .m2 path the client would draw for a display id, or null. */
    modelPath(displayId)
    {
        if (!this.index())
        {
            return null;
        }

        const modelId = this.modelIdByDisplay.get(Number(displayId));

        if (modelId === undefined)
        {
            return null;
        }

        const stored = this.modelPathById.get(modelId) || '';

        // The tables name every model .mdx, which is the pre-Wrath container; what ships is .m2.
        return stored ? stored.replace(/\.(mdx|mdl)$/i, '.m2') : null;
    }

    /**
     * Everything known about how to frame a display id.
     *
     * Returns `{ path, cameras, portrait, characterInfo, box }`, or an object carrying `reason`
     * when the chain stops - a display id the client does not know, a model the archives do not
     * hold, or a model whose artist gave it no camera at all. Each of those wants a different
     * message, so they are distinguished rather than collapsed into null.
     */
    forDisplayId(displayId)
    {
        const id = Number(displayId) || 0;

        if (this.cache.has(id))
        {
            return this.cache.get(id);
        }

        const result = this.resolve(id);
        this.cache.set(id, result);

        return result;
    }

    resolve(id)
    {
        if (!id)
        {
            return { reason: 'no display id' };
        }

        if (!this.index())
        {
            return { reason: this.error || 'client tables unavailable' };
        }

        const portraitIcon = this.portraitIconByDisplay.get(id) || null;

        const modelFile = this.modelPath(id);

        if (!modelFile)
        {
            return { portraitIcon, reason: `display ${id} is not in CreatureDisplayInfo` };
        }

        const buf = this.assets.readAnywhere(modelFile);

        if (!buf || !buf.length)
        {
            return { path: modelFile, reason: `${modelFile} is not in the client archives` };
        }

        const cameras = readCameras(buf);
        const portrait = cameras.find((camera) => camera.type === TYPE_PORTRAIT) || null;
        const model = this.modelById.get(this.modelIdByDisplay.get(id)) || null;
        const displayScale = this.displayScaleById.get(id) || 1;

        return {
            path: modelFile,
            portraitIcon,

            // The client's own box, which is what the runtime scale is measured against.
            box: model ? model.geoBox : readGeometryBox(buf),

            /*
             * What the client would scale this display by. Sent for comparison rather than used
             * directly: the viewer draws its own converted copy and need not have applied exactly
             * this, so the runtime measurement stays the source of truth and this says whether to
             * believe it.
             */
            dbcScale: displayScale * (model ? model.scale : 1),

            // Kept alongside, because a large gap between the two is the signature of a model
            // carrying geometry that is never drawn.
            geometryBox: readGeometryBox(buf),
            cameras,
            portrait,
            characterInfo: cameras.find((camera) => camera.type === TYPE_CHARACTER_INFO) || null,
            reason: portrait ? null : `${modelFile} carries no portrait camera`
        };
    }
}

module.exports = {
    PortraitCameras,
    readCameras,
    readVertexBox,
    readGeometryBox,
    TYPE_PORTRAIT,
    TYPE_CHARACTER_INFO
};
