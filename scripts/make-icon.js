'use strict';

// Rasterize build/icon.svg → build/icon.png (1024×1024, transparent corners)
// so electron-builder can generate the macOS .icns / Windows .ico.
// Run with:  npm run icon

const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const buildDir = path.join(__dirname, '..', 'build');

app.disableHardwareAcceleration();

app.whenReady().then(async () => {
  const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');
  const win = new BrowserWindow({
    width: SIZE, height: SIZE, show: false, frame: false,
    transparent: true, backgroundColor: '#00000000',
    webPreferences: { offscreen: false },
  });
  const html =
    `<!DOCTYPE html><html><head><meta charset="utf-8">` +
    `<style>html,body{margin:0;padding:0;width:${SIZE}px;height:${SIZE}px;background:transparent;overflow:hidden}` +
    `svg{display:block;width:${SIZE}px;height:${SIZE}px}</style></head><body>${svg}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500)); // let fonts/gradients paint

  const img = await win.webContents.capturePage();
  const png = img.toPNG();
  fs.writeFileSync(path.join(buildDir, 'icon.png'), png);
  console.log(`wrote build/icon.png (${img.getSize().width}×${img.getSize().height}, ${png.length} bytes)`);

  setTimeout(() => app.exit(0), 100);
});
