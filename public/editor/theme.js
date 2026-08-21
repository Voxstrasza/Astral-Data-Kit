'use strict';

/*
 * Light / dark / midnight, chosen in Settings.
 *
 * The choice lives in localStorage rather than the settings file: it is a property of this
 * window, it has to be readable before the first paint, and routing it through the settings API
 * would mean a round trip on every launch. A small script in index.html applies the stored value
 * as `data-theme` on <html> before the stylesheet paints, so the window never flashes the wrong
 * palette; everything here is the picker that writes it.
 */

import { $, $$ } from './dom.js';

const KEY = 'astral-theme';
const THEMES = ['light', 'dark', 'midnight'];
const FALLBACK = 'dark';

function current()
{
    const stored = read();
    return THEMES.includes(stored) ? stored : FALLBACK;
}

function read()
{
    try
    {
        return localStorage.getItem(KEY);
    }
    catch
    {
        // Private-mode or a locked-down profile: the theme just stops persisting.
        return null;
    }
}

function apply(theme)
{
    const chosen = THEMES.includes(theme) ? theme : FALLBACK;

    document.documentElement.dataset.theme = chosen;

    try
    {
        localStorage.setItem(KEY, chosen);
    }
    catch
    {
        // Not fatal — the theme still applies for this session.
    }

    for (const button of $$('[data-theme-choice]'))
    {
        button.classList.toggle('active', button.dataset.themeChoice === chosen);
    }
}

function bindTheme()
{
    const host = $('#theme-picker');

    if (!host)
    {
        return;
    }

    for (const button of $$('[data-theme-choice]'))
    {
        button.addEventListener('click', () => apply(button.dataset.themeChoice));
    }

    // The attribute is already set by the pre-paint script; this syncs the buttons to it.
    apply(current());
}

export { bindTheme, apply, current, THEMES };
