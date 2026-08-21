'use strict';

/* The data API, served by lib/routes.js behind both the Electron app:// scheme and server.js. */

async function api(path, options)
{
    const response = await fetch(path, options);

    if (!response.ok)
    {
        throw new Error(`${path} -> ${response.status}`);
    }

    return response.json();
}

const postJson = (path, value) => api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(value)
});

export { api, postJson };
