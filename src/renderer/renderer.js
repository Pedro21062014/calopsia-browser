'use strict';

/* ─── DOM refs ──────────────────────────────────────────────────────────────── */
const $ = id => document.getElementById(id);
const tabsContainer   = $('tabs-container');
const addrInput       = $('address-bar');
const addrWrap        = $('address-bar-wrap');
const securityIcon    = $('security-icon');
const findBar         = $('find-bar');
const findInput       = $('find-input');
const findCount       = $('find-count');
const panelOverlay    = $('panel-overlay');

const panels = {
  bookmarks: $('panel-bookmarks'),
  history:   $('panel-history'),
  downloads: $('panel-downloads'),
  settings:  $('panel-settings'),
};

/* ─── State ─────────────────────────────────────────────────────────────────── */
let tabs        = [];   // { id, title, url, favicon, loading }
let activeTabId = null;
let bookmarks   = [];
let addrFocused = false;

/* ─── Helpers ───────────────────────────────────────────────────────────────── */
function activeTab() { return tabs.find(t => t.id === activeTabId); }

function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function domainOf(url) {
  try { return new URL(url).hostname.replace('www.', ''); } catch { return url; }
}

function isBookmarked(url) { return bookmarks.some(b => b.url === url); }

function updateBookmarkBtn() {
  const tab = activeTab();
  const btn = $('btn-bookmark-current');
  if (tab && isBookmarked(tab.url)) {
    btn.classList.add('bookmarked');
    btn.title = 'Remove bookmark';
  } else {
    btn.classList.remove('bookmarked');
    btn.title = 'Bookmark this page';
  }
}

function updateSecurityIcon(url) {
  if (!url || url.startsWith('https://') || url === 'about:blank' || url.startsWith('file://')) {
    securityIcon.classList.remove('insecure');
    securityIcon.title = 'Secure connection';
  } else {
    securityIcon.classList.add('insecure');
    securityIcon.title = 'Not secure';
  }
}

/* ─── Tab rendering ─────────────────────────────────────────────────────────── */
function renderTab(tab) {
  const el = document.createElement('div');
  el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
  el.dataset.id = tab.id;

  // Spinner
  const spinner = document.createElement('div');
  spinner.className = 'tab-spinner' + (tab.loading ? '' : ' hidden');

  // Favicon
  const fav = document.createElement('img');
  fav.className = 'tab-favicon' + (tab.favicon && !tab.loading ? '' : ' hidden');
  if (tab.favicon) fav.src = tab.favicon;
  fav.onerror = () => fav.classList.add('hidden');

  // Title
  const title = document.createElement('span');
  title.className = 'tab-title';
  title.textContent = tab.title || 'New Tab';

  // Close btn
  const close = document.createElement('button');
  close.className = 'tab-close';
  close.innerHTML = '✕';
  close.title = 'Close tab';
  close.addEventListener('click', e => {
    e.stopPropagation();
    window.calopsia.closeTab(tab.id);
  });

  el.append(spinner, fav, title, close);
  el.addEventListener('click', () => window.calopsia.activateTab(tab.id));
  el.addEventListener('mousedown', e => { if (e.button === 1) { e.preventDefault(); window.calopsia.closeTab(tab.id); } });

  return el;
}

function refreshTabs() {
  tabsContainer.innerHTML = '';
  tabs.forEach(tab => tabsContainer.appendChild(renderTab(tab)));
  // Scroll active into view
  const active = tabsContainer.querySelector('.tab.active');
  if (active) active.scrollIntoView({ block: 'nearest', inline: 'center' });
}

/* ─── Address bar ───────────────────────────────────────────────────────────── */
function setAddress(url) {
  if (!addrFocused) addrInput.value = url === 'about:blank' ? '' : (url || '');
  updateSecurityIcon(url);
  updateBookmarkBtn();
}

/* ─── Panel management ──────────────────────────────────────────────────────── */
let openPanel = null;

function showPanel(name) {
  if (openPanel) hidePanel();
  const panel = panels[name];
  if (!panel) return;
  openPanel = name;
  panelOverlay.classList.remove('hidden');
  panel.classList.remove('hidden');
  // Load data
  if (name === 'bookmarks') loadBookmarks();
  if (name === 'history')   loadHistory();
  if (name === 'downloads') loadDownloads();
  if (name === 'settings')  loadSettings();
}

function hidePanel() {
  if (!openPanel) return;
  panels[openPanel].classList.add('hidden');
  panelOverlay.classList.add('hidden');
  openPanel = null;
}

