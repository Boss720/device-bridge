// DeviceBridge - Windows Desktop Controller
(function() {
  let ws = null;
  let items = [];
  let currentFilter = 'all';
  let serverInfo = null;
  let autoClipboardInterval = null;
  let lastCopiedText = '';

  // Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const phoneCount = document.getElementById('phoneCount');
  const btnPairingModal = document.getElementById('btnPairingModal');
  const btnClosePairingModal = document.getElementById('btnClosePairingModal');
  const pairingModal = document.getElementById('pairingModal');
  const qrImage = document.getElementById('qrImage');
  const companionUrlInput = document.getElementById('companionUrlInput');
  const btnCopyUrl = document.getElementById('btnCopyUrl');
  const btnOpenFolder = document.getElementById('btnOpenFolder');

  // Composer
  const tabButtons = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');
  const textContent = document.getElementById('textContent');
  const btnSendText = document.getElementById('btnSendText');
  const btnPasteToSend = document.getElementById('btnPasteToSend');

  // Media
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const btnBrowseFiles = document.getElementById('btnBrowseFiles');
  const btnBrowseMedia = document.getElementById('btnBrowseMedia');
  const uploadProgressWrap = document.getElementById('uploadProgressWrap');
  const uploadProgressFill = document.getElementById('uploadProgressFill');
  const uploadStatusText = document.getElementById('uploadStatusText');
  const uploadPercentText = document.getElementById('uploadPercentText');

  // Clipboard
  const chkAutoClipboard = document.getElementById('chkAutoClipboard');
  const btnPushCurrentClipboard = document.getElementById('btnPushCurrentClipboard');

  // Feed
  const feedList = document.getElementById('feedList');
  const feedCount = document.getElementById('feedCount');
  const emptyState = document.getElementById('emptyState');
  const filterButtons = document.querySelectorAll('.filter-btn');
  const btnClearAll = document.getElementById('btnClearAll');

  // Lightbox
  const lightboxModal = document.getElementById('lightboxModal');
  const lightboxImg = document.getElementById('lightboxImg');
  const lightboxCaption = document.getElementById('lightboxCaption');
  const lightboxDownloadBtn = document.getElementById('lightboxDownloadBtn');
  const lightboxRevealBtn = document.getElementById('lightboxRevealBtn');
  const btnCloseLightbox = document.getElementById('btnCloseLightbox');

  // Audio ping synthesized via Web Audio API
  function playNotificationChime() {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
      osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.12); // A5
      gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (_) {}
  }

  // Toast Notification
  function showToast(message, type = 'info') {
    const stack = document.getElementById('toastStack');
    const toast = document.createElement('div');
    toast.className = `toast ${type === 'success' ? 'toast-success' : ''}`;
    toast.innerHTML = `<span>${type === 'success' ? '✅' : '⚡'}</span> <div>${escapeHtml(message)}</div>`;
    stack.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str.toString()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Native notification helper
  function triggerSystemNotification(title, body) {
    if (window.desktopBridge && window.desktopBridge.showNotification) {
      window.desktopBridge.showNotification({ title, body });
    } else if (Notification.permission === 'granted') {
      new Notification(title, { body });
    }
  }

  // Initialize Connection
  async function init() {
    try {
      const res = await fetch('/api/info');
      serverInfo = await res.json();
      qrImage.src = serverInfo.qrDataUrl;
      companionUrlInput.value = serverInfo.companionUrl;
      connectWebSocket();
      fetchItems();
    } catch (err) {
      console.error('Failed to load server info:', err);
      statusText.textContent = 'Server Offline';
      statusDot.classList.remove('online');
    }
  }

  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      statusDot.classList.add('online');
      statusText.textContent = 'Online';
      ws.send(JSON.stringify({
        type: 'register',
        clientType: 'windows',
        deviceName: (serverInfo && serverInfo.hostname) ? serverInfo.hostname : 'Windows PC'
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleSocketMessage(msg);
      } catch (err) {
        console.error('Socket message parse error:', err);
      }
    };

    ws.onclose = () => {
      statusDot.classList.remove('online');
      statusText.textContent = 'Reconnecting...';
      setTimeout(connectWebSocket, 3000);
    };
  }

  function handleSocketMessage(msg) {
    switch (msg.type) {
      case 'init':
        items = msg.payload.items || [];
        updatePhoneCount(msg.payload.connectedDevicesCount);
        renderFeed();
        break;

      case 'new_item':
        items.unshift(msg.payload);
        renderFeed();
        playNotificationChime();
        const sender = msg.payload.sender || 'Phone';
        const typeLabel = msg.payload.type.toUpperCase();
        showToast(`New ${typeLabel} received from ${sender}`, 'success');
        triggerSystemNotification(`DeviceBridge: New ${typeLabel}`, `Received from ${sender}`);
        break;

      case 'clipboard_sync':
        handleReceivedClipboard(msg.payload.text, msg.payload.from);
        break;

      case 'devices_updated':
      case 'device_joined':
      case 'device_left':
        updatePhoneCount(msg.payload.connectedDevicesCount);
        break;

      case 'item_deleted':
        items = items.filter(i => i.id !== msg.payload.id);
        renderFeed();
        break;

      case 'items_cleared':
        items = [];
        renderFeed();
        break;
    }
  }

  function updatePhoneCount(count) {
    const safeCount = Math.max(0, (count || 1) - 1); // Exclude self
    phoneCount.textContent = safeCount;
  }

  async function fetchItems() {
    try {
      const res = await fetch('/api/items');
      const data = await res.json();
      items = data.items || [];
      renderFeed();
    } catch (e) {
      console.error('Failed to fetch items:', e);
    }
  }

  // Tab switching
  tabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      tabButtons.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById(btn.dataset.tab).classList.add('active');
    });
  });

  // Filter switching
  filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      filterButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderFeed();
    });
  });

  // Send Text / Link
  async function sendTextItem(text, forceType = null) {
    if (!text || !text.trim()) return;
    try {
      const res = await fetch('/api/items/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          sender: 'Windows PC',
          deviceName: (serverInfo && serverInfo.hostname) || 'Windows Desktop',
          forceType
        })
      });
      const data = await res.json();
      if (data.success) {
        textContent.value = '';
        showToast('Sent to phone companion', 'success');
      }
    } catch (err) {
      showToast('Failed to send text: ' + err.message);
    }
  }

  btnSendText.addEventListener('click', () => {
    sendTextItem(textContent.value);
  });

  // Paste & Send
  async function pasteAndSend() {
    let clipboardText = '';
    if (window.desktopBridge && window.desktopBridge.readClipboard) {
      clipboardText = await window.desktopBridge.readClipboard();
    } else {
      try {
        clipboardText = await navigator.clipboard.readText();
      } catch (_) {}
    }

    if (clipboardText && clipboardText.trim()) {
      sendTextItem(clipboardText.trim());
    } else {
      showToast('Clipboard is empty or does not contain text');
    }
  }

  btnPasteToSend.addEventListener('click', pasteAndSend);

  // Global Ctrl+V to paste into text input or trigger send
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      if (document.activeElement !== textContent) {
        // If not already typing in the textarea, focus it
        textContent.focus();
      }
    }
  });

  // Upload Files, Photos, Videos
  async function uploadFiles(files) {
    if (!files || files.length === 0) return;

    uploadProgressWrap.style.display = 'block';
    uploadProgressFill.style.width = '0%';
    uploadPercentText.textContent = '0%';
    uploadStatusText.textContent = `Uploading ${files.length} item(s)...`;

    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('files', files[i]);
    }
    formData.append('sender', 'Windows PC');
    formData.append('deviceName', (serverInfo && serverInfo.hostname) || 'Windows Desktop');

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/items/upload', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        uploadProgressFill.style.width = `${percent}%`;
        uploadPercentText.textContent = `${percent}%`;
      }
    };

    xhr.onload = () => {
      uploadProgressWrap.style.display = 'none';
      if (xhr.status === 201) {
        showToast(`Successfully uploaded ${files.length} item(s)`, 'success');
      } else {
        showToast('Upload failed');
      }
      fileInput.value = '';
    };

    xhr.onerror = () => {
      uploadProgressWrap.style.display = 'none';
      showToast('Upload failed due to network error');
      fileInput.value = '';
    };

    xhr.send(formData);
  }

  // Dropzone drag & drop
  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dragover');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    uploadFiles(files);
  });

  btnBrowseFiles.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.removeAttribute('accept');
    fileInput.click();
  });

  btnBrowseMedia.addEventListener('click', (e) => {
    e.stopPropagation();
    fileInput.setAttribute('accept', 'image/*,video/*');
    fileInput.click();
  });

  fileInput.addEventListener('change', () => {
    uploadFiles(fileInput.files);
  });

  // Clipboard Auto-Mirroring
  async function checkClipboardChange() {
    let current = '';
    if (window.desktopBridge && window.desktopBridge.readClipboard) {
      current = await window.desktopBridge.readClipboard();
    }
    if (current && current.trim() && current !== lastCopiedText) {
      lastCopiedText = current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'clipboard_sync',
          text: current
        }));
        showToast('Clipboard synced to phone companion', 'info');
      }
    }
  }

  chkAutoClipboard.addEventListener('change', () => {
    if (chkAutoClipboard.checked) {
      autoClipboardInterval = setInterval(checkClipboardChange, 1200);
      showToast('Clipboard auto-mirroring enabled');
    } else {
      if (autoClipboardInterval) clearInterval(autoClipboardInterval);
      showToast('Clipboard auto-mirroring disabled');
    }
  });

  btnPushCurrentClipboard.addEventListener('click', async () => {
    let text = '';
    if (window.desktopBridge && window.desktopBridge.readClipboard) {
      text = await window.desktopBridge.readClipboard();
    } else {
      try {
        text = await navigator.clipboard.readText();
      } catch (_) {}
    }
    if (text && text.trim()) {
      sendTextItem(text.trim(), 'clipboard');
    } else {
      showToast('PC clipboard is empty');
    }
  });

  async function handleReceivedClipboard(text, from) {
    if (!text) return;
    if (window.desktopBridge && window.desktopBridge.writeClipboard) {
      await window.desktopBridge.writeClipboard(text);
      showToast(`Clipboard updated from ${from}!`, 'success');
      playNotificationChime();
    }
  }

  // Render Feed
  function renderFeed() {
    let filtered = items;
    if (currentFilter !== 'all') {
      if (currentFilter === 'text') {
        filtered = items.filter(i => i.type === 'text' || i.type === 'link' || i.type === 'clipboard');
      } else {
        filtered = items.filter(i => i.type === currentFilter);
      }
    }

    feedCount.textContent = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;

    if (filtered.length === 0) {
      emptyState.style.display = 'block';
      feedList.innerHTML = '';
      feedList.appendChild(emptyState);
      return;
    }

    emptyState.style.display = 'none';
    feedList.innerHTML = '';

    filtered.forEach(item => {
      const card = createItemCard(item);
      feedList.appendChild(card);
    });
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'item-card';

    const isFromPhone = (item.sender || '').toLowerCase().includes('phone') || 
                        (item.sender || '').toLowerCase().includes('companion') ||
                        (item.sender || '').toLowerCase().includes('ios') ||
                        (item.sender || '').toLowerCase().includes('android');

    const header = document.createElement('div');
    header.className = 'item-card-header';
    header.innerHTML = `
      <div class="item-origin">
        <span class="sender-pill ${isFromPhone ? 'from-phone' : 'from-pc'}">
          ${isFromPhone ? '📱 ' + (item.deviceName || 'Phone') : '🖥️ ' + (item.deviceName || 'Windows PC')}
        </span>
        <span class="item-time">${formatTime(item.createdAt)}</span>
      </div>
      <div class="item-card-actions">
        <button class="btn-icon-subtle btn-delete" title="Delete">🗑️</button>
      </div>
    `;

    // Delete action
    header.querySelector('.btn-delete').addEventListener('click', async () => {
      await deleteItem(item.id);
    });

    card.appendChild(header);

    // Body based on type
    const body = document.createElement('div');
    body.className = 'item-card-body';

    if (item.type === 'photo') {
      body.innerHTML = `
        <div class="item-photo-preview" title="Click to view full photo">
          <img src="${item.url}" alt="${escapeHtml(item.originalName)}">
        </div>
        <div class="file-info-bar">
          <div class="file-meta-name">
            <span class="file-icon-badge">🖼️</span>
            <div>
              <div class="file-name-text">${escapeHtml(item.originalName)}</div>
              <div class="file-size-text">${item.formattedSize || ''}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-secondary btn-reveal">Reveal</button>
            <a href="${item.url}?download=1" download="${item.originalName}" class="btn-secondary">Download</a>
          </div>
        </div>
      `;

      body.querySelector('.item-photo-preview').addEventListener('click', () => {
        openLightbox(item);
      });
      body.querySelector('.btn-reveal').addEventListener('click', () => {
        revealFile(item.fileName);
      });

    } else if (item.type === 'video') {
      body.innerHTML = `
        <div class="item-video-preview">
          <video src="${item.url}" controls playsinline preload="metadata"></video>
        </div>
        <div class="file-info-bar">
          <div class="file-meta-name">
            <span class="file-icon-badge">🎥</span>
            <div>
              <div class="file-name-text">${escapeHtml(item.originalName)}</div>
              <div class="file-size-text">${item.formattedSize || ''}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-secondary btn-reveal">Reveal</button>
            <a href="${item.url}?download=1" download="${item.originalName}" class="btn-secondary">Download</a>
          </div>
        </div>
      `;

      body.querySelector('.btn-reveal').addEventListener('click', () => {
        revealFile(item.fileName);
      });

    } else if (item.type === 'file') {
      body.innerHTML = `
        <div class="file-info-bar">
          <div class="file-meta-name">
            <span class="file-icon-badge">📁</span>
            <div>
              <div class="file-name-text">${escapeHtml(item.originalName)}</div>
              <div class="file-size-text">${item.formattedSize || ''}</div>
            </div>
          </div>
          <div style="display:flex; gap:6px;">
            <button class="btn-secondary btn-reveal">Reveal</button>
            <a href="${item.url}?download=1" download="${item.originalName}" class="btn-secondary">Download</a>
          </div>
        </div>
      `;

      body.querySelector('.btn-reveal').addEventListener('click', () => {
        revealFile(item.fileName);
      });

    } else if (item.type === 'link') {
      body.innerHTML = `
        <div class="link-preview-box">
          <a href="${escapeHtml(item.text)}" target="_blank" rel="noopener noreferrer" class="link-anchor">
            <span>🔗</span> ${escapeHtml(item.text)}
          </a>
          <button class="btn-secondary btn-copy-link">Copy</button>
        </div>
      `;

      body.querySelector('.btn-copy-link').addEventListener('click', () => {
        copyText(item.text);
      });

    } else {
      // Plain text or clipboard
      body.innerHTML = `
        <div class="item-text-body">${escapeHtml(item.text)}</div>
        <div style="display:flex; justify-content:flex-end; margin-top:8px;">
          <button class="btn-secondary btn-copy-text">📋 Copy to Clipboard</button>
        </div>
      `;

      body.querySelector('.btn-copy-text').addEventListener('click', () => {
        copyText(item.text);
      });
    }

    card.appendChild(body);
    return card;
  }

  async function copyText(text) {
    if (window.desktopBridge && window.desktopBridge.writeClipboard) {
      await window.desktopBridge.writeClipboard(text);
    } else {
      await navigator.clipboard.writeText(text);
    }
    showToast('Copied to Windows clipboard!', 'success');
  }

  async function revealFile(fileName) {
    if (window.desktopBridge && window.desktopBridge.revealInFolder) {
      const ok = await window.desktopBridge.revealInFolder(fileName);
      if (ok) return;
    }
    // Fallback via server API
    try {
      await fetch('/api/open-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: fileName })
      });
    } catch (_) {}
  }

  async function deleteItem(id) {
    try {
      const res = await fetch(`/api/items/${id}`, { method: 'DELETE' });
      if (res.ok) {
        items = items.filter(i => i.id !== id);
        renderFeed();
        showToast('Item deleted');
      }
    } catch (err) {
      showToast('Failed to delete item');
    }
  }

  // Clear all
  btnClearAll.addEventListener('click', async () => {
    if (items.length === 0) return;
    if (confirm('Clear all transferred items from feed?')) {
      try {
        await fetch('/api/items', { method: 'DELETE' });
        items = [];
        renderFeed();
        showToast('All items cleared');
      } catch (e) {
        showToast('Failed to clear items');
      }
    }
  });

  // Open Folder
  btnOpenFolder.addEventListener('click', async () => {
    if (window.desktopBridge && window.desktopBridge.openFolder) {
      await window.desktopBridge.openFolder();
      return;
    }
    try {
      await fetch('/api/open-folder', { method: 'POST' });
    } catch (_) {}
  });

  // Lightbox Modal
  function openLightbox(item) {
    lightboxImg.src = item.url;
    lightboxCaption.textContent = `${item.originalName} (${item.formattedSize || ''})`;
    lightboxDownloadBtn.href = `${item.url}?download=1`;
    lightboxDownloadBtn.setAttribute('download', item.originalName);
    lightboxRevealBtn.onclick = () => revealFile(item.fileName);
    lightboxModal.style.display = 'flex';
  }

  btnCloseLightbox.addEventListener('click', () => {
    lightboxModal.style.display = 'none';
  });

  lightboxModal.addEventListener('click', (e) => {
    if (e.target === lightboxModal) {
      lightboxModal.style.display = 'none';
    }
  });

  // Pairing Modal
  btnPairingModal.addEventListener('click', () => {
    pairingModal.style.display = 'flex';
  });

  btnClosePairingModal.addEventListener('click', () => {
    pairingModal.style.display = 'none';
  });

  pairingModal.addEventListener('click', (e) => {
    if (e.target === pairingModal) {
      pairingModal.style.display = 'none';
    }
  });

  btnCopyUrl.addEventListener('click', () => {
    copyText(companionUrlInput.value);
  });

  // Request browser notification permission if available
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  init();
})();
