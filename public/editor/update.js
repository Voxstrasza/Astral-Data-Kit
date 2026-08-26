'use strict';

/*
 * The update notice: a bubble under the logo when a newer release is published.
 *
 * Once per run. Closing it closes it for this run and nothing is written down, so opening the
 * program tomorrow says it again — which is the point. A notice that remembers being dismissed is
 * a notice most people will only ever see once, and the release it was about is the one thing they
 * would want reminding of.
 *
 * There is nothing to do about it inside the program, so the bubble does not offer anything: it
 * says what happened, links to where the download is, and gets out of the way.
 */

import { $ } from './dom.js';
import { api } from './api.js';

async function bindUpdateNotice()
{
    const bubble = $('#update-bubble');
    const close = $('#btn-update-dismiss');

    if (!bubble || !close)
    {
        return;
    }

    let result = null;

    try
    {
        result = await api('api/update');
    }
    catch
    {
        /* Offline, or GitHub is not answering. Neither is the user's problem. */
        return;
    }

    if (!result || !result.available)
    {
        return;
    }

    close.addEventListener('click', () => { bubble.hidden = true; });

    bubble.hidden = false;
}

export { bindUpdateNotice };
