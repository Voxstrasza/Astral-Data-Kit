'use strict';

/*
 * The only bridge between the page and Node. Everything else the renderer needs goes through the
 * app:// data API, so this stays limited to things a web page genuinely cannot do: opening a
 * native folder picker, and knowing it is running inside the desktop shell.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('astral', {
    isDesktop: true,
    chooseClientFolder: () => ipcRenderer.invoke('choose-client-folder')
});
