const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Menu events from main process
  onMenuNewPost: (callback) => ipcRenderer.on('menu-new-post', callback),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onMenuOpenPost: (callback) => ipcRenderer.on('menu-open-post', callback),
  onMenuSettings: (callback) => ipcRenderer.on('menu-settings', callback),
  onMenuDashboard: (callback) => ipcRenderer.on('menu-dashboard', callback),

  // Window title
  setTitle: (title) => ipcRenderer.send('set-title', title),

  // Config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),

  // Native file dialog for images
  showImageDialog: () => ipcRenderer.invoke('show-image-dialog'),
});