/* ─── Bookmarks panel ───────────────────────────────────────────────────────── */
async function loadBookmarks() {
  const list = $('bookmarks-list');
  bookmarks = await window.calopsia.getBookmarks();
  if (!bookmarks.length) {
    list.innerHTML = `<div class="panel-empty"><svg viewBox="0 0 24 24"><path d="M19 21 12 16 5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/></svg><p>No bookmarks yet.<br/>Press ⭐ to save a page.</p></div>`;
    return;
  }
  list.innerHTML = '';
  bookmarks.forEach(bm => {
    const item = createPanelItem(bm.title || domainOf(bm.url), bm.url, bm.favicon, () => {
      window.calopsia.navigate(activeTabId, bm.url);
      hidePanel();
    }, () => {
      window.calopsia.removeBookmark(bm.url);
      loadBookmarks();
    }, '🗑');
    list.appendChild(item);
  });
  updateBookmarkBtn();
}

/* ─── History panel ─────────────────────────────────────────────────────────── */
async function loadHistory() {
  const list = $('history-list');
  const history = await window.calopsia.getHistory();
  if (!history.length) {
    list.innerHTML = `<div class="panel-empty"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><p>No history yet.</p></div>`;
    return;
  }
  list.innerHTML = '';
  let lastDate = '';
  history.forEach(item => {
    const dateStr = formatDate(item.date);
    if (dateStr !== lastDate) {
      lastDate = dateStr;
      const div = document.createElement('div');
      div.className = 'panel-date-divider';
      div.textContent = dateStr;
      list.appendChild(div);
    }
    const el = createPanelItem(item.title || domainOf(item.url), item.url, null, () => {
      window.calopsia.navigate(activeTabId, item.url);
      hidePanel();
    }, null, null);
    list.appendChild(el);
  });
}

/* ─── Downloads panel ───────────────────────────────────────────────────────── */
async function loadDownloads() {
  const list = $('downloads-list');
  const downloads = await window.calopsia.getDownloads();
  if (!downloads.length) {
    list.innerHTML = `<div class="panel-empty"><svg viewBox="0 0 24 24"><polyline points="12 3 12 15"/><polyline points="7 10 12 15 17 10"/><line x1="4" y1="21" x2="20" y2="21"/></svg><p>No downloads yet.</p></div>`;
    return;
  }
  list.innerHTML = '';
  downloads.forEach(dl => {
    const item = document.createElement('div');
    item.className = 'panel-item';
    const pct = dl.total ? Math.round((dl.received / dl.total) * 100) : 0;
    item.innerHTML = `
      <div class="panel-item-icon"><span class="default-icon">📄</span></div>
      <div class="panel-item-info">
        <div class="panel-item-title">${dl.filename}</div>
        <div class="panel-item-url">${dl.state === 'completed' ? '✓ Completed' : dl.state === 'progressing' ? `${pct}%` : '✗ Interrupted'}</div>
        ${dl.state === 'progressing' ? `<div class="dl-progress-wrap"><div class="dl-progress-bar" style="width:${pct}%"></div></div>` : ''}
      </div>`;
    list.appendChild(item);
  });
}

/* ─── Settings panel ────────────────────────────────────────────────────────── */
async function loadSettings() {
  const hp      = await window.calopsia.getStore('homepage');
  const se      = await window.calopsia.getStore('searchEngine');
  const adblock = await window.calopsia.getStore('adblock');

  $('setting-homepage').value = hp || 'https://www.google.com';
  $('setting-search').value   = se || 'https://www.google.com/search?q=';
  $('setting-adblock').checked = !!adblock;
  $('setting-darkmode').checked = true;

  $('setting-homepage').oninput = e => window.calopsia.setStore('homepage', e.target.value);
  $('setting-search').onchange  = e => window.calopsia.setStore('searchEngine', e.target.value);
  $('setting-adblock').onchange = e => window.calopsia.toggleAdblock(e.target.checked);
  $('btn-clear-all-history').onclick = () => { window.calopsia.clearHistory(); };
  $('btn-clear-bookmarks').onclick = () => {
    bookmarks.forEach(b => window.calopsia.removeBookmark(b.url));
    bookmarks = [];
  };
}

