'use strict';

/*
 * Helms that take the wearer's face with them.
 *
 * A head item carries HideGeosetMale / HideGeosetFemale: the parts of the wearer it removes to
 * make room for itself. The viewer reads a listed group as "draw nothing from that group" — and
 * that is where this goes wrong, because in several of those groups the plainest option is a
 * piece of the head rather than the absence of one. The character customization data says so:
 *
 *   option 11 "Hair Style"   → choice 17184 "Bald"  → Geoset { GeosetType: 0, GeosetID: 1 }
 *                              choice 17190 "Loose" → Geoset { GeosetType: 0, GeosetID: 7 }
 *   option 13 "Facial Hair"  → choice 17214 "Clean" → Geosets 1/1, 2/1, 3/1
 *                              choice 17209 "Goatee"→ Geosets 1/2, 2/2, 3/1
 *
 * Bald is the scalp and Clean is the bare jaw, chin and upper lip. Delete those groups and the
 * head loses its crown and the strip of face under the nose — the hole Orbaz Bloodbane
 * (display 27562) shows through his open-faced helm.
 *
 * So this does what the client does: a head item that hides the hair gets the wearer switched to
 * Bald, one that hides the facial groups gets them switched to Clean, and those hides are then
 * dropped so the plain geometry underneath survives. Simply keeping the hair was tried first and
 * is worse — the head comes back but the hair pushes through the helm.
 *
 * **Only for what the item actually hides**, which is the part this got wrong at first. Wearing
 * something on the head was taken as reason enough, so every human NPC in a mask, a circlet or a
 * bandana came out bald — Edwin VanCleef most visibly, since his red mask hides the facial groups
 * and leaves the hair alone. The item names the groups it takes, per race and gender, and that is
 * what decides it now.
 *
 * Ears are left alone deliberately. Group 7 is a pair of ears standing off a skull that is closed
 * underneath them, so a helm taking them leaves a head rather than a gap.
 */

/** Where the customization data lives, keyed by the model id the NPC's Character block names. */
const customizationPath = (modelId) => `meta/charactercustomization/${modelId}.json`;

/** Where a head item lives. Slot 1 is the head, and the id is the item's display, not its entry. */
const headItemPath = (itemDisplayId) => `meta/armor/1/${itemDisplayId}.json`;

/**
 * The customization options whose plainest choice is geometry, and the groups they cover.
 *
 * `plain` names the choice to fall back to. It is matched by name first because the data names it,
 * and by lowest geoset second — the plain option is geoset 1 of each of its groups, which is what
 * makes "lowest" the right tie-break rather than a guess.
 */
const NEUTRAL = [
    { option: 'hair style', groups: [0], plain: ['bald'] },
    { option: 'facial hair', groups: [1, 2, 3], plain: ['clean', 'clean shaven', 'none'] }
];

/** Every group whose plain geometry has to survive its item's hide list. */
const KEPT_GROUPS = NEUTRAL.flatMap((entry) => entry.groups);

/**
 * Which geoset groups a head item takes from this wearer.
 *
 * The hide list is per race and per gender: Orbaz Bloodbane's helm names groups 0, 1, 2, 3 and 7
 * for every race, while VanCleef's mask names only the facial ones. A list with no entry for the
 * wearer's race is read whole rather than treated as empty, since an item is free to describe
 * itself once for everyone.
 */
function hiddenGroups(item, race, gender)
{
    const key = gender === 1 ? 'HideGeosetFemale' : 'HideGeosetMale';
    const all = item && item.Item && Array.isArray(item.Item[key]) ? item.Item[key] : [];
    const mine = all.filter((hide) => hide.RaceId === race);

    return new Set((mine.length ? mine : all).map((hide) => hide.GeosetGroup));
}

/**
 * Finds the choice that means "nothing here" for one option of a model.
 *
 * By name first, since the data names it, and by the lowest geoset in the option as a fallback —
 * the plain choice is the first of them, and a model with no such choice returns nothing rather
 * than a guess.
 */
function findPlainChoice(customization, spec)
{
    if (!customization || !Array.isArray(customization.Options))
    {
        return null;
    }

    const option = customization.Options.find(
        (entry) => String(entry.Name).toLowerCase() === spec.option);

    if (!option || !Array.isArray(option.Choices) || !option.Choices.length)
    {
        return null;
    }

    const named = option.Choices.find(
        (choice) => spec.plain.includes(String(choice.Name).toLowerCase()));

    if (named)
    {
        return { optionId: option.Id, choiceId: named.Id };
    }

    /*
     * Failing a name, the choice whose geosets are lowest across the option's groups. Summed
     * rather than compared one group at a time, so a choice that is plainest overall wins even
     * where the groups disagree.
     */
    const weightOf = (choice) =>
    {
        const ids = (choice.Elements || [])
            .filter((element) => element.Geoset && spec.groups.includes(element.Geoset.GeosetType))
            .map((element) => element.Geoset.GeosetID);

        return ids.length ? ids.reduce((total, id) => total + id, 0) : Number.MAX_SAFE_INTEGER;
    };

    const lowest = [...option.Choices].sort((a, b) => weightOf(a) - weightOf(b))[0];

    return lowest ? { optionId: option.Id, choiceId: lowest.Id } : null;
}

/**
 * Gives a helmed creature the plain scalp and jaw in place of whatever it was wearing on them.
 *
 * `fetchJson` takes a content path and returns the parsed JSON, so this stays independent of how
 * the caller talks to the remote host. Returns the buffer untouched whenever there is nothing to
 * do — no head item, one that hides nothing this cares about, no character behind the display, or
 * no plain choice to move to.
 */
async function plainUnderHelm(buffer, fetchJson)
{
    const data = JSON.parse(buffer.toString('utf8'));

    // No head item means nothing is being hidden, so nothing here applies.
    if (!data || !data.Equipment || !data.Equipment['1'])
    {
        return buffer;
    }

    const character = data.Character;

    if (!character || !Array.isArray(data.Creature && data.Creature.CreatureCustomizations))
    {
        return buffer;
    }

    // What the head item actually takes decides this, not the fact that there is one.
    const head = await fetchJson(headItemPath(data.Equipment['1']));
    const hidden = hiddenGroups(head, character.Race, character.Gender);
    const wanted = NEUTRAL.filter((spec) => spec.groups.some((group) => hidden.has(group)));

    if (!wanted.length)
    {
        return buffer;
    }

    const modelId = character.ChrModelId || character.Race;
    const customization = await fetchJson(customizationPath(modelId));

    let changed = false;

    for (const spec of wanted)
    {
        const plain = findPlainChoice(customization, spec);
        const entry = plain
            && data.Creature.CreatureCustomizations.find((c) => c.optionId === plain.optionId);

        if (!entry || entry.choiceId === plain.choiceId)
        {
            continue;
        }

        entry.choiceId = plain.choiceId;
        changed = true;
    }

    return changed ? Buffer.from(JSON.stringify(data)) : buffer;
}

/** Drops a head item's instruction to remove a group whose plain geometry is part of the head. */
function keepPlainFace(buffer)
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

        const kept = data.Item[key].filter((hide) => !KEPT_GROUPS.includes(hide.GeosetGroup));

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
            return await plainUnderHelm(buffer, fetchJson);
        }

        if (target.startsWith('meta/armor/1/') && target.endsWith('.json'))
        {
            return keepPlainFace(buffer);
        }
    }
    catch
    {
        // Not the JSON it claimed to be, or the customization could not be read.
    }

    return buffer;
}

module.exports = { rewrite, findPlainChoice, keepPlainFace, hiddenGroups };
