'use strict';

const {
  app,
  BrowserWindow,
  BrowserView,
  ipcMain,
  Menu,
  shell,
  session,
  nativeTheme,
  dialog,
  globalShortcut,
  Notification,
} = require('electron');
const path = require('path');
const Store = require('electron-store');

// ─── Constants ────────────────────────────────────────────────────────────────
const IS_DEV  = process.argv.includes('--dev');
const PRELOAD = path.join(__dirname, '../preload/preload.js');

// ─── Persistent storage ───────────────────────────────────────────────────────
const store = new Store({
  defaults: {
    windowBounds: { width: 1280, height: 800 },
    theme: 'dark',
    homepage: 'https://www.google.com',
    searchEngine: 'https://www.google.com/search?q=',
    bookmarks: [],
    history: [],
    downloads: [],
    tabs: [],
    adblock: true,
  },
});

// ─── State ────────────────────────────────────────────────────────────────────
let mainWindow   = null;
let tabs         = [];   // { id, view, title, url, favicon, loading }
let activeTabId  = null;
let tabIdCounter = 0;

// ─── Ad-block / tracker list (lightweight) ────────────────────────────────────
const AD_PATTERNS = [
  /doubleclick\.net/,
  /googlesyndication\.com/,
  /googletagmanager\.com/,
  /adservice\.google/,
  /facebook\.net\/en_US\/sdk\.js/,
  /amazon-adsystem\.com/,
  /ads\.twitter\.com/,
  /outbrain\.com/,
  /taboola\.com/,
  /moatads\.com/,
];

function shouldBlockRequest(url) {
  if (!store.get('adblock')) return false;
  return AD_PATTERNS.some(p => p.test(url));
}

// ─── Window creation ──────────────────────────────────────────────────────────
function createWindow() {
  const { width, height } = store.get('windowBounds');

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0d0d0f',
    show: false,
    icon: path.join(__dirname, '../../assets/icons/icon.png'),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open devtools only in dev mode
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
    // Create the first tab
    createTab(store.get('homepage'));
  });

  mainWindow.on('resize', () => {
    const [w, h] = mainWindow.getSize();
    store.set('windowBounds', { width: w, height: h });
    resizeActiveView();
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  // Block ads at the session level
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (shouldBlockRequest(details.url)) {
      callback({ cancel: true });
    } else {
      callback({});
    }
  });

  buildAppMenu();
  registerShortcuts();
}

// ─── Tab geometry ─────────────────────────────────────────────────────────────
const CHROME_HEIGHT = 100; // px – the height of the browser chrome UI

function viewBounds() {
  if (!mainWindow) return null;
  const [w, h] = mainWindow.getContentSize();
  return { x: 0, y: CHROME_HEIGHT, width: w, height: h - CHROME_HEIGHT };
}

function resizeActiveView() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.view && mainWindow) {
    tab.view.setBounds(viewBounds());
  }
}

