const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openFile: () => ipcRenderer.invoke('dialog:open'),
  saveFile: (options) => ipcRenderer.invoke('dialog:save', options),
  saveToPath: (options) => ipcRenderer.invoke('file:save', options),
  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return null;
    }
  },
  generateHtmlPdf: (options) => ipcRenderer.invoke('generate:html', options),
  generateDocxPdf: (options) => ipcRenderer.invoke('generate:docx', options),
  onMenuOpen: (callback) => ipcRenderer.on('menu-open', callback),
  onMenuGenerate: (callback) => ipcRenderer.on('menu-generate', callback),
  onMenuSave: (callback) => ipcRenderer.on('menu-save', callback),
  onMenuSaveAs: (callback) => ipcRenderer.on('menu-save-as', callback),
});
