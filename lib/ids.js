'use strict';

/*
 * Ids for the things the app stores.
 *
 * Ids are generated here rather than by the page, so two windows cannot mint the same one — which
 * only holds if there is one counter. Raids and saved work each grew their own copy of this pair
 * first, and two counters is two sequences that can collide inside the same millisecond.
 */

let counter = 0;

/** `prefix-<time>-<counter>`: sortable enough to read, unique because of the counter. */
function newId(prefix)
{
    counter += 1;

    return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

/**
 * A file name that is only ever an id.
 *
 * Ids are generated above and never typed, but they arrive over HTTP, so anything that could climb
 * out of the folder is refused rather than escaped — the same rule lib/custom-icons.js applies to
 * icon names.
 */
function safeId(value)
{
    const id = String(value || '');

    return /^[a-z0-9-]{1,64}$/i.test(id) ? id : '';
}

module.exports = { newId, safeId };
