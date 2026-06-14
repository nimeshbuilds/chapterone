'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, nativeTheme, session, systemPreferences } = require('electron');
const { applyUserPath } = require('./cli/envPath');
const { Store } = require('./store');
const { registerIpc } = require('./ipc');

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
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    // Translucent "Liquid Glass" chrome on macOS (vibrancy) and Mica on Windows.
    // The renderer paints semi-transparent panels so the material shows through.
    ...(isMac
      ? { vibrancy: 'under-window', visualEffectState: 'active', backgroundColor: '#00000000' }
      : isWin
        ? { backgroundMaterial: 'mica', backgroundColor: '#00000000' }
        : { backgroundColor: '#1a1726' }),
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 16, y: 18 } : undefined,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Open external links in the user's browser, not inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

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

app.whenReady().then(() => {
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
  const isMic = (p) => p === 'media' || p === 'audioCapture' || p === 'microphone';
  const micStatus = () => {
    if (process.platform !== 'darwin') return 'granted';
    try { return systemPreferences.getMediaAccessStatus('microphone'); } catch (_) { return 'granted'; }
  };
  let micAskInFlight = null; // collapse concurrent asks into one OS prompt

  session.defaultSession.setPermissionCheckHandler((_wc, permission) =>
    isMic(permission) ? micStatus() === 'granted' : false);

  session.defaultSession.setPermissionRequestHandler(async (_wc, permission, cb) => {
    if (!isMic(permission)) return cb(false);
    const status = micStatus();
    if (status === 'granted') return cb(true);
    if (status === 'denied' || status === 'restricted') return cb(false); // user said no — never nag
    try {
      if (!micAskInFlight) micAskInFlight = systemPreferences.askForMediaAccess('microphone');
      const ok = await micAskInFlight;
      micAskInFlight = null;
      cb(!!ok);
    } catch (_) { micAskInFlight = null; cb(true); }
  });

  store = new Store(app.getPath('userData'));
  store.reconcileInterrupted(); // recover books left mid-write by a previous crash/close
  ipcController = registerIpc(store);
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (ipcController) ipcController.dispose();
});
