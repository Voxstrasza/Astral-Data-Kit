'use strict';

/*
 * The creatures that make up a multi-boss encounter.
 *
 * Nothing in the client or the database records this. `instance_encounters` gives one credited
 * creature per encounter, so the Northrend Beasts resolve to Icehowl alone and the Blood Council
 * to Prince Valanar alone — true, and useless if you wanted Gormok or Keleseth.
 *
 * Detecting it was tried first and only half works. Creatures sharing one script name are a
 * genuine group, which finds the Four Horsemen exactly, but Ulduar's Iron Council is three
 * separately scripted bosses and looks identical to three unrelated ones. Widening the rule to
 * "unclaimed bosses on the map" put Sister Svalna in the Icecrown gunship crew.
 *
 * So the groups are written down. Every entry id below was read out of creature_template rather
 * than remembered, which matters more than it sounds: three of these encounters have same-named
 * creatures elsewhere in the game, and Blood Council in particular would otherwise pick up the
 * Prince Keleseth from Utgarde Keep and the Prince Taldaram from Ahn'kahet.
 */

const MEMBERS = {
    /* Naxxramas */
    '533|thefourhorsemen': [30549, 16065, 16063, 16064],

    /* Ulduar */
    '603|theironcouncil': [32867, 32927, 32857],
    '603|kologarn': [32930, 32934, 32933],
    '603|xt002deconstructor': [33293, 33329],

    /* Trial of the Crusader */
    '649|northrendbeasts': [34796, 35144, 34799, 34797],
    '649|valkyrtwins': [34497, 34496],
    '649|factionchampions': [
        // Alliance
        34461, 34460, 34469, 34467, 34468, 34471, 34466, 34473, 34472, 34470, 34463, 34474, 34475,
        // Horde
        34458, 34451, 34459, 34448, 34449, 34445, 34456, 34447, 34454, 34455, 34444, 34450, 34453
    ],

    /*
     * Violet Hold — the six prisoners, of which a run picks two at random. The DBC lists them as
     * "First Prisoner" and "Second Prisoner" for that reason, which names no one; one row with
     * the whole pool behind it is what the instance actually offers.
     */
    '608|firstprisoner': [29315, 29316, 29313, 29266, 29312, 29314],

    /* Karazhan — the two kings of the chess event. */
    '532|chessevent': [21684, 21752],

    /* Icecrown Citadel — the ICC princes, not the same-named ones in Utgarde Keep and Ahn'kahet. */
    '631|bloodcouncil': [37972, 37973, 37970],
    '631|icecrowngunshipbattle': [36948, 36939]
};

/*
 * Encounters whose DBC title is simply the wrong way round. Kept beside the member lists because
 * they are the same kind of fact about the same encounters.
 */
const RENAMES = {
    "649|valkyrtwins": "Twin Val'kyr",
    '631|bloodcouncil': 'Blood Prince Council',
    '608|firstprisoner': 'Prisoners'
};

/*
 * Encounters folded into another row and therefore not listed on their own. "Second Prisoner" is
 * the same random pool as the first, so it would repeat the list rather than add to it.
 */
const SUPPRESSED = new Set(['608|secondprisoner']);

function isSuppressed(mapId, name)
{
    return SUPPRESSED.has(keyFor(mapId, name));
}

/** Case and punctuation removed, so a key is stable against the DBC's own inconsistencies. */
const normalizeName = (name) => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '');

const keyFor = (mapId, name) => `${mapId}|${normalizeName(name)}`;

function membersFor(mapId, name)
{
    return MEMBERS[keyFor(mapId, name)] || null;
}

function renameFor(mapId, name)
{
    return RENAMES[keyFor(mapId, name)] || null;
}

module.exports = { MEMBERS, RENAMES, SUPPRESSED, membersFor, renameFor, isSuppressed, normalizeName, keyFor };
