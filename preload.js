const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('claudeBar', {
  onState: (cb) => {
    const handler = (_e, snap) => cb(snap);
    ipcRenderer.on('state', handler);
    return () => ipcRenderer.removeListener('state', handler);
  },
  getState: () => ipcRenderer.invoke('get-state'),
  refresh: () => ipcRenderer.invoke('refresh'),
  refreshForce: () => ipcRenderer.invoke('refresh-force'),
  hide: () => ipcRenderer.invoke('hide'),
  quit: () => ipcRenderer.invoke('quit'),
  openExternal: (url) => ipcRenderer.invoke('open-external', url),
});
