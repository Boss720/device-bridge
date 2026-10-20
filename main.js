const { app, BrowserWindow, ipcMain, shell, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { createBridgeApp, DEFAULT_PORT } = require('./server');

let mainWindow = null;
let bridgeServer = null;
let serverPort = DEFAULT_PORT;
let storageDir = '';

function getAppStorageDir() {
  if (process.env.STORAGE_DIR) {
    return process.env.STORAGE_DIR;
  }
  try {
    const downloadsDir = app.getPath('downloads');
    const targetDir = path.join(downloadsDir, 'DeviceBridge');
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    return targetDir;
  } catch (_) {
    try {
      const userDataDir = app.getPath('userData');
      const targetDir = path.join(userDataDir, 'received_files');
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      return targetDir;
    } catch (_) {
      return path.join(process.cwd(), 'received_files');
    }
  }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const appStorage = getAppStorageDir();
    const { server, STORAGE_DIR } = createBridgeApp({ storageDir: appStorage });
    bridgeServer = server;
    storageDir = STORAGE_DIR;

    server.listen(DEFAULT_PORT, '0.0.0.0', () => {
      serverPort = server.address().port;
      console.log(`Bridge server listening on port ${serverPort}`);
      resolve(serverPort);
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        console.warn(`Port ${DEFAULT_PORT} in use, picking random port...`);
        server.listen(0, '0.0.0.0', () => {
          serverPort = server.address().port;
          console.log(`Bridge server listening on dynamic port ${serverPort}`);
          resolve(serverPort);
        });
      } else {
        reject(err);
      }
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 840,
    minHeight: 580,
    title: 'DeviceBridge - Seamless Cross-Device Transfer',
    backgroundColor: '#090d16',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    autoHideMenuBar: true
  });

  mainWindow.loadURL(`http://localhost:${serverPort}`);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// IPC Handlers
ipcMain.handle('reveal-in-folder', async (event, filename) => {
  if (!filename) return false;
  const fullPath = path.join(storageDir, path.basename(filename));
  if (fs.existsSync(fullPath)) {
    shell.showItemInFolder(fullPath);
    return true;
  }
  return false;
});

ipcMain.handle('open-folder', async () => {
  if (fs.existsSync(storageDir)) {
    shell.openPath(storageDir);
    return true;
  }
  return false;
});

ipcMain.handle('read-clipboard', async () => {
  return clipboard.readText();
});

ipcMain.handle('read-clipboard-image', async () => {
  const img = clipboard.readImage();
  if (!img.isEmpty()) {
    const pngBuffer = img.toPNG();
    return {
      mime: 'image/png',
      dataUrl: img.toDataURL(),
      base64: pngBuffer.toString('base64'),
      size: pngBuffer.length
    };
  }
  return null;
});

ipcMain.handle('write-clipboard', async (event, text) => {
  if (typeof text === 'string') {
    clipboard.writeText(text);
    return true;
  }
  return false;
});

ipcMain.handle('show-notification', async (event, { title, body }) => {
  if (Notification.isSupported()) {
    new Notification({
      title: title || 'DeviceBridge',
      body: body || ''
    }).show();
    return true;
  }
  return false;
});

ipcMain.handle('get-server-info', async () => {
  return {
    port: serverPort,
    storageDir
  };
});

app.whenReady().then(async () => {
  try {
    await startServer();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  } catch (err) {
    console.error('Fatal initialization error:', err);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (bridgeServer) {
      bridgeServer.close();
    }
    app.quit();
  }
});
