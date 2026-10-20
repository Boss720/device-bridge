const { test, describe, before, after } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocket } = require('ws');
const { createBridgeApp, categorizeFileType, isUrl, formatBytes } = require('../server');

const TEST_DIR = path.join(__dirname, 'test_storage');

describe('DeviceBridge Core Backend & API Suite', () => {
  let appInstance;
  let server;
  let baseUrl;
  let wsUrl;
  let port;

  before(async () => {
    // Create test storage directory
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
    process.env.STORAGE_DIR = TEST_DIR;

    appInstance = createBridgeApp({ storageDir: TEST_DIR });
    server = appInstance.server;

    await new Promise((resolve) => {
      server.listen(0, '127.0.0.1', () => {
        port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        wsUrl = `ws://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
    // Clean up test storage directory
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  // Helper HTTP request function using native fetch
  async function api(path, options = {}) {
    const res = await fetch(`${baseUrl}${path}`, options);
    let body;
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    return { status: res.status, headers: res.headers, body };
  }

  test('Utility helpers: isUrl, categorizeFileType, formatBytes', () => {
    assert.strictEqual(isUrl('https://example.com'), true);
    assert.strictEqual(isUrl('http://192.168.1.50:53317'), true);
    assert.strictEqual(isUrl('hello world'), false);
    assert.strictEqual(isUrl('ftp://not-supported'), false);

    assert.strictEqual(categorizeFileType('image/jpeg', 'vacation.jpg'), 'photo');
    assert.strictEqual(categorizeFileType('image/png', 'screenshot.png'), 'photo');
    assert.strictEqual(categorizeFileType('video/mp4', 'movie.mp4'), 'video');
    assert.strictEqual(categorizeFileType('video/quicktime', 'clip.mov'), 'video');
    assert.strictEqual(categorizeFileType('application/pdf', 'invoice.pdf'), 'file');
    assert.strictEqual(categorizeFileType('text/plain', 'notes.txt'), 'file');

    assert.strictEqual(formatBytes(0), '0 B');
    assert.strictEqual(formatBytes(1024), '1 KB');
    assert.strictEqual(formatBytes(1024 * 1024 * 5), '5 MB');
  });

  test('GET /api/info returns network info, companion URL, and QR code data URI', async () => {
    const { status, body } = await api('/api/info');
    assert.strictEqual(status, 200);
    assert.ok(body.hostname);
    assert.strictEqual(body.port, port);
    assert.ok(Array.isArray(body.addresses));
    assert.ok(body.companionUrl.startsWith('http://'));
    assert.ok(body.companionUrl.includes('/companion.html'));
    assert.ok(body.qrDataUrl.startsWith('data:image/png;base64,'));
  });

  test('POST /api/items/text shares plain text', async () => {
    const payload = {
      text: 'Meeting notes: discuss design specs tomorrow at 10 AM',
      sender: 'Phone Companion',
      deviceName: 'iPhone 15'
    };

    const { status, body } = await api('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.item.type, 'text');
    assert.strictEqual(body.item.text, payload.text);
    assert.strictEqual(body.item.sender, 'Phone Companion');
    assert.strictEqual(body.item.deviceName, 'iPhone 15');
    assert.ok(body.item.id);
  });

  test('POST /api/items/text auto-detects links', async () => {
    const payload = {
      text: 'https://github.com/bosscube1/NanoForge',
      sender: 'Windows PC',
      deviceName: 'Windows Desktop'
    };

    const { status, body } = await api('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.item.type, 'link');
    assert.strictEqual(body.item.text, payload.text);
  });

  test('POST /api/items/text handles pasted clipboard content', async () => {
    const payload = {
      text: 'const x = 42; // pasted code snippet',
      forceType: 'clipboard',
      sender: 'Windows PC'
    };

    const { status, body } = await api('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.item.type, 'clipboard');
  });

  test('POST /api/items/text validates empty text', async () => {
    const { status, body } = await api('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '   ' })
    });

    assert.strictEqual(status, 400);
    assert.ok(body.error);
  });

  test('POST /api/items/upload transfers photo, video, and general files', async () => {
    // Construct multipart form data
    const formData = new FormData();
    const photoBlob = new Blob(['fake image bytes content'], { type: 'image/jpeg' });
    const videoBlob = new Blob(['fake video stream bytes content'], { type: 'video/mp4' });
    const fileBlob = new Blob(['{"document": "test json"}'], { type: 'application/json' });

    formData.append('files', photoBlob, 'photo_test.jpg');
    formData.append('files', videoBlob, 'video_test.mp4');
    formData.append('files', fileBlob, 'data.json');
    formData.append('sender', 'iPhone');
    formData.append('deviceName', 'iPhone 15 Pro');

    const res = await fetch(`${baseUrl}/api/items/upload`, {
      method: 'POST',
      body: formData
    });

    const body = await res.json();
    assert.strictEqual(res.status, 201);
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.items.length, 3);

    // Verify types
    const photoItem = body.items.find(i => i.originalName === 'photo_test.jpg');
    const videoItem = body.items.find(i => i.originalName === 'video_test.mp4');
    const docItem = body.items.find(i => i.originalName === 'data.json');

    assert.ok(photoItem);
    assert.strictEqual(photoItem.type, 'photo');
    assert.ok(videoItem);
    assert.strictEqual(videoItem.type, 'video');
    assert.ok(docItem);
    assert.strictEqual(docItem.type, 'file');

    // Test downloading file
    const fileRes = await fetch(`${baseUrl}${photoItem.url}`);
    assert.strictEqual(fileRes.status, 200);
    const textData = await fileRes.text();
    assert.strictEqual(textData, 'fake image bytes content');

    // Test Range request on video for streaming
    const rangeRes = await fetch(`${baseUrl}${videoItem.url}`, {
      headers: { Range: 'bytes=0-10' }
    });
    assert.strictEqual(rangeRes.status, 206);
    assert.strictEqual(rangeRes.headers.get('content-range'), `bytes 0-10/${videoItem.size}`);
  });

  test('DELETE /api/items/:id removes item and cleans up disk file', async () => {
    // Upload a temporary file
    const formData = new FormData();
    const blob = new Blob(['temporary file for deletion'], { type: 'text/plain' });
    formData.append('files', blob, 'temp_delete.txt');

    const uploadRes = await fetch(`${baseUrl}/api/items/upload`, {
      method: 'POST',
      body: formData
    });
    const { items: uploadedItems } = await uploadRes.json();
    const tempItem = uploadedItems[0];

    const diskPath = path.join(TEST_DIR, tempItem.fileName);
    assert.strictEqual(fs.existsSync(diskPath), true);

    // Delete item
    const delRes = await fetch(`${baseUrl}/api/items/${tempItem.id}`, { method: 'DELETE' });
    assert.strictEqual(delRes.status, 200);

    // Verify removed from disk
    assert.strictEqual(fs.existsSync(diskPath), false);

    // Verify 404 for subsequent get
    const checkRes = await fetch(`${baseUrl}${tempItem.url}`);
    assert.strictEqual(checkRes.status, 404);
  });

  test('WebSocket real-time cross-device synchronization and clipboard sync', async () => {
    const ws1 = new WebSocket(wsUrl);
    const ws2 = new WebSocket(wsUrl);

    await Promise.all([
      new Promise(r => ws1.on('open', r)),
      new Promise(r => ws2.on('open', r))
    ]);

    // Track received messages on ws2
    const ws2Messages = [];
    ws2.on('message', data => {
      ws2Messages.push(JSON.parse(data.toString()));
    });

    // Register ws1 as Windows Desktop
    ws1.send(JSON.stringify({
      type: 'register',
      clientType: 'windows',
      deviceName: 'Office PC'
    }));

    // Register ws2 as Phone Companion
    ws2.send(JSON.stringify({
      type: 'register',
      clientType: 'phone',
      deviceName: 'Pixel 8'
    }));

    // Wait a brief tick for handshake
    await new Promise(r => setTimeout(r, 100));

    // Test clipboard sync broadcast from Phone (ws2) to Windows (ws1)
    const ws1ClipboardPromise = new Promise((resolve) => {
      ws1.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'clipboard_sync') {
          resolve(msg);
        }
      });
    });

    ws2.send(JSON.stringify({
      type: 'clipboard_sync',
      text: 'SecretPasscode123'
    }));

    const receivedSync = await ws1ClipboardPromise;
    assert.strictEqual(receivedSync.payload.text, 'SecretPasscode123');

    // Test ping-pong
    const pongPromise = new Promise(resolve => {
      ws1.on('message', data => {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'pong') resolve(true);
      });
    });
    ws1.send(JSON.stringify({ type: 'ping' }));
    const pongResult = await pongPromise;
    assert.strictEqual(pongResult, true);

    ws1.close();
    ws2.close();
  });

  test('POST /api/items/upload handles empty file list with 400 error', async () => {
    const formData = new FormData();
    const res = await fetch(`${baseUrl}/api/items/upload`, {
      method: 'POST',
      body: formData
    });
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.ok(body.error);
  });

  test('GET /api/files/:filename handles nonexistent file with 404', async () => {
    const res = await fetch(`${baseUrl}/api/files/does_not_exist_12345.xyz`);
    assert.strictEqual(res.status, 404);
  });

  test('GET /api/files/:filename handles invalid Range header with 416', async () => {
    // First upload a tiny file
    const formData = new FormData();
    formData.append('files', new Blob(['12345']), 'tiny.txt');
    const upRes = await fetch(`${baseUrl}/api/items/upload`, { method: 'POST', body: formData });
    const { items: upItems } = await upRes.json();
    const uploaded = upItems[0];

    // Request byte range beyond file size
    const rangeRes = await fetch(`${baseUrl}${uploaded.url}`, {
      headers: { Range: 'bytes=100-200' }
    });
    assert.strictEqual(rangeRes.status, 416);
  });

  test('DELETE /api/items/:id handles nonexistent ID with 404', async () => {
    const res = await fetch(`${baseUrl}/api/items/random-uuid-999`, { method: 'DELETE' });
    assert.strictEqual(res.status, 404);
  });

  test('DELETE /api/items clears all items', async () => {
    // Ensure at least one item exists
    await api('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: 'Temporary test note' })
    });

    const res = await fetch(`${baseUrl}/api/items`, { method: 'DELETE' });
    assert.strictEqual(res.status, 200);

    const listRes = await fetch(`${baseUrl}/api/items`);
    const listBody = await listRes.json();
    assert.strictEqual(listBody.items.length, 0);
  });

  test('POST /api/items/text handles emojis, code blocks, and multiline text', async () => {
    const text = `🎉 DeviceBridge Cross-Platform Test!\nLine 2 with special chars: <>&"'\n\`\`\`js\nconst greeting = "Hello World! 🚀";\n\`\`\``;
    const { status, body } = await api('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sender: 'Tester', deviceName: 'Laptop' })
    });

    assert.strictEqual(status, 201);
    assert.strictEqual(body.item.text, text);
  });

  test('Accurate MIME Content-Type and Content-Disposition headers on file streaming and download', async () => {
    const formData = new FormData();
    const photoBlob = new Blob(['sample-jpeg-binary'], { type: 'image/jpeg' });
    const videoBlob = new Blob(['sample-mp4-binary-stream'], { type: 'video/mp4' });
    formData.append('files', photoBlob, 'vacation photo.jpg');
    formData.append('files', videoBlob, 'family video.mp4');

    const upRes = await fetch(`${baseUrl}/api/items/upload`, {
      method: 'POST',
      body: formData
    });
    const { items: upItems } = await upRes.json();
    const photo = upItems.find(i => i.originalName === 'vacation photo.jpg');
    const video = upItems.find(i => i.originalName === 'family video.mp4');

    // 1. Verify photo Content-Type
    const photoStreamRes = await fetch(`${baseUrl}${photo.url}`);
    assert.strictEqual(photoStreamRes.status, 200);
    assert.ok(photoStreamRes.headers.get('content-type').includes('image/jpeg'));

    // 2. Verify photo download Content-Disposition
    const photoDlRes = await fetch(`${baseUrl}${photo.url}?download=1`);
    assert.strictEqual(photoDlRes.status, 200);
    const photoDisp = photoDlRes.headers.get('content-disposition');
    assert.ok(photoDisp);
    assert.ok(photoDisp.includes('attachment'));
    assert.ok(photoDisp.includes('filename*=UTF-8\'\''));

    // 3. Verify video Range request Content-Type and Content-Range
    const videoStreamRes = await fetch(`${baseUrl}${video.url}`, {
      headers: { Range: 'bytes=0-5' }
    });
    assert.strictEqual(videoStreamRes.status, 206);
    assert.ok(videoStreamRes.headers.get('content-type').includes('video/mp4'));
    assert.strictEqual(videoStreamRes.headers.get('content-range'), `bytes 0-5/${video.size}`);
  });

  test('Upload handles pasted screenshot blob without explicit filename or extension', async () => {
    const formData = new FormData();
    const screenshotBlob = new Blob(['png-screenshot-bytes'], { type: 'image/png' });
    // Simulate mobile browser or clipboard upload with name 'blob'
    formData.append('files', screenshotBlob, 'blob');

    const upRes = await fetch(`${baseUrl}/api/items/upload`, {
      method: 'POST',
      body: formData
    });
    const { items: upItems } = await upRes.json();
    assert.strictEqual(upItems.length, 1);
    const item = upItems[0];
    assert.strictEqual(item.type, 'photo');
    assert.ok(item.fileName.endsWith('.png'));
    assert.ok(item.originalName.endsWith('.png'));

    // Verify it streams with image/png
    const streamRes = await fetch(`${baseUrl}${item.url}`);
    assert.strictEqual(streamRes.status, 200);
    assert.ok(streamRes.headers.get('content-type').includes('image/png'));
  });

  test('Metadata persistence across server restart', async () => {
    // Post an item
    const note = `Persistent note ${Date.now()}`;
    await api('/api/items/text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: note, sender: 'Windows' })
    });

    // Create a second app instance pointing to the same TEST_DIR
    const secondApp = createBridgeApp({ storageDir: TEST_DIR });
    const secondServer = secondApp.server;

    await new Promise((resolve) => {
      secondServer.listen(0, '127.0.0.1', resolve);
    });
    const secondPort = secondServer.address().port;

    const listRes = await fetch(`http://127.0.0.1:${secondPort}/api/items`);
    const listData = await listRes.json();
    const found = listData.items.some(i => i.text === note);

    await new Promise((resolve) => secondServer.close(resolve));
    assert.ok(found, 'Item should persist in second app instance initialized from same storageDir');
  });

  test('DELETE /api/items (Clear All) cleans up stored files on disk', async () => {
    // Upload a test file
    const formData = new FormData();
    const blob = new Blob(['cleanup test content'], { type: 'text/plain' });
    formData.append('files', blob, 'cleanup_file.txt');

    const upRes = await fetch(`${baseUrl}/api/items/upload`, {
      method: 'POST',
      body: formData
    });
    const { items: upItems } = await upRes.json();
    const uploaded = upItems[0];
    const diskPath = path.join(TEST_DIR, uploaded.fileName);
    assert.strictEqual(fs.existsSync(diskPath), true);

    // Call Clear All
    const clearRes = await fetch(`${baseUrl}/api/items`, { method: 'DELETE' });
    assert.strictEqual(clearRes.status, 200);

    // Verify file is unlinked on disk
    assert.strictEqual(fs.existsSync(diskPath), false);
  });

  test('WebSocket clipboard_sync with saveToFeed adds clipboard item to feed and broadcasts new_item', async () => {
    const wsClient1 = new WebSocket(wsUrl);
    const wsClient2 = new WebSocket(wsUrl);

    await Promise.all([
      new Promise(r => wsClient1.on('open', r)),
      new Promise(r => wsClient2.on('open', r))
    ]);

    const ws2Events = [];
    wsClient2.on('message', data => {
      ws2Events.push(JSON.parse(data.toString()));
    });

    const clipText = 'Synced clipboard text with save to feed!';
    wsClient1.send(JSON.stringify({
      type: 'clipboard_sync',
      text: clipText,
      saveToFeed: true
    }));

    await new Promise(r => setTimeout(r, 100));

    wsClient1.close();
    wsClient2.close();

    // Verify received clipboard_sync and new_item
    const hasSync = ws2Events.some(e => e.type === 'clipboard_sync' && e.payload.text === clipText);
    const hasNewItem = ws2Events.some(e => e.type === 'new_item' && e.payload.type === 'clipboard' && e.payload.text === clipText);

    assert.ok(hasSync, 'Should broadcast clipboard_sync');
    assert.ok(hasNewItem, 'Should broadcast new_item when saveToFeed is true');

    // Verify item is in list
    const itemsRes = await api('/api/items');
    assert.ok(itemsRes.body.items.some(i => i.text === clipText && i.type === 'clipboard'));
  });
});

