// Minimal preload — exposes a flag so the web UI can tell it's running inside
// the desktop app (used to hide the "Install App" banner).
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('dataPiratesDesktop', {
  isDesktop: true,
  version: process.versions.electron,
});
