const express = require('express');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const multer = require('multer');
const QRCode = require('qrcode');
const cors = require('cors');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { exec } = require('child_process');

// Configuration
const DEFAULT_PORT = process.env.PORT || 53317;
let STORAGE_DIR = process.env.STORAGE_DIR;
if (!STORAGE_DIR) {
  try {
    const electron = require('electron');
    const electronApp = electron.app || (electron.remote && electron.remote.app);
    if (electronApp && typeof electronApp.getPath === 'function') {
      STORAGE_DIR = path.join(electronApp.getPath('downloads'), 'DeviceBridge');
    }
  } catch (_) {}
}
if (!STORAGE_DIR) {
  STORAGE_DIR = path.join(process.cwd(), 'received_files');
}

// Ensure storage directory exists
try {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
} catch (e) {
  // Silent fallback if running in read-only environment
}

// In-memory store fallback
let defaultItems = [];

// Helper: Format bytes into human readable string
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper: MIME type mapping
const MIME_TYPES = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json',
  '.zip': 'application/zip',
  '.tar': 'application/x-tar',
  '.gz': 'application/gzip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
};

function getMimeType(filePathOrName) {
  const ext = path.extname(filePathOrName).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function getExtFromMime(mime) {
  if (!mime) return '';
  for (const [ext, m] of Object.entries(MIME_TYPES)) {
    if (m === mime) return ext;
  }
  if (mime.startsWith('image/')) return '.' + mime.split('/')[1].replace('jpeg', 'jpg');
  if (mime.startsWith('video/')) return '.' + mime.split('/')[1];
  return '';
}

// Helper: Detect local network IPs
function getLocalNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];

  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      // IPv4, not internal loopback, not link-local (169.254.x.x)
      if (iface.family === 'IPv4' && !iface.internal && !iface.address.startsWith('169.254.')) {
        addresses.push({
          interface: name,
          ip: iface.address
        });
      }
    }
  }

  // Prioritize physical Wi-Fi / Ethernet, deprioritize virtual/tunnel adapters
  addresses.sort((a, b) => {
    const score = (addr) => {
      let s = 0;
      const lowerName = addr.interface.toLowerCase();
      const ip = addr.ip;

      // Penalize virtual / VPN adapters
      if (/tailscale|vethernet|virtual|vmware|wsl|hyper-v|docker|tap|tun/i.test(lowerName)) {
        s -= 100;
      }
      // Prioritize Wi-Fi and physical LAN
      if (/wi-fi|wifi|wireless|wlan/i.test(lowerName)) {
        s += 60;
      } else if (/ethernet|local area connection/i.test(lowerName)) {
        s += 40;
      }

      // Private LAN addresses
      if (ip.startsWith('192.168.')) s += 20;
      else if (ip.startsWith('10.')) s += 15;
      else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) s += 10;

      return s;
    };

    return score(b) - score(a);
  });

  return addresses;
}

