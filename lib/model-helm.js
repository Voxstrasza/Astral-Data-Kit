'use strict';

/*
 * Helms that take the wearer's head with them.
 *
 * A head item carries HideGeosetMale / HideGeosetFemale: the parts of the wearer it removes to
 * make room for itself. For a helm that list includes geoset group 0, and the viewer reads that as
 * "draw nothing from group 0" — but group 0 is not only the hair. The character customization data
 * says so plainly:
 *
 *   option 11 "Hair Style" → choice 17184 "Bald"    → Geoset { GeosetType: 0, GeosetID: 1 }
 *                            choice 17185 "Peasant" → Geoset { GeosetType: 0, GeosetID: 2 }
 *
 * Bald is a geoset in that group, not the absence of one — it is the scalp. Delete the group and
 * the head loses its crown, which is the hole Orbaz Bloodbane (display 27562) shows under his
 * open-faced helm.
 *
 * So this does what the client does: a helm that hides the hair gets the wearer switched to Bald,
 * and the group-0 hide is dropped so the scalp survives. Simply keeping the hair was tried first
 * and is worse — the head comes back but the hair pushes through the helm.
 *
 * Nothing else in the hide list is touched. Facial hair and ears are additive, so hiding them
 * leaves a face rather than a gap, exactly as it should.
 */

/** Where the customization data lives, keyed by the model id the NPC's Character block names. */
const customizationPath = (modelId) => `meta/charactercustomization/${modelId}.json`;

/** The geoset group whose absence costs the wearer a scalp. */
const HAIR_GROUP = 0;

/**
 * Finds the choice that means "no hair" for a model.
 *
 * By name first, since the data names it, and by the lowest geoset in the hair option as a
 * fallback — bald is the first of them, and a model with no such choice returns nothing rather
 * than a guess.
 */
function findBaldChoice(customization)
{
    if (!customization || !Array.isArray(customization.Options))
    {
        return null;
    }

    const hairOptionId = customization.HairStyleOptionId;

    const option = customization.Options.find((entry) => entry.Id === hairOptionId)
        || customization.Options.find((entry) => String(entry.Name).toLowerCase() === 'hair style');

    if (!option || !Array.isArray(option.Choices) || !option.Choices.length)
    {
        return null;
    }

    const named = option.Choices.find((choice) => String(choice.Name).toLowerCase() === 'bald');

    if (named)
    {
        return { optionId: option.Id, choiceId: named.Id };
    }

    const geosetOf = (choice) =>
    {
        const element = (choice.Elements || []).find((e) => e.Geoset && e.Geoset.GeosetType === HAIR_GROUP);
        return element ? element.Geoset.GeosetID : Number.MAX_SAFE_INTEGER;
    };

    const lowest = [...option.Choices].sort((a, b) => geosetOf(a) - geosetOf(b))[0];

    return lowest ? { optionId: option.Id, choiceId: lowest.Id } : null;
}

/**
 * Gives a helmed creature the bald scalp in place of whatever hair it was wearing.
 *
 * `fetchJson` takes a content path and returns the parsed JSON, so this stays independent of how
 * the caller talks to the remote host. Returns the buffer untouched whenever there is nothing to
 * do — no helm, no character behind the display, or no bald choice to move to.
 */
async function baldUnderHelm(buffer, fetchJson)
{
    const data = JSON.parse(buffer.toString('utf8'));

    // No head item means no hidden hair, so nothing here applies.
    if (!data || !data.Equipment || data.Equipment['1'] === undefined)
    {
        return buffer;
    }

    const character = data.Character;

    if (!character || !Array.isArray(data.Creature && data.Creature.CreatureCustomizations))
    {
        return buffer;
    }

    const modelId = character.ChrModelId || character.Race;
    const customization = await fetchJson(customizationPath(modelId));
    const bald = findBaldChoice(customization);

    if (!bald)
    {
        return buffer;
    }

    const entry = data.Creature.CreatureCustomizations.find((c) => c.optionId === bald.optionId);

    if (!entry || entry.choiceId === bald.choiceId)
    {
        return buffer;
    }

    entry.choiceId = bald.choiceId;

    return Buffer.from(JSON.stringify(data));
}

/** Drops a head item's instruction to remove the hair group, so the scalp under it survives. */
function keepScalp(buffer)
{
    const data = JSON.parse(buffer.toString('utf8'));

    if (!data || !data.Item)
    {
        return buffer;
    }

    let changed = false;

    for (const key of ['HideGeosetMale', 'HideGeosetFemale'])
    {
        if (!Array.isArray(data.Item[key]))
        {
            continue;
        }

        const kept = data.Item[key].filter((hide) => hide.GeosetGroup !== HAIR_GROUP);

        if (kept.length !== data.Item[key].length)
        {
            data.Item[key] = kept;
            changed = true;
        }
    }

    return changed ? Buffer.from(JSON.stringify(data)) : buffer;
}

/**
 * The one entry point: hands back whatever should be served for this path.
 *
 * Anything that is not an NPC description or a head item, and anything that does not parse, comes
 * straight back out — a rewrite that cannot be made is not a failure, it is simply not needed.
 */
async function rewrite(target, buffer, fetchJson)
{
    try
    {
        if (target.startsWith('meta/npc/') && target.endsWith('.json'))
        {
            return await baldUnderHelm(buffer, fetchJson);
        }

        if (target.startsWith('meta/armor/1/') && target.endsWith('.json'))
        {
            return keepScalp(buffer);
        }
    }
    catch
    {
        // Not the JSON it claimed to be, or the customization could not be read.
    }

    return buffer;
}

module.exports = { rewrite, findBaldChoice, keepScalp };
