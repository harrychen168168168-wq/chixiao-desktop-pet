const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('resetApi', {
  initial: () => ipcRenderer.invoke('resets:initial'),
  refresh: () => ipcRenderer.invoke('resets:refresh'),
  savePreferences: value => ipcRenderer.invoke('public:resets-save', value),
  connectClaude: () => ipcRenderer.invoke('resets:claude-login'),
  close: ids => ipcRenderer.send('resets:close', ids),
  open: url => ipcRenderer.send('resets:open-url', url),
  onState: cb => ipcRenderer.on('resets:state', (_e, s) => cb(s)),
  onClose: cb => ipcRenderer.on('resets:request-close', cb),
});
