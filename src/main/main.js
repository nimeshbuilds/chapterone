'use strict';

const path = require('path');
const { app, BrowserWindow, Menu, shell, nativeTheme, session } = require('electron');
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

  // Allow microphone access (for ElevenLabs voice cloning / recording).
  // Only the request handler — adding a check handler made Chromium treat the
  // permission as already granted and re-trigger the macOS prompt in a loop.
  const isMic = (p) => p === 'media' || p === 'audioCapture' || p === 'microphone';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(isMic(permission)));

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
