const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopBridge', {
  isElectron: true,
  revealInFolder: (filename) => ipcRenderer.invoke('reveal-in-folder', filename),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  readClipboard: () => ipcRenderer.invoke('read-clipboard'),
  writeClipboard: (text) => ipcRenderer.invoke('write-clipboard', text),
  showNotification: (options) => ipcRenderer.invoke('show-notification', options),
  getServerInfo: () => ipcRenderer.invoke('get-server-info')
});
