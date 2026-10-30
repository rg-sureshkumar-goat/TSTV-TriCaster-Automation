// The bridge between the producer screen and the rest of the app: the screen gets the app's state and
// sends the producer's actions, and nothing else.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('showApp', {
  onState(listener) {
    const handler = (_event, state) => listener(state);
    ipcRenderer.on('state', handler);
    ipcRenderer.send('ready');
    return () => ipcRenderer.off('state', handler);
  },
  /** The level of the sound going to the TC1 in live mode, in dB. */
  onLevel(listener) {
    const handler = (_event, db) => listener(db);
    ipcRenderer.on('level', handler);
    return () => ipcRenderer.off('level', handler);
  },
  act(action) {
    return ipcRenderer.invoke('action', action);
  },
  /** The file on disk for a file dropped on the screen. */
  pathOf(file) {
    return webUtils.getPathForFile(file);
  },
});