/* ─── Generic panel item ────────────────────────────────────────────────────── */
function createPanelItem(title, url, favicon, onClick, onAction, actionIcon) {
  const item = document.createElement('div');
  item.className = 'panel-item';

  const iconEl = document.createElement('div');
  iconEl.className = 'panel-item-icon';
  if (favicon) {
    const img = document.createElement('img');
    img.src = favicon;
    img.onerror = () => { iconEl.innerHTML = '<span class="default-icon">🌐</span>'; };
    iconEl.appendChild(img);
  } else {
    iconEl.innerHTML = '<span class="default-icon">🌐</span>';
  }

  const info = document.createElement('div');
  info.className = 'panel-item-info';
  const t = document.createElement('div');
  t.className = 'panel-item-title';
  t.textContent = title;
  const u = document.createElement('div');
  u.className = 'panel-item-url';
  u.textContent = domainOf(url);
  info.append(t, u);

  item.append(iconEl, info);

  if (onAction && actionIcon) {
    const btn = document.createElement('button');
    btn.className = 'panel-item-action';
    btn.textContent = actionIcon;
    btn.addEventListener('click', e => { e.stopPropagation(); onAction(); });
    item.appendChild(btn);
  }

  item.addEventListener('click', onClick);
  return item;
}

/* ─── Find in page ──────────────────────────────────────────────────────────── */
function toggleFind() {
  if (findBar.classList.contains('hidden')) {
    findBar.classList.remove('hidden');
    findInput.focus();
    findInput.select();
  } else {
    findBar.classList.add('hidden');
    window.calopsia.stopFind();
    findInput.value = '';
    findCount.textContent = '';
  }
}

findInput.addEventListener('input', () => {
  const text = findInput.value;
  if (text) window.calopsia.findInPage(text);
  else { window.calopsia.stopFind(); findCount.textContent = ''; }
});
findInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') window.calopsia.findInPage(findInput.value);
  if (e.key === 'Escape') toggleFind();
});
$('btn-find-prev').addEventListener('click', () => window.calopsia.findInPage(findInput.value));
$('btn-find-next').addEventListener('click', () => window.calopsia.findInPage(findInput.value));
$('btn-find-close').addEventListener('click', toggleFind);

/* ─── Event listeners ───────────────────────────────────────────────────────── */

// Navigation bar buttons
$('btn-back').addEventListener('click',    () => window.calopsia.goBack(activeTabId));
$('btn-forward').addEventListener('click', () => window.calopsia.goForward(activeTabId));
$('btn-home').addEventListener('click',    async () => {
  const hp = await window.calopsia.getStore('homepage');
  window.calopsia.navigate(activeTabId, hp);
});

let isLoading = false;
$('btn-reload').addEventListener('click', () => {
  if (isLoading) window.calopsia.stop(activeTabId);
  else window.calopsia.reload(activeTabId);
});

$('btn-new-tab').addEventListener('click', () => window.calopsia.newTab());

// Address bar
addrInput.addEventListener('focus', () => {
  addrFocused = true;
  addrInput.select();
});
addrInput.addEventListener('blur', () => {
  addrFocused = false;
  const tab = activeTab();
  if (tab) addrInput.value = tab.url === 'about:blank' ? '' : (tab.url || '');
});
addrInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const url = addrInput.value.trim();
    if (url) {
      window.calopsia.navigate(activeTabId, url);
      addrInput.blur();
    }
  }
  if (e.key === 'Escape') { addrInput.blur(); }
});

// Bookmark current page
$('btn-bookmark-current').addEventListener('click', () => {
  const tab = activeTab();
  if (!tab) return;
  if (isBookmarked(tab.url)) {
    window.calopsia.removeBookmark(tab.url);
    bookmarks = bookmarks.filter(b => b.url !== tab.url);
  } else {
    window.calopsia.addBookmark(tab.url, tab.title);
    bookmarks.push({ url: tab.url, title: tab.title });
  }
  updateBookmarkBtn();
});

// Panel buttons
$('btn-bookmarks').addEventListener('click', () => showPanel('bookmarks'));
$('btn-history').addEventListener('click',   () => showPanel('history'));
$('btn-downloads').addEventListener('click', () => showPanel('downloads'));
$('btn-settings').addEventListener('click',  () => showPanel('settings'));
$('btn-clear-history').addEventListener('click', () => window.calopsia.clearHistory());

panelOverlay.addEventListener('click', hidePanel);

// Close buttons on panels
document.querySelectorAll('.panel-close').forEach(btn => {
  btn.addEventListener('click', () => hidePanel());
});

// Window controls
$('btn-close').addEventListener('click',    () => window.calopsia.closeWindow());
$('btn-minimize').addEventListener('click', () => window.calopsia.minimize());
$('btn-maximize').addEventListener('click', () => window.calopsia.maximize());

