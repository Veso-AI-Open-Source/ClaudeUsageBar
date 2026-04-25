const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, shell } = require('electron');
const path = require('path');

const { readCredentials } = require('./src/credentials');
const { fetchUsage } = require('./src/api');
const { parseLocalLogs, bucketTotal } = require('./src/localUsage');

let tray = null;
let popup = null;
let iconRenderer = null;
let pollTimer = null;
let consecutiveErrors = 0;
let cachedToken = null;

const state = {
  usage: null,
  localCosts: null,
  subscriptionType: '',
  rateLimitTier: '',
  lastUpdated: null,
  errorMessage: null,
  isLoading: false,
  hasLoaded: false,
};

const BASE_INTERVAL_MS = 60 * 1000;
const MAX_INTERVAL_MS = 15 * 60 * 1000;

function clamp(v) {
  if (v == null || !Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function sessionPercent() { return clamp(state.usage?.five_hour?.utilization); }
function weeklyPercent() { return clamp(state.usage?.seven_day?.utilization); }
function opusPercent() { return clamp(state.usage?.seven_day_opus?.utilization); }

function sessionElapsedPercent() {
  const resetStr = state.usage?.five_hour?.resets_at;
  if (!resetStr) return 0;
  const reset = new Date(resetStr);
  if (Number.isNaN(reset.getTime())) return 0;
  const remainingMs = reset.getTime() - Date.now();
  if (remainingMs <= 0) return 100;
  const windowMs = 5 * 3600 * 1000;
  const elapsed = windowMs - remainingMs;
  return Math.max(0, Math.min(100, (elapsed / windowMs) * 100));
}

function worstWindow() {
  const candidates = [
    { tag: 'S', percent: sessionPercent() },
    { tag: 'W', percent: weeklyPercent() },
    { tag: 'O', percent: opusPercent() },
  ];
  return candidates.reduce((a, b) => (b.percent > a.percent ? b : a));
}

function statusColor(percent) {
  if (percent >= 80) return '#ff3b30';
  if (percent >= 50) return '#ff9500';
  return '#34c759';
}

function planDisplayName() {
  const sub = (state.subscriptionType || '').toLowerCase();
  const tier = state.rateLimitTier || '';
  if (sub === 'max') {
    if (tier.includes('20x')) return 'Max 20x';
    if (tier.includes('5x')) return 'Max 5x';
    return 'Max';
  }
  if (sub === 'pro') return 'Pro';
  if (sub === 'free') return 'Free';
  return state.subscriptionType
    ? state.subscriptionType[0].toUpperCase() + state.subscriptionType.slice(1)
    : 'Unknown';
}

function timeUntilReset(isoString) {
  if (!isoString) return null;
  const t = new Date(isoString).getTime();
  if (Number.isNaN(t)) return null;
  const interval = t - Date.now();
  if (interval <= 0) return 'resetting…';
  const totalMin = Math.floor(interval / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor(totalMin / 60) % 24;
  const minutes = totalMin % 60;
  if (days > 0) return hours > 0 ? `resets in ${days}d ${hours}h` : `resets in ${days}d`;
  if (hours > 0) return `resets in ${hours}h ${minutes}m`;
  return `resets in ${Math.max(1, minutes)}m`;
}

function snapshotForRenderer() {
  return {
    hasLoaded: state.hasLoaded,
    isLoading: state.isLoading,
    errorMessage: state.errorMessage,
    lastUpdated: state.lastUpdated ? state.lastUpdated.toISOString() : null,
    sessionPercent: sessionPercent(),
    sessionElapsedPercent: sessionElapsedPercent(),
    weeklyPercent: weeklyPercent(),
    opusPercent: opusPercent(),
    sonnetPercent: clamp(state.usage?.seven_day_sonnet?.utilization),
    fiveHourResetIn: timeUntilReset(state.usage?.five_hour?.resets_at),
    sevenDayResetIn: timeUntilReset(state.usage?.seven_day?.resets_at),
    extraUsage: state.usage?.extra_usage ?? null,
    planName: planDisplayName(),
    localCosts: state.localCosts ? {
      todayTokens: state.localCosts.todayTokens,
      weekTokens: state.localCosts.weekTokens,
      monthTokens: state.localCosts.monthTokens,
      sessionTotal: bucketTotal(state.localCosts.sessionUsage),
      sessionInput: state.localCosts.sessionUsage.input + state.localCosts.sessionUsage.cacheRead + state.localCosts.sessionUsage.cacheWrite,
      sessionOutput: state.localCosts.sessionUsage.output,
      weeklyTotal: bucketTotal(state.localCosts.weeklyUsage),
      weeklyInput: state.localCosts.weeklyUsage.input + state.localCosts.weeklyUsage.cacheRead + state.localCosts.weeklyUsage.cacheWrite,
      weeklyOutput: state.localCosts.weeklyUsage.output,
      modelBreakdown: state.localCosts.modelBreakdown,
    } : null,
  };
}

async function setupIconRenderer() {
  iconRenderer = new BrowserWindow({
    show: false,
    width: 64, height: 64,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  await iconRenderer.loadFile(path.join(__dirname, 'renderer', 'icon.html'));
}

async function makeTrayIcon(percent) {
  if (!iconRenderer) return null;
  const dataUrl = await iconRenderer.webContents.executeJavaScript(
    `window.drawIcon(${percent}, 2)`
  );
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  const img = nativeImage.createFromBuffer(buf, { scaleFactor: 2.0 });
  if (process.platform === 'darwin') {
    // Template image: macOS auto-tints to match menu-bar appearance.
    img.setTemplateImage(true);
  }
  return img;
}

async function refreshTray() {
  if (!tray) return;
  const percent = state.hasLoaded ? worstWindow().percent : 0;
  try {
    const img = await makeTrayIcon(percent);
    if (img) tray.setImage(img);
  } catch {}

  const tag = state.hasLoaded ? worstWindow().tag : '';
  const titleText = state.hasLoaded
    ? `${Math.round(percent)}% ${tag}`
    : '—';
  if (process.platform === 'darwin' && typeof tray.setTitle === 'function') {
    tray.setTitle(' ' + titleText);
  }
  tray.setToolTip(buildTooltip());
}

function buildTooltip() {
  if (!state.hasLoaded) return 'Claude Usage — loading…';
  const parts = [
    `Session: ${Math.round(sessionPercent())}%`,
    `Weekly: ${Math.round(weeklyPercent())}%`,
  ];
  const opus = opusPercent();
  if (opus > 0) parts.push(`Opus (7d): ${Math.round(opus)}%`);
  return 'Claude Usage — ' + parts.join(' · ');
}

async function refresh({ forceSource = false } = {}) {
  state.isLoading = true;
  pushToWindow();

  if (forceSource || !cachedToken) loadCredentials();
  if (!cachedToken) {
    state.errorMessage = 'No Claude Code credentials found. Launch Claude Code first.';
    consecutiveErrors += 1;
    state.isLoading = false;
    pushToWindow();
    await refreshTray();
    return;
  }

  const sessionResetAt = state.usage?.five_hour?.resets_at
    ? new Date(state.usage.five_hour.resets_at) : null;
  const weeklyResetAt = state.usage?.seven_day?.resets_at
    ? new Date(state.usage.seven_day.resets_at) : null;

  const [apiResult, logs] = await Promise.all([
    fetchUsage(cachedToken),
    parseLocalLogs({
      sessionResetAt: validDate(sessionResetAt),
      weeklyResetAt: validDate(weeklyResetAt),
    }),
  ]);

  state.localCosts = logs;
  state.lastUpdated = new Date();

  if (apiResult.ok) {
    state.usage = apiResult.data;
    state.hasLoaded = true;
    state.errorMessage = null;
    consecutiveErrors = 0;
  } else if (apiResult.status === 401 || apiResult.status === 403) {
    cachedToken = null;
    loadCredentials();
    state.errorMessage = cachedToken
      ? 'Refreshed token; retrying soon.'
      : 'Token expired. Open Claude Code to sign in again.';
    consecutiveErrors += 1;
  } else if (apiResult.status === 429) {
    state.errorMessage = 'Rate-limited by API. Retrying soon.';
    consecutiveErrors += 1;
  } else if (apiResult.status >= 500) {
    state.errorMessage = `Anthropic API unavailable (${apiResult.status}).`;
    consecutiveErrors += 1;
  } else if (apiResult.error === 'timeout') {
    state.errorMessage = 'Request timed out.';
    consecutiveErrors += 1;
  } else if (apiResult.code === 'ENOTFOUND' || apiResult.code === 'EAI_AGAIN') {
    state.errorMessage = 'Offline';
    consecutiveErrors += 1;
  } else {
    state.errorMessage = apiResult.error
      ? `API error: ${apiResult.error}`
      : `API error (HTTP ${apiResult.status ?? '?'})`;
    consecutiveErrors += 1;
  }

  state.isLoading = false;
  pushToWindow();
  await refreshTray();
}

function validDate(d) {
  if (!d) return null;
  return Number.isNaN(d.getTime()) ? null : d;
}

function loadCredentials() {
  const oauth = readCredentials();
  if (!oauth) {
    cachedToken = null;
    state.errorMessage = 'No Claude Code credentials found.';
    return;
  }
  cachedToken = oauth.accessToken;
  state.subscriptionType = oauth.subscriptionType || '';
  state.rateLimitTier = oauth.rateLimitTier || '';
}

function nextPollDelayMs() {
  if (consecutiveErrors === 0) return BASE_INTERVAL_MS;
  const exp = Math.min(consecutiveErrors, 6);
  const backoff = Math.min(BASE_INTERVAL_MS * Math.pow(2, exp - 1), MAX_INTERVAL_MS);
  const jitter = Math.random() * Math.min(5000, backoff * 0.1);
  return backoff + jitter;
}

function schedulePoll() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(async () => {
    await refresh();
    schedulePoll();
  }, nextPollDelayMs());
}

function pushToWindow() {
  if (popup && !popup.isDestroyed()) {
    popup.webContents.send('state', snapshotForRenderer());
  }
}

function createPopup() {
  popup = new BrowserWindow({
    width: 320,
    height: 540,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    transparent: process.platform === 'darwin',
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#1c1c1e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
    },
  });
  popup.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  popup.on('blur', () => {
    if (popup && popup.isVisible()) popup.hide();
  });
  popup.webContents.on('did-finish-load', () => pushToWindow());
}

function positionPopup() {
  if (!tray || !popup) return;
  const trayBounds = tray.getBounds();
  const winBounds = popup.getBounds();
  const display = screen.getDisplayMatching(trayBounds.width
    ? trayBounds
    : { x: 0, y: 0, width: 1, height: 1 });
  const work = display.workArea;

  let x, y;
  if (trayBounds.width > 0 && trayBounds.height > 0) {
    x = Math.round(trayBounds.x + trayBounds.width / 2 - winBounds.width / 2);
    if (process.platform === 'darwin') {
      y = Math.round(trayBounds.y + trayBounds.height + 4);
    } else {
      const aboveTray = trayBounds.y - winBounds.height - 4;
      const belowTray = trayBounds.y + trayBounds.height + 4;
      y = aboveTray >= work.y ? aboveTray : belowTray;
    }
  } else {
    // Fallback (Linux often returns empty bounds): place near top-right of work area.
    x = work.x + work.width - winBounds.width - 8;
    y = work.y + 8;
  }

  x = Math.max(work.x + 4, Math.min(x, work.x + work.width - winBounds.width - 4));
  y = Math.max(work.y + 4, Math.min(y, work.y + work.height - winBounds.height - 4));
  popup.setPosition(x, y, false);
}

function togglePopup() {
  if (!popup) return;
  if (popup.isVisible()) {
    popup.hide();
    return;
  }
  positionPopup();
  popup.show();
  popup.focus();
  pushToWindow();
}

function buildContextMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open', click: () => togglePopup() },
    { label: 'Refresh', click: () => refresh() },
    { label: 'Re-read credentials', click: () => refresh({ forceSource: true }) },
    { type: 'separator' },
    { label: 'Open Anthropic console', click: () => shell.openExternal('https://console.anthropic.com/') },
    { type: 'separator' },
    { label: 'Quit', role: 'quit' },
  ]);
}

async function setupTray() {
  const initial = (await makeTrayIcon(0)) || nativeImage.createEmpty();
  tray = new Tray(initial);
  tray.setToolTip('Claude Usage — loading…');
  if (process.platform === 'darwin' && typeof tray.setTitle === 'function') {
    tray.setTitle(' …');
  }
  tray.on('click', () => togglePopup());
  tray.on('right-click', () => tray.popUpContextMenu(buildContextMenu()));
  await refreshTray();
}

ipcMain.handle('refresh', () => refresh());
ipcMain.handle('refresh-force', () => refresh({ forceSource: true }));
ipcMain.handle('quit', () => app.quit());
ipcMain.handle('hide', () => { if (popup) popup.hide(); });
ipcMain.handle('open-external', (_e, url) => shell.openExternal(url));
ipcMain.handle('get-state', () => snapshotForRenderer());

app.on('window-all-closed', (e) => { e.preventDefault(); });

if (process.platform === 'darwin' && app.dock) {
  app.dock.hide();
}

app.whenReady().then(async () => {
  await setupIconRenderer();
  createPopup();
  await setupTray();
  await refresh();
  schedulePoll();
});

app.on('before-quit', () => {
  if (pollTimer) clearTimeout(pollTimer);
});