// ─── Tab management ───────────────────────────────────────────────────────────
function createTab(url = store.get('homepage')) {
  const id   = ++tabIdCounter;
  const view = new BrowserView({
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  mainWindow.addBrowserView(view);
  view.setBounds(viewBounds());
  view.setAutoResize({ width: true, height: true });

  const wc = view.webContents;

  wc.on('page-title-updated', (_, title) => {
    updateTab(id, { title });
    sendToRenderer('tab-updated', { id, title });
  });

  wc.on('page-favicon-updated', (_, favicons) => {
    if (favicons[0]) {
      updateTab(id, { favicon: favicons[0] });
      sendToRenderer('tab-updated', { id, favicon: favicons[0] });
    }
  });

  wc.on('did-start-loading', () => {
    updateTab(id, { loading: true });
    sendToRenderer('tab-updated', { id, loading: true });
  });

  wc.on('did-stop-loading', () => {
    const tabUrl = wc.getURL();
    updateTab(id, { loading: false, url: tabUrl });
    sendToRenderer('tab-updated', { id, loading: false, url: tabUrl });
    addToHistory(tabUrl, wc.getTitle());
  });

  wc.on('did-navigate', (_, url) => {
    updateTab(id, { url });
    sendToRenderer('tab-navigated', { id, url, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
  });

  wc.on('did-navigate-in-page', (_, url) => {
    updateTab(id, { url });
    sendToRenderer('tab-navigated', { id, url, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
  });

  wc.on('new-window', (e, newUrl) => {
    e.preventDefault();
    createTab(newUrl);
  });

  wc.setWindowOpenHandler(({ url: newUrl }) => {
    createTab(newUrl);
    return { action: 'deny' };
  });

  wc.on('will-navigate', (_, navUrl) => {
    updateTab(id, { url: navUrl });
    sendToRenderer('tab-navigated', { id, url: navUrl, canGoBack: wc.canGoBack(), canGoForward: wc.canGoForward() });
  });

  // Download support
  wc.session.on('will-download', (_, item) => {
    handleDownload(item);
  });

  const tabObj = { id, view, title: 'New Tab', url, favicon: null, loading: true };
  tabs.push(tabObj);
  setActiveTab(id);

  wc.loadURL(normalizeUrl(url));
  sendToRenderer('tab-created', { id, title: 'New Tab', url, loading: true });

  return id;
}

function setActiveTab(id) {
  // Hide all views, show the chosen one
  tabs.forEach(t => {
    if (t.view) mainWindow.removeBrowserView(t.view);
  });

  const tab = tabs.find(t => t.id === id);
  if (!tab) return;

  activeTabId = id;
  mainWindow.addBrowserView(tab.view);
  tab.view.setBounds(viewBounds());
  sendToRenderer('tab-activated', { id });

  const wc = tab.view.webContents;
  sendToRenderer('tab-navigated', {
    id,
    url: wc.getURL() || tab.url,
    canGoBack: wc.canGoBack(),
    canGoForward: wc.canGoForward(),
  });
}

function closeTab(id) {
  const idx = tabs.findIndex(t => t.id === id);
  if (idx === -1) return;

  const tab = tabs[idx];
  mainWindow.removeBrowserView(tab.view);
  tab.view.webContents.destroy();

  tabs.splice(idx, 1);
  sendToRenderer('tab-closed', { id });

  if (tabs.length === 0) {
    createTab();
  } else if (activeTabId === id) {
    const next = tabs[Math.min(idx, tabs.length - 1)];
    setActiveTab(next.id);
  }
}

function updateTab(id, data) {
  const tab = tabs.find(t => t.id === id);
  if (tab) Object.assign(tab, data);
}

// ─── URL normalization ────────────────────────────────────────────────────────
function normalizeUrl(input) {
  if (!input || input.trim() === '') return store.get('homepage');
  const s = input.trim();
  if (s === 'about:blank') return s;
  if (/^(https?|file|ftp):\/\//i.test(s)) return s;
  if (/^localhost(:\d+)?/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}/.test(s)) return `http://${s}`;
  if (s.includes('.') && !s.includes(' ')) return `https://${s}`;
  return store.get('searchEngine') + encodeURIComponent(s);
}

// ─── History ──────────────────────────────────────────────────────────────────
function addToHistory(url, title) {
  if (!url || url === 'about:blank' || url.startsWith('devtools://')) return;
  let history = store.get('history');
  history.unshift({ url, title, date: Date.now() });
  if (history.length > 500) history = history.slice(0, 500);
  store.set('history', history);
}

// ─── Downloads ────────────────────────────────────────────────────────────────
function handleDownload(item) {
  const filename = item.getFilename();
  const savePath = path.join(app.getPath('downloads'), filename);
  item.setSavePath(savePath);

  const dlEntry = {
    filename,
    path: savePath,
    url: item.getURL(),
    startTime: Date.now(),
    state: 'progressing',
    received: 0,
    total: item.getTotalBytes(),
  };

  let downloads = store.get('downloads');
  downloads.unshift(dlEntry);
  store.set('downloads', downloads);
  sendToRenderer('download-started', dlEntry);

  item.on('updated', (_, state) => {
    dlEntry.state = state;
    dlEntry.received = item.getReceivedBytes();
    sendToRenderer('download-updated', { filename, state, received: dlEntry.received, total: dlEntry.total });
  });

  item.on('done', (_, state) => {
    dlEntry.state = state;
    dlEntry.endTime = Date.now();
    store.set('downloads', [dlEntry, ...store.get('downloads').slice(1)]);
    sendToRenderer('download-done', { filename, state, path: savePath });
    if (state === 'completed' && Notification.isSupported()) {
      new Notification({ title: 'Calopsia – Download Complete', body: filename }).show();
    }
  });
}

// ─── IPC handlers ─────────────────────────────────────────────────────────────
function sendToRenderer(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

ipcMain.on('navigate', (_, { id, url }) => {
  const tab = tabs.find(t => t.id === (id ?? activeTabId));
  if (tab) tab.view.webContents.loadURL(normalizeUrl(url));
});

ipcMain.on('go-back', (_, { id }) => {
  const tab = tabs.find(t => t.id === (id ?? activeTabId));
  if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
});

ipcMain.on('go-forward', (_, { id }) => {
  const tab = tabs.find(t => t.id === (id ?? activeTabId));
  if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
});

ipcMain.on('reload', (_, { id } = {}) => {
  const tab = tabs.find(t => t.id === (id ?? activeTabId));
  if (tab) tab.view.webContents.reload();
});

ipcMain.on('stop', (_, { id } = {}) => {
  const tab = tabs.find(t => t.id === (id ?? activeTabId));
  if (tab) tab.view.webContents.stop();
});

ipcMain.on('new-tab', (_, { url } = {}) => createTab(url));
ipcMain.on('close-tab', (_, { id }) => closeTab(id));
ipcMain.on('activate-tab', (_, { id }) => setActiveTab(id));

ipcMain.on('window-minimize', () => mainWindow?.minimize());
ipcMain.on('window-maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('window-close',    () => mainWindow?.close());

ipcMain.handle('get-store', (_, key) => store.get(key));
ipcMain.on('set-store',   (_, { key, value }) => store.set(key, value));

ipcMain.handle('get-bookmarks', () => store.get('bookmarks'));
ipcMain.on('add-bookmark', (_, { url, title }) => {
  const bm = store.get('bookmarks');
  if (!bm.find(b => b.url === url)) {
    bm.unshift({ url, title, date: Date.now() });
    store.set('bookmarks', bm);
    sendToRenderer('bookmarks-updated', bm);
  }
});
ipcMain.on('remove-bookmark', (_, { url }) => {
  const bm = store.get('bookmarks').filter(b => b.url !== url);
  store.set('bookmarks', bm);
  sendToRenderer('bookmarks-updated', bm);
});

ipcMain.handle('get-history',   () => store.get('history'));
ipcMain.on('clear-history',     () => { store.set('history', []); sendToRenderer('history-cleared'); });
ipcMain.handle('get-downloads', () => store.get('downloads'));

ipcMain.on('open-devtools', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.view.webContents.openDevTools();
});

ipcMain.on('zoom-in',    () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() + 0.5); });
ipcMain.on('zoom-out',   () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() - 0.5); });
ipcMain.on('zoom-reset', () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.view.webContents.setZoomLevel(0); });

ipcMain.on('find-in-page', (_, { text }) => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.view.webContents.findInPage(text);
});
ipcMain.on('stop-find',    () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.view.webContents.stopFindInPage('clearSelection');
});