// Menu button context menu
$('btn-menu').addEventListener('click', e => showCtxMenu(e, [
  { icon: '<svg viewBox="0 0 16 16"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1z"/><polyline points="8 5 8 8 10 10"/></svg>', label: 'History',   action: () => showPanel('history') },
  { icon: '<svg viewBox="0 0 16 16"><path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1z"/></svg>', label: 'Bookmarks', action: () => showPanel('bookmarks') },
  { icon: '<svg viewBox="0 0 16 16"><polyline points="8 2 8 11"/><polyline points="4 8 8 12 12 8"/><line x1="2" y1="14" x2="14" y2="14"/></svg>', label: 'Downloads', action: () => showPanel('downloads') },
  { separator: true },
  { icon: '<svg viewBox="0 0 16 16"><line x1="3" y1="8" x2="13" y2="8"/><line x1="3" y1="4" x2="13" y2="4"/><line x1="3" y1="12" x2="13" y2="12"/></svg>', label: 'Find in Page', action: () => toggleFind() },
  { icon: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2"/><line x1="8" y1="1" x2="8" y2="4"/><line x1="8" y1="12" x2="8" y2="15"/><line x1="1" y1="8" x2="4" y2="8"/><line x1="12" y1="8" x2="15" y2="8"/></svg>', label: 'Settings', action: () => showPanel('settings') },
  { separator: true },
  { icon: '<svg viewBox="0 0 16 16"><polyline points="5 8 3 10 5 12"/><path d="M3 10h8a3 3 0 0 0 0-6H9"/></svg>', label: 'Zoom Out',   action: () => window.calopsia.zoomOut() },
  { icon: '<svg viewBox="0 0 16 16"><polyline points="11 8 13 10 11 12"/><path d="M13 10H5a3 3 0 0 1 0-6h2"/></svg>', label: 'Zoom In',    action: () => window.calopsia.zoomIn() },
  { icon: '<svg viewBox="0 0 16 16"><line x1="4" y1="8" x2="12" y2="8"/><line x1="8" y1="4" x2="8" y2="12"/></svg>', label: 'DevTools',   action: () => window.calopsia.openDevTools() },
  { icon: '<svg viewBox="0 0 16 16"><polyline points="6 2 2 2 2 14 14 14 14 10"/><polyline points="10 2 14 2 14 6"/><line x1="14" y1="2" x2="8" y2="8"/></svg>', label: 'Save Page',  action: () => window.calopsia.savePage() },
  { icon: '<svg viewBox="0 0 16 16"><polyline points="3 3 13 3 12 11 8 13 4 11z"/></svg>', label: 'Print',       action: () => window.calopsia.printPage() },
]));

/* ─── Context menu ──────────────────────────────────────────────────────────── */
const ctxMenu = $('ctx-menu');

function showCtxMenu(event, items) {
  ctxMenu.innerHTML = '';
  items.forEach(item => {
    if (item.separator) {
      const sep = document.createElement('div');
      sep.className = 'ctx-separator';
      ctxMenu.appendChild(sep);
      return;
    }
    const el = document.createElement('div');
    el.className = 'ctx-item' + (item.danger ? ' danger' : '');
    el.innerHTML = `${item.icon || ''}<span>${item.label}</span>`;
    el.addEventListener('click', () => { hideCtxMenu(); item.action(); });
    ctxMenu.appendChild(el);
  });

  ctxMenu.classList.remove('hidden');
  const { clientX: x, clientY: y } = event;
  const { offsetWidth: w, offsetHeight: h } = ctxMenu;
  ctxMenu.style.left = Math.min(x, window.innerWidth  - w - 8) + 'px';
  ctxMenu.style.top  = Math.min(y, window.innerHeight - h - 8) + 'px';
}

function hideCtxMenu() { ctxMenu.classList.add('hidden'); }
document.addEventListener('click',       e => { if (!ctxMenu.contains(e.target)) hideCtxMenu(); });
document.addEventListener('contextmenu', e => { e.preventDefault(); hideCtxMenu(); });

/* ─── Keyboard shortcuts ────────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === 'f')  { e.preventDefault(); toggleFind(); }
  if (mod && e.key === 't')  { e.preventDefault(); window.calopsia.newTab(); }
  if (mod && e.key === 'w')  { e.preventDefault(); window.calopsia.closeTab(activeTabId); }
  if (mod && e.key === 'l')  { e.preventDefault(); addrInput.focus(); addrInput.select(); }
  if (mod && e.key === 'r')  { e.preventDefault(); window.calopsia.reload(activeTabId); }
  if (mod && e.key === 'd')  { e.preventDefault(); $('btn-bookmark-current').click(); }
  if (mod && e.key === '+')  { e.preventDefault(); window.calopsia.zoomIn(); }
  if (mod && e.key === '-')  { e.preventDefault(); window.calopsia.zoomOut(); }
  if (mod && e.key === '0')  { e.preventDefault(); window.calopsia.zoomReset(); }

  // Tab switching
  if (mod && e.key >= '1' && e.key <= '9') {
    const idx = parseInt(e.key) - 1;
    if (tabs[idx]) window.calopsia.activateTab(tabs[idx].id);
  }
});

/* ─── IPC event handlers (from main process) ────────────────────────────────── */
window.calopsia.on('tab-created', data => {
  tabs.push({ id: data.id, title: data.title || 'New Tab', url: data.url || '', favicon: null, loading: !!data.loading });
  activeTabId = data.id;
  refreshTabs();
  setAddress(data.url || '');
});

window.calopsia.on('tab-activated', data => {
  activeTabId = data.id;
  refreshTabs();
  const tab = activeTab();
  if (tab) setAddress(tab.url || '');
  updateNavButtons();
});

window.calopsia.on('tab-closed', data => {
  tabs = tabs.filter(t => t.id !== data.id);
  refreshTabs();
});

window.calopsia.on('tab-updated', data => {
  const tab = tabs.find(t => t.id === data.id);
  if (!tab) return;
  Object.assign(tab, data);

  // Update spinner / loading state
  if (data.id === activeTabId) {
    isLoading = !!data.loading;
    updateReloadBtn();
    if (data.url) setAddress(data.url);
  }

  refreshTabs();
});

window.calopsia.on('tab-navigated', data => {
  const tab = tabs.find(t => t.id === data.id);
  if (tab) tab.url = data.url;

  if (data.id === activeTabId) {
    if (!addrFocused) setAddress(data.url);
    $('btn-back').disabled    = !data.canGoBack;
    $('btn-forward').disabled = !data.canGoForward;
  }
});

window.calopsia.on('open-settings',  () => showPanel('settings'));
window.calopsia.on('open-history',   () => showPanel('history'));
window.calopsia.on('open-bookmarks', () => showPanel('bookmarks'));
window.calopsia.on('toggle-find',    () => toggleFind());
window.calopsia.on('bookmark-current', () => $('btn-bookmark-current').click());

window.calopsia.on('bookmarks-updated', bm => {
  bookmarks = bm;
  updateBookmarkBtn();
});

window.calopsia.on('history-cleared', () => {
  if (openPanel === 'history') loadHistory();
});

window.calopsia.on('download-started', () => {
  // Flash downloads button
  $('btn-downloads').style.color = 'var(--accent)';
  setTimeout(() => { $('btn-downloads').style.color = ''; }, 2000);
});

window.calopsia.on('download-done', data => {
  if (openPanel === 'downloads') loadDownloads();
});

/* ─── Nav button helpers ────────────────────────────────────────────────────── */
function updateNavButtons() {
  $('btn-back').disabled    = false;
  $('btn-forward').disabled = false;
}

function updateReloadBtn() {
  const btn = $('btn-reload');
  if (isLoading) {
    btn.innerHTML = `<svg viewBox="0 0 20 20"><line x1="5" y1="5" x2="15" y2="15"/><line x1="15" y1="5" x2="5" y2="15"/></svg>`;
    btn.title = 'Stop';
  } else {
    btn.innerHTML = `<svg viewBox="0 0 20 20"><path d="M4.5 10a5.5 5.5 0 1 0 1.2-3.4"/><polyline points="4 4 4 8 8 8"/></svg>`;
    btn.title = 'Reload';
  }
  // re-attach inline svg stroke attrs
  const svg = btn.querySelector('svg');
  if (svg) {
    svg.style.cssText = '';
  }
}

/* ─── Detect platform for window controls ───────────────────────────────────── */
(async () => {
  const platform = navigator.userAgent.includes('Mac') ? 'mac' : 'other';
  if (platform === 'mac') {
    // On macOS, native traffic lights are shown; hide custom ones
    $('window-controls').style.display = 'none';
  }
  // Load initial bookmarks
  bookmarks = await window.calopsia.getBookmarks();
})();
