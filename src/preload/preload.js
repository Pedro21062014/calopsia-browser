'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// ── Expose a safe, typed API to the renderer ──────────────────────────────────
contextBridge.exposeInMainWorld('calopsia', {
  // Navigation
  navigate:    (id, url)          => ipcRenderer.send('navigate',    { id, url }),
  goBack:      (id)               => ipcRenderer.send('go-back',     { id }),
  goForward:   (id)               => ipcRenderer.send('go-forward',  { id }),
  reload:      (id)               => ipcRenderer.send('reload',      { id }),
  stop:        (id)               => ipcRenderer.send('stop',        { id }),

  // Tabs
  newTab:      (url)              => ipcRenderer.send('new-tab',     { url }),
  closeTab:    (id)               => ipcRenderer.send('close-tab',   { id }),
  activateTab: (id)               => ipcRenderer.send('activate-tab',{ id }),

  // Window controls
  minimize:    ()                 => ipcRenderer.send('window-minimize'),
  maximize:    ()                 => ipcRenderer.send('window-maximize'),
  closeWindow: ()                 => ipcRenderer.send('window-close'),

  // DevTools / Page
  openDevTools: ()                => ipcRenderer.send('open-devtools'),
  zoomIn:      ()                 => ipcRenderer.send('zoom-in'),
  zoomOut:     ()                 => ipcRenderer.send('zoom-out'),
  zoomReset:   ()                 => ipcRenderer.send('zoom-reset'),
  printPage:   ()                 => ipcRenderer.send('print-page'),
  savePage:    ()                 => ipcRenderer.send('save-page'),
  findInPage:  (text)             => ipcRenderer.send('find-in-page', { text }),
  stopFind:    ()                 => ipcRenderer.send('stop-find'),

  // Bookmarks
  getBookmarks:    ()             => ipcRenderer.invoke('get-bookmarks'),
  addBookmark:     (url, title)   => ipcRenderer.send('add-bookmark', { url, title }),
  removeBookmark:  (url)          => ipcRenderer.send('remove-bookmark', { url }),

  // History
  getHistory:      ()             => ipcRenderer.invoke('get-history'),
  clearHistory:    ()             => ipcRenderer.send('clear-history'),

  // Downloads
  getDownloads:    ()             => ipcRenderer.invoke('get-downloads'),

  // Settings
  getStore:    (key)              => ipcRenderer.invoke('get-store', key),
  setStore:    (key, value)       => ipcRenderer.send('set-store', { key, value }),
  toggleAdblock: (enabled)        => ipcRenderer.send('toggle-adblock', { enabled }),

  // Events from main → renderer
  on: (channel, fn) => {
    const allowed = [
      'tab-created','tab-updated','tab-activated','tab-closed','tab-navigated',
      'open-settings','open-history','open-bookmarks','bookmark-current',
      'toggle-find','bookmarks-updated','history-cleared',
      'download-started','download-updated','download-done',
    ];
    if (allowed.includes(channel)) ipcRenderer.on(channel, (_, data) => fn(data));
  },
  off: (channel, fn) => ipcRenderer.removeListener(channel, fn),
});