ipcMain.on('toggle-adblock', (_, { enabled }) => {
  store.set('adblock', enabled);
});

ipcMain.on('print-page', () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) tab.view.webContents.print();
});

ipcMain.on('save-page', async () => {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: path.join(app.getPath('documents'), 'page.html'),
    filters: [{ name: 'HTML', extensions: ['html'] }],
  });
  if (filePath) tab.view.webContents.savePage(filePath, 'HTMLComplete');
});

// ─── App menu ─────────────────────────────────────────────────────────────────
function buildAppMenu() {
  const template = [
    {
      label: 'Calopsia',
      submenu: [
        { label: 'About Calopsia', role: 'about' },
        { type: 'separator' },
        { label: 'Preferences', accelerator: 'CmdOrCtrl+,', click: () => sendToRenderer('open-settings') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'File',
      submenu: [
        { label: 'New Tab',    accelerator: 'CmdOrCtrl+T', click: () => createTab() },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: createWindow },
        { type: 'separator' },
        { label: 'Save Page', accelerator: 'CmdOrCtrl+S', click: () => ipcMain.emit('save-page') },
        { label: 'Print',     accelerator: 'CmdOrCtrl+P', click: () => ipcMain.emit('print-page') },
        { type: 'separator' },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => closeTab(activeTabId) },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' },
        { role: 'selectAll' }, { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => sendToRenderer('toggle-find') },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Reload',         accelerator: 'CmdOrCtrl+R',       click: () => ipcMain.emit('reload') },
        { label: 'Hard Reload',    accelerator: 'Shift+CmdOrCtrl+R', click: () => { const t = tabs.find(t => t.id === activeTabId); if (t) t.view.webContents.reloadIgnoringCache(); } },
        { type: 'separator' },
        { label: 'Zoom In',        accelerator: 'CmdOrCtrl+=',       click: () => ipcMain.emit('zoom-in') },
        { label: 'Zoom Out',       accelerator: 'CmdOrCtrl+-',       click: () => ipcMain.emit('zoom-out') },
        { label: 'Reset Zoom',     accelerator: 'CmdOrCtrl+0',       click: () => ipcMain.emit('zoom-reset') },
        { type: 'separator' },
        { label: 'Toggle DevTools',accelerator: 'Alt+CmdOrCtrl+I',   click: () => ipcMain.emit('open-devtools') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Show History', accelerator: 'CmdOrCtrl+Y', click: () => sendToRenderer('open-history') },
        { label: 'Clear History', click: () => ipcMain.emit('clear-history') },
        { type: 'separator' },
        { label: 'Back',    accelerator: 'CmdOrCtrl+[', click: () => ipcMain.emit('go-back',    { id: activeTabId }) },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: () => ipcMain.emit('go-forward', { id: activeTabId }) },
      ],
    },
    {
      label: 'Bookmarks',
      submenu: [
        { label: 'Show Bookmarks', accelerator: 'CmdOrCtrl+B', click: () => sendToRenderer('open-bookmarks') },
        { label: 'Bookmark This Page', accelerator: 'CmdOrCtrl+D', click: () => sendToRenderer('bookmark-current') },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── Global shortcuts ─────────────────────────────────────────────────────────
function registerShortcuts() {
  // handled via menu – nothing extra needed here
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
