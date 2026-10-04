// DeviceBridge - Mobile Phone Companion Controller
(function() {
  let ws = null;
  let items = [];
  let deviceName = 'My Phone';

  // DOM Elements
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const deviceNameLabel = document.getElementById('deviceNameLabel');
  const btnEditDeviceName = document.getElementById('btnEditDeviceName');
  const deviceModal = document.getElementById('deviceModal');
  const deviceNameInput = document.getElementById('deviceNameInput');
  const btnCancelDeviceName = document.getElementById('btnCancelDeviceName');
  const btnSaveDeviceName = document.getElementById('btnSaveDeviceName');

  // Action Inputs & Buttons
  const inputCameraPhoto = document.getElementById('inputCameraPhoto');
  const inputCameraVideo = document.getElementById('inputCameraVideo');
  const inputGalleryMedia = document.getElementById('inputGalleryMedia');
  const inputDocs = document.getElementById('inputDocs');

  const btnSnapPhoto = document.getElementById('btnSnapPhoto');
  const btnRecordVideo = document.getElementById('btnRecordVideo');
  const btnPickGallery = document.getElementById('btnPickGallery');
  const btnPickDocs = document.getElementById('btnPickDocs');
  const btnPasteClipboard = document.getElementById('btnPasteClipboard');
  const btnOpenTextModal = document.getElementById('btnOpenTextModal');

  // Text Modals & Inputs
  const textModal = document.getElementById('textModal');
  const modalTextArea = document.getElementById('modalTextArea');
  const btnCancelTextModal = document.getElementById('btnCancelTextModal');
  const btnSendTextModal = document.getElementById('btnSendTextModal');
  const quickInput = document.getElementById('quickInput');
  const btnQuickSend = document.getElementById('btnQuickSend');

  // Upload Banner
  const uploadBanner = document.getElementById('uploadBanner');
  const uploadBannerText = document.getElementById('uploadBannerText');
  const uploadPercent = document.getElementById('uploadPercent');
  const uploadBarFill = document.getElementById('uploadBarFill');

  // Feed
  const feedList = document.getElementById('feedList');
  const feedCount = document.getElementById('feedCount');
  const emptyState = document.getElementById('emptyState');
  const mobileToast = document.getElementById('mobileToast');

  // Determine initial device name
  function detectInitialDeviceName() {
    const saved = localStorage.getItem('devicebridge_device_name');
    if (saved) return saved;

    const ua = navigator.userAgent;
    if (/iPhone/i.test(ua)) return 'iPhone';
    if (/iPad/i.test(ua)) return 'iPad';
    if (/Android/i.test(ua)) {
      const match = ua.match(/;\s*([^;)]+)\s*Build/);
      if (match && match[1]) return match[1].trim();
      return 'Android Phone';
    }
    return 'Phone Companion';
  }

  deviceName = detectInitialDeviceName();
  deviceNameLabel.textContent = deviceName;

  function vibrate() {
    if ('vibrate' in navigator) {
      try { navigator.vibrate(35); } catch (_) {}
    }
  }

  function showToast(message) {
    mobileToast.textContent = message;
    mobileToast.style.display = 'flex';
    setTimeout(() => {
      mobileToast.style.display = 'none';
    }, 2800);
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

  // Connect WebSocket
  function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${protocol}//${location.host}`);

    ws.onopen = () => {
      statusDot.classList.add('online');
      statusText.textContent = 'Connected to PC';
      ws.send(JSON.stringify({
        type: 'register',
        clientType: 'phone',
        deviceName
      }));
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (err) {
        console.error('WS Parse error:', err);
      }
    };

    ws.onclose = () => {
      statusDot.classList.remove('online');
      statusText.textContent = 'Connecting...';
      setTimeout(connectWebSocket, 3000);
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'init':
        items = msg.payload.items || [];
        renderFeed();
        break;

      case 'new_item':
        items.unshift(msg.payload);
        renderFeed();
        vibrate();
        if (msg.payload.sender !== deviceName) {
          showToast(`📥 Received ${msg.payload.type} from PC`);
        }
        break;

      case 'clipboard_sync':
        vibrate();
        showToast('📋 Clipboard synced from PC');
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

  async function fetchItems() {
    try {
      const res = await fetch('/api/items');
      const data = await res.json();
      items = data.items || [];
      renderFeed();
    } catch (_) {}
  }

  // Send text or link
  async function sendText(text, forceType = null) {
    if (!text || !text.trim()) return;
    try {
      const res = await fetch('/api/items/text', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: text.trim(),
          sender: 'Phone Companion',
          deviceName,
          forceType
        })
      });
      const data = await res.json();
      if (data.success) {
        vibrate();
        showToast('🚀 Sent to PC!');
      }
    } catch (err) {
      showToast('❌ Send failed');
    }
  }

  // Upload files with progress
  function uploadFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    uploadBanner.style.display = 'block';
    uploadBarFill.style.width = '0%';
    uploadPercent.textContent = '0%';
    uploadBannerText.textContent = `Uploading ${fileList.length} item(s)...`;

    const formData = new FormData();
    for (let i = 0; i < fileList.length; i++) {
      formData.append('files', fileList[i]);
    }
    formData.append('sender', 'Phone Companion');
    formData.append('deviceName', deviceName);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/items/upload', true);

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const percent = Math.round((e.loaded / e.total) * 100);
        uploadBarFill.style.width = `${percent}%`;
        uploadPercent.textContent = `${percent}%`;
      }
    };

    xhr.onload = () => {
      uploadBanner.style.display = 'none';
      if (xhr.status === 201) {
        vibrate();
        showToast('✅ Uploaded to PC!');
      } else {
        showToast('❌ Upload failed');
      }
    };

    xhr.onerror = () => {
      uploadBanner.style.display = 'none';
      showToast('❌ Upload error');
    };

    xhr.send(formData);
  }

  // Action Grid Click Handlers
  btnSnapPhoto.addEventListener('click', () => {
    vibrate();
    inputCameraPhoto.click();
  });

  btnRecordVideo.addEventListener('click', () => {
    vibrate();
    inputCameraVideo.click();
  });

  btnPickGallery.addEventListener('click', () => {
    vibrate();
    inputGalleryMedia.click();
  });

  btnPickDocs.addEventListener('click', () => {
    vibrate();
    inputDocs.click();
  });

  // Camera & File Inputs Change Handlers
  [inputCameraPhoto, inputCameraVideo, inputGalleryMedia, inputDocs].forEach(input => {
    input.addEventListener('change', () => {
      if (input.files && input.files.length > 0) {
        uploadFiles(input.files);
        input.value = '';
      }
    });
  });

  // Paste from phone clipboard
  btnPasteClipboard.addEventListener('click', async () => {
    vibrate();
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const text = await navigator.clipboard.readText();
        if (text && text.trim()) {
          await sendText(text.trim(), 'clipboard');
          return;
        }
      }
    } catch (_) {}

    // Fallback: open modal for pasting
    modalTextArea.value = '';
    textModal.style.display = 'flex';
    modalTextArea.focus();
    showToast('Paste text below and tap Send');
  });

  // Send Note/Link Modal
  btnOpenTextModal.addEventListener('click', () => {
    vibrate();
    modalTextArea.value = '';
    textModal.style.display = 'flex';
    modalTextArea.focus();
  });

  btnCancelTextModal.addEventListener('click', () => {
    textModal.style.display = 'none';
  });

  btnSendTextModal.addEventListener('click', async () => {
    const val = modalTextArea.value;
    if (val && val.trim()) {
      await sendText(val.trim());
      textModal.style.display = 'none';
    }
  });

  // Bottom Quick Input
  btnQuickSend.addEventListener('click', async () => {
    const val = quickInput.value;
    if (val && val.trim()) {
      await sendText(val.trim());
      quickInput.value = '';
    }
  });

  quickInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const val = quickInput.value;
      if (val && val.trim()) {
        await sendText(val.trim());
        quickInput.value = '';
      }
    }
  });

  // Device Name Editing
  btnEditDeviceName.addEventListener('click', () => {
    deviceNameInput.value = deviceName;
    deviceModal.style.display = 'flex';
    deviceNameInput.focus();
  });

  btnCancelDeviceName.addEventListener('click', () => {
    deviceModal.style.display = 'none';
  });

  btnSaveDeviceName.addEventListener('click', () => {
    const newName = deviceNameInput.value.trim();
    if (newName) {
      deviceName = newName;
      localStorage.setItem('devicebridge_device_name', newName);
      deviceNameLabel.textContent = newName;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'register',
          clientType: 'phone',
          deviceName
        }));
      }
      deviceModal.style.display = 'none';
      showToast(`Device name: ${newName}`);
    }
  });

  // Render Feed
  function renderFeed() {
    feedCount.textContent = `${items.length} item${items.length === 1 ? '' : 's'}`;

    if (items.length === 0) {
      emptyState.style.display = 'block';
      feedList.innerHTML = '';
      feedList.appendChild(emptyState);
      return;
    }

    emptyState.style.display = 'none';
    feedList.innerHTML = '';

    items.forEach(item => {
      const card = createMobileCard(item);
      feedList.appendChild(card);
    });
  }

  function formatTime(isoString) {
    if (!isoString) return '';
    const d = new Date(isoString);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function createMobileCard(item) {
    const card = document.createElement('div');
    card.className = 'mobile-item-card';

    const isFromPc = (item.sender || '').toLowerCase().includes('pc') || 
                     (item.sender || '').toLowerCase().includes('windows');

    const top = document.createElement('div');
    top.className = 'card-top';
    top.innerHTML = `
      <span class="sender-tag ${isFromPc ? 'from-pc' : 'from-phone'}">
        ${isFromPc ? '🖥️ ' + (item.deviceName || 'Windows PC') : '📱 ' + (item.deviceName || 'Phone')}
      </span>
      <span class="time-tag">${formatTime(item.createdAt)}</span>
    `;
    card.appendChild(top);

    if (item.type === 'photo') {
      const photoDiv = document.createElement('div');
      photoDiv.className = 'mobile-photo-content';
      photoDiv.innerHTML = `<img src="${item.url}" alt="${escapeHtml(item.originalName)}">`;
      card.appendChild(photoDiv);

      const actions = document.createElement('div');
      actions.className = 'card-actions-row';
      actions.innerHTML = `
        <a href="${item.url}?download=1" download="${item.originalName}" class="btn-mobile-action">
          ⬇️ Save Photo
        </a>
      `;
      card.appendChild(actions);

    } else if (item.type === 'video') {
      const videoDiv = document.createElement('div');
      videoDiv.className = 'mobile-video-content';
      videoDiv.innerHTML = `<video src="${item.url}" controls playsinline preload="metadata"></video>`;
      card.appendChild(videoDiv);

      const actions = document.createElement('div');
      actions.className = 'card-actions-row';
      actions.innerHTML = `
        <a href="${item.url}?download=1" download="${item.originalName}" class="btn-mobile-action">
          ⬇️ Save Video
        </a>
      `;
      card.appendChild(actions);

    } else if (item.type === 'file') {
      const fileDiv = document.createElement('div');
      fileDiv.className = 'mobile-file-row';
      fileDiv.innerHTML = `
        <span>📁</span>
        <div class="mobile-file-name">${escapeHtml(item.originalName)}</div>
        <div class="mobile-file-size">${item.formattedSize || ''}</div>
      `;
      card.appendChild(fileDiv);

      const actions = document.createElement('div');
      actions.className = 'card-actions-row';
      actions.innerHTML = `
        <a href="${item.url}?download=1" download="${item.originalName}" class="btn-mobile-action">
          ⬇️ Download File
        </a>
      `;
      card.appendChild(actions);

    } else if (item.type === 'link') {
      const linkDiv = document.createElement('div');
      linkDiv.className = 'mobile-text-content';
      linkDiv.innerHTML = `🔗 <a href="${escapeHtml(item.text)}" target="_blank" style="color:#38bdf8; word-break:break-all;">${escapeHtml(item.text)}</a>`;
      card.appendChild(linkDiv);

      const actions = document.createElement('div');
      actions.className = 'card-actions-row';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-mobile-action';
      copyBtn.innerHTML = '📋 Copy Link';
      copyBtn.addEventListener('click', async () => {
        vibrate();
        await navigator.clipboard.writeText(item.text);
        showToast('Copied to phone clipboard!');
      });
      actions.appendChild(copyBtn);
      card.appendChild(actions);

    } else {
      // Text or clipboard
      const textDiv = document.createElement('div');
      textDiv.className = 'mobile-text-content';
      textDiv.textContent = item.text;
      card.appendChild(textDiv);

      const actions = document.createElement('div');
      actions.className = 'card-actions-row';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'btn-mobile-action';
      copyBtn.innerHTML = '📋 Copy Text';
      copyBtn.addEventListener('click', async () => {
        vibrate();
        await navigator.clipboard.writeText(item.text);
        showToast('Copied to phone clipboard!');
      });
      actions.appendChild(copyBtn);
      card.appendChild(actions);
    }

    return card;
  }

  connectWebSocket();
  fetchItems();
})();
