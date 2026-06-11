// Electron main process — Data Pirates desktop app.
// Starts the Express server (native ffmpeg, no upload) in-process and loads the
// app from http://localhost:3001. Everything runs locally → instant analysis.

const { app, BrowserWindow, shell, dialog } = require('electron');
const path = require('path');
const http = require('http');
const { fork } = require('child_process');

const PORT = 3001;
const isDev = !app.isPackaged;

// In a packaged build, app code lives in resources/app(.asar). server.js sits at
// the project root next to this electron/ folder.
const ROOT = path.join(__dirname, '..');
const SERVER_PATH = path.join(ROOT, 'server.js');

let serverProc = null;
let mainWindow = null;

function startServer() {
  // Desktop serves the relative-base build from dist-desktop
  const env = { ...process.env, STATIC_DIR: 'dist-desktop' };
  serverProc = fork(SERVER_PATH, [], {
    cwd: ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  serverProc.stdout?.on('data', (d) => console.log('[server]', d.toString().trim()));
  serverProc.stderr?.on('data', (d) => console.error('[server]', d.toString().trim()));
  serverProc.on('exit', (code) => console.log('[server] exited', code));
}

// Poll until the server answers, then resolve
function waitForServer(timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(`http://localhost:${PORT}/api/ping`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('Server did not start in time'));
        else setTimeout(tick, 300);
      });
    };
    tick();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0a0a0a',
    title: 'Data Pirates',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Open external links in the system browser, not inside the app
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(`http://localhost:${PORT}/`);
  if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

app.whenReady().then(async () => {
  startServer();
  try {
    await waitForServer();
  } catch (err) {
    dialog.showErrorBox('Startup failed', `Could not start the local server.\n\n${err.message}`);
    app.quit();
    return;
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('quit', () => {
  try { serverProc?.kill(); } catch {}
});