// Helper: Detect if string is a URL
function isUrl(string) {
  try {
    const url = new URL(string.trim());
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

// Helper: Categorize mime types
function categorizeFileType(mimetype = '', originalName = '') {
  const ext = path.extname(originalName).toLowerCase();
  if (mimetype.startsWith('image/') || ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg', '.heic', '.ico'].includes(ext)) {
    return 'photo';
  }
  if (mimetype.startsWith('video/') || ['.mp4', '.webm', '.mov', '.mkv', '.avi', '.m4v'].includes(ext)) {
    return 'video';
  }
  return 'file';
}

const { execFile } = require('child_process');

function createBridgeApp(customOptions = {}) {
  const storageDir = customOptions.storageDir || process.env.STORAGE_DIR || STORAGE_DIR;
  if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true });
  }

  // Scoped store of shared items with persistence
  const metaFilePath = path.join(storageDir, 'items_meta.json');
  let items = [];
  if (fs.existsSync(metaFilePath)) {
    try {
      const data = JSON.parse(fs.readFileSync(metaFilePath, 'utf8'));
      if (Array.isArray(data)) {
        items = data.filter(it => {
          if (it.fileName) {
            return fs.existsSync(path.join(storageDir, it.fileName));
          }
          return true;
        });
      }
    } catch (_) {
      items = [];
    }
  }

  function saveItemsMeta() {
    try {
      fs.writeFileSync(metaFilePath, JSON.stringify(items, null, 2), 'utf8');
    } catch (err) {
      console.error('Failed to write items metadata:', err);
    }
  }

  const app = express();
  const server = http.createServer(app);
  const wss = new WebSocketServer({ server });

  app.use(cors());
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Static files for desktop and companion web apps
  app.use(express.static(path.join(__dirname, 'public')));

  // Multer storage configuration
  const storage = multer.diskStorage({
    destination: (req, file, cb) => {
      cb(null, storageDir);
    },
    filename: (req, file, cb) => {
      const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e6);
      let ext = path.extname(file.originalname);
      if (!ext) {
        ext = getExtFromMime(file.mimetype) || '';
      }
      let baseName = path.basename(file.originalname, path.extname(file.originalname))
        .replace(/[^a-zA-Z0-9_\u00C0-\u024F\u1E00-\u1EFF\u0400-\u04FF\u4E00-\u9FFF\u3040-\u30FF\-]/g, '_')
        .trim();
      if (!baseName || baseName === '_' || /^_+$/.test(baseName)) {
        baseName = file.mimetype.startsWith('image/') ? 'photo' : (file.mimetype.startsWith('video/') ? 'video' : 'upload');
      }
      cb(null, `${baseName}-${uniqueSuffix}${ext}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 2000 * 1024 * 1024 } // 2 GB limit per file
  });

  // WebSocket connections tracking
  const connectedClients = new Map();

  function broadcast(type, payload, excludeClientId = null) {
    const msg = JSON.stringify({ type, payload, timestamp: Date.now() });
    for (const [id, client] of connectedClients.entries()) {
      if (id !== excludeClientId && client.ws.readyState === WebSocket.OPEN) {
        try {
          client.ws.send(msg);
        } catch (err) {
          console.error(`Error sending message to client ${id}:`, err);
        }
      }
    }
  }

  wss.on('connection', (ws, req) => {
    const clientId = uuidv4();
    const clientInfo = {
      id: clientId,
      ws,
      type: 'unknown',
      deviceName: 'Device',
      connectedAt: Date.now()
    };
    connectedClients.set(clientId, clientInfo);

    // Initial greeting with items and device list
    ws.send(JSON.stringify({
      type: 'init',
      payload: {
        clientId,
        items,
        connectedDevicesCount: connectedClients.size
      }
    }));

    broadcast('device_joined', {
      connectedDevicesCount: connectedClients.size,
      deviceId: clientId
    }, clientId);

    ws.on('message', (messageRaw) => {
      try {
        const msg = JSON.parse(messageRaw.toString());
        if (msg.type === 'register') {
          clientInfo.type = msg.clientType || 'companion';
          clientInfo.deviceName = msg.deviceName || 'Phone';
          broadcast('devices_updated', {
            connectedDevicesCount: connectedClients.size,
            devices: Array.from(connectedClients.values()).map(c => ({
              id: c.id,
              type: c.type,
              deviceName: c.deviceName
            }))
          });
        } else if (msg.type === 'clipboard_sync') {
          // Received live clipboard text from one device to forward
          const text = msg.text;
          const from = clientInfo.deviceName || 'Companion';

          if (msg.saveToFeed && text && typeof text === 'string' && text.trim().length > 0) {
            const clipItem = {
              id: uuidv4(),
              type: 'clipboard',
              text: text.trim(),
              createdAt: new Date().toISOString(),
              sender: from,
              deviceName: from
            };
            items.unshift(clipItem);
            saveItemsMeta();
            broadcast('new_item', clipItem);
          }

          broadcast('clipboard_sync', {
            text,
            from
          }, clientId);
        } else if (msg.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch (e) {
        console.error('Error parsing WS message:', e);
      }
    });

    ws.on('close', () => {
      connectedClients.delete(clientId);
      broadcast('device_left', {
        connectedDevicesCount: connectedClients.size,
        deviceId: clientId
      });
    });
  });

  // API: Get Server and Network Info with QR Code
  app.get('/api/info', async (req, res) => {
    try {
      const addresses = getLocalNetworkAddresses();
      const port = server.address() ? server.address().port : DEFAULT_PORT;
      const hostname = os.hostname();
      const preferredIp = addresses.length > 0 ? addresses[0].ip : '127.0.0.1';
      const companionUrl = `http://${preferredIp}:${port}/companion.html`;

      // Generate QR Code as Data URI
      const qrDataUrl = await QRCode.toDataURL(companionUrl, {
        errorCorrectionLevel: 'M',
        margin: 2,
        width: 320,
        color: {
          dark: '#0f172a',
          light: '#ffffff'
        }
      });

      res.json({
        hostname,
        port,
        addresses,
        preferredIp,
        companionUrl,
        qrDataUrl,
        connectedDevicesCount: connectedClients.size,
        storageDir
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // API: Get all shared items
  app.get('/api/items', (req, res) => {
    res.json({ items });
  });

  // API: Share text, links, or pasted clipboard content
  app.post('/api/items/text', (req, res) => {
    const { text, sender = 'Windows', deviceName = 'PC', forceType } = req.body;
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return res.status(400).json({ error: 'Text content is required' });
    }

    const trimmed = text.trim();
    let type = forceType || 'text';
    if (!forceType && isUrl(trimmed)) {
      type = 'link';
    }

    const item = {
      id: uuidv4(),
      type,
      text: trimmed,
      createdAt: new Date().toISOString(),
      sender,
      deviceName
    };

    items.unshift(item);
    saveItemsMeta();
    broadcast('new_item', item);
    res.status(201).json({ success: true, item });
  });

  // API: Upload files, photos, videos
  app.post('/api/items/upload', (req, res) => {
    upload.array('files')(req, res, (err) => {
      if (err) {
        console.error('Upload middleware error:', err);
        return res.status(400).json({ error: err.message || 'File upload failed' });
      }

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded' });
      }

      const sender = req.body.sender || 'Companion';
      const deviceName = req.body.deviceName || 'Phone';
      const newItems = [];

      for (const file of req.files) {
        const itemType = categorizeFileType(file.mimetype, file.originalname);
        let origName = file.originalname;
        if (!origName || origName === 'blob' || origName === 'blob.bin') {
          const ext = path.extname(file.filename) || (itemType === 'photo' ? '.png' : '.bin');
          origName = (itemType === 'photo' ? `photo_${Date.now()}` : `file_${Date.now()}`) + ext;
        }

        const item = {
          id: uuidv4(),
          type: itemType,
          fileName: file.filename,
          originalName: origName,
          size: file.size,
          formattedSize: formatBytes(file.size),
          mimetype: file.mimetype || getMimeType(file.filename),
          url: `/api/files/${encodeURIComponent(file.filename)}`,
          createdAt: new Date().toISOString(),
          sender,
          deviceName
        };
        items.unshift(item);
        newItems.push(item);
        broadcast('new_item', item);
      }

      saveItemsMeta();
      res.status(201).json({ success: true, items: newItems });
    });
  });

  // API: Stream or download file with range request support (important for video streaming)
  app.get('/api/files/:filename', (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(storageDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'File not found' });
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Resolve accurate mime type and original download name
    const item = items.find(it => it.fileName === filename);
    const resolvedMime = req.query.mime || (item && item.mimetype) || getMimeType(filename);
    const originalDownloadName = req.query.name || (item && item.originalName) || filename;

    // Support HTTP 206 for video and audio streaming
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize) {
        res.status(416).send('Requested range not satisfiable\n' + start + ' >= ' + fileSize);
        return;
      }

      const chunksize = (end - start) + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      const head = {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': resolvedMime,
      };
      res.writeHead(206, head);
      fileStream.pipe(res);
    } else {
      const head = {
        'Content-Length': fileSize,
        'Content-Type': resolvedMime,
      };
      if (req.query.download === '1') {
        const safeAsciiName = originalDownloadName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
        const encodedName = encodeURIComponent(originalDownloadName).replace(/['()]/g, escape).replace(/\*/g, '%2A');
        head['Content-Disposition'] = `attachment; filename="${safeAsciiName}"; filename*=UTF-8''${encodedName}`;
      }
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // API: Reveal or open file in Windows File Explorer
  app.post('/api/open-file', (req, res) => {
    const { filename } = req.body;
    if (!filename) {
      return res.status(400).json({ error: 'Filename is required' });
    }
    const safeFilename = path.basename(filename);
    const fullPath = path.join(storageDir, safeFilename);

    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'File not found on disk' });
    }

    if (process.platform === 'win32') {
      execFile('explorer.exe', [`/select,${fullPath}`], (err) => {
        if (err && err.code !== 1) { // explorer.exe sometimes exits with code 1 even on success
          console.error('Error opening explorer:', err);
          return res.status(500).json({ error: 'Failed to open file explorer' });
        }
        res.json({ success: true, path: fullPath });
      });
    } else {
      res.json({ success: true, path: fullPath, note: 'Platform is not win32' });
    }
  });

  // API: Open storage directory in Windows File Explorer
  app.post('/api/open-folder', (req, res) => {
    if (process.platform === 'win32') {
      execFile('explorer.exe', [storageDir], (err) => {
        if (err && err.code !== 1) {
          console.error('Error opening folder:', err);
          return res.status(500).json({ error: 'Failed to open storage directory' });
        }
        res.json({ success: true, path: storageDir });
      });
    } else {
      res.json({ success: true, path: storageDir });
    }
  });

  // API: Delete an item
  app.delete('/api/items/:id', (req, res) => {
    const { id } = req.params;
    const index = items.findIndex(item => item.id === id);
    if (index === -1) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const [deletedItem] = items.splice(index, 1);

    // If it's a file, remove from disk
    if (deletedItem.fileName) {
      const filePath = path.join(storageDir, deletedItem.fileName);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.error('Failed to delete file from disk:', e);
        }
      }
    }

    saveItemsMeta();
    broadcast('item_deleted', { id });
    res.json({ success: true, deletedItem });
  });

  // API: Clear all items and remove stored files
  app.delete('/api/items', (req, res) => {
    for (const item of items) {
      if (item.fileName) {
        const filePath = path.join(storageDir, item.fileName);
        if (fs.existsSync(filePath)) {
          try {
            fs.unlinkSync(filePath);
          } catch (e) {
            console.error('Failed to unlink file during clear:', e);
          }
        }
      }
    }
    items = [];
    saveItemsMeta();
    broadcast('items_cleared', {});
    res.json({ success: true });
  });

  return { app, server, wss, items, storageDir, STORAGE_DIR: storageDir };
}

// If executed directly
if (require.main === module) {
  const { server } = createBridgeApp();
  const PORT = process.env.PORT || DEFAULT_PORT;
  server.listen(PORT, '0.0.0.0', () => {
    const addresses = getLocalNetworkAddresses();
    console.log(`=======================================================`);
    console.log(`⚡ DeviceBridge Server Running!`);
    console.log(`🖥️  Local Windows App: http://localhost:${PORT}`);
    if (addresses.length > 0) {
      console.log(`📱 Phone Companion:    http://${addresses[0].ip}:${PORT}/companion.html`);
    }
    console.log(`📁 Files Storage:       ${STORAGE_DIR}`);
    console.log(`=======================================================`);
  });
}

module.exports = {
  createBridgeApp,
  getLocalNetworkAddresses,
  isUrl,
  categorizeFileType,
  formatBytes,
  DEFAULT_PORT,
  STORAGE_DIR
};
