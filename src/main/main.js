'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, nativeTheme, session, systemPreferences, safeStorage, dialog } = require('electron');
const { applyUserPath } = require('./cli/envPath');
const { Store } = require('./store');
const { registerIpc } = require('./ipc');
const { UI_URL, isExternalUrl } = require('./security');

// Two instances must never concurrently rewrite the same library/settings.
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();

// Critical: a GUI app launched from Finder/Dock gets a minimal PATH and can't
// see CLIs in ~/.local/bin, Homebrew, nvm, etc. Reconstruct the real shell PATH
// up front so detection, sign-in, install, and generation can find the CLIs.
applyUserPath();

let mainWindow = null;
let store = null;
let ipcController = null;

const isDev = process.argv.includes('--dev');

function createWindow() {
  const isMac = process.platform === 'darwin';
  const isWin = process.platform === 'win32';
  // Mica exists only on Windows 11 22H2+ (build 22621). On older Windows an
  // alpha backgroundColor renders as OPAQUE BLACK behind the translucent
  // renderer panels — so gate the material and fall back to a solid backdrop.
  const winBuild = isWin ? parseInt((require('os').release().split('.')[2] || '0'), 10) : 0;
  const micaOk = isWin && winBuild >= 22621;
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    // Translucent "Liquid Glass" chrome on macOS (vibrancy) and Mica on Windows.
    // The renderer paints semi-transparent panels so the material shows through.
    ...(isMac
      ? { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
      : micaOk
        ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' }
        : { backgroundColor: '#1a1726' }),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (process.env.CHAPTERONE_DEBUG) {
    mainWindow.webContents.on('console-message', (_e, _lvl, message) => console.log('[renderer]', message));
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  // Null the reference so menu handlers can't touch a destroyed window.
  mainWindow.on('closed', () => { mainWindow = null; });

  // Open external links in the user's browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault());

  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Book',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow && mainWindow.webContents.send('menu:new-book'),
        },
        {
          label: 'Settings',
          accelerator: 'CmdOrCtrl+,',
          click: () => mainWindow && mainWindow.webContents.send('menu:settings'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Send to Kindle Help',
          click: () =>
            shell.openExternal('https://www.amazon.com/sendtokindle'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.on('second-instance', () => {
  if (!mainWindow) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
});

if (hasLock) app.whenReady().then(() => {
  // Follow the system appearance for the in-app light/dark theme.
  nativeTheme.themeSource = 'system';

  // Microphone access (ElevenLabs voice cloning / recording).
  //
  // The macOS mic prompt was firing over and over because Chromium kept asking
  // the OS on every getUserMedia call. The fix is to route the decision through
  // macOS's OWN permission API (systemPreferences): ask exactly once via
  // askForMediaAccess (the OS caches the answer for the session), and on every
  // subsequent request answer synchronously from getMediaAccessStatus without
  // prompting. The check handler returns the REAL OS status so Chromium doesn't
  // loop between "I think it's granted" and "the OS disagrees".
  const dbg = (...a) => { if (process.env.CHAPTERONE_DEBUG) console.log('[perm]', ...a); };
  const isMic = (p) => p === 'media' || p === 'audioCapture' || p === 'microphone';
  // Choosing an audio OUTPUT device (setSinkId / the speaker picker) is its own
  // Chromium permission, distinct from the microphone. It needs no OS prompt, so
  // grant it outright — otherwise the speaker picker can't route audio.
  const isSpeaker = (p) => p === 'speaker-selection';
  const micStatus = () => {
    if (process.platform !== 'darwin') return 'granted';
    try { return systemPreferences.getMediaAccessStatus('microphone'); } catch (_) { return 'denied'; }
  };
  let micAskInFlight = null; // collapse concurrent asks into one OS prompt

  const trusted = (wc, details) => wc && wc === mainWindow?.webContents && wc.getURL() === UI_URL
    && details?.isMainFrame !== false
    && (!details?.requestingUrl || details.requestingUrl === UI_URL);
  session.defaultSession.setPermissionCheckHandler((wc, permission, _origin, details) => {
    if (!trusted(wc, details) || details?.mediaType === 'video') return false;
    const ok = isSpeaker(permission) ? true : (isMic(permission) ? micStatus() === 'granted' : false);
    dbg('check', permission, 'osMic=', micStatus(), '->', ok);
    return ok;
  });

  session.defaultSession.setPermissionRequestHandler(async (wc, permission, cb, details) => {
    if (!trusted(wc, details) || details?.mediaTypes?.includes('video')) return cb(false);
    dbg('request', permission, 'osMic=', micStatus());
    if (isSpeaker(permission)) return cb(true);
    if (!isMic(permission)) return cb(false);
    const status = micStatus();
    if (status === 'granted') return cb(true);
    if (status === 'denied' || status === 'restricted') return cb(false); // user said no — never nag
    try {
      if (!micAskInFlight) micAskInFlight = systemPreferences.askForMediaAccess('microphone');
      const ok = await micAskInFlight;
      micAskInFlight = null;
      dbg('askForMediaAccess ->', ok, 'osMicNow=', micStatus());
      cb(!!ok);
    } catch (e) { micAskInFlight = null; dbg('ask error', e && e.message); cb(false); }
  });

  store = new Store(app.getPath('userData'), { secretStorage: safeStorage });
  store.migrateSecrets();
  store.reconcileInterrupted(); // recover books left mid-write by a previous crash/close
  ipcController = registerIpc(store);
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
}).catch((error) => {
  dialog.showErrorBox('ChapterOne could not start', error.message);
  app.quit();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (ipcController) ipcController.dispose();
});
