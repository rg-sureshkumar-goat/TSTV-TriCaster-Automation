// The show app (RiGster)'s window. Everything the app does happens in Runtime; this file opens the window, hands
// the producer's actions to it, and sends its state back to the window.
import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Action } from '../shared/api.ts';
import { Runtime } from './runtime.ts';
import { Store } from './store.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
let win: BrowserWindow | null = null;

/** The app's name, shown wherever the app is (RG, Oct 30, 2026). */
const APP_NAME = 'RiGster';
// The app keeps what it remembers in the folder it used before it was renamed, so nothing is lost.
app.setPath('userData', path.join(app.getPath('appData'), '@tstv', 'show-app'));
app.setName(APP_NAME);
app.setAboutPanelOptions({ applicationName: APP_NAME });

const runtime = new Runtime({
  // Tests keep their own memory (TSTV_SHOW_APP_DATA), so they never change yours.
  store: new Store(process.env.TSTV_SHOW_APP_DATA ?? path.join(app.getPath('userData'), 'tstv')),
  pickFiles: async () => {
    const result = await dialog.showOpenDialog(win!, {
      title: 'Import graphics',
      buttonLabel: 'Import',
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [{ name: 'Graphics and clips', extensions: ['mov', 'mp4', 'm4v', 'mxf', 'avi', 'png', 'jpg', 'jpeg', 'tif', 'tiff'] }],
    });
    return result.canceled ? [] : result.filePaths;
  },
  pickFile: async () => {
    const result = await dialog.showOpenDialog(win!, { title: 'Choose the file', properties: ['openFile'] });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  },
  recordingsFolder: app.getPath('videos'),
  pickRecording: async (suggested) => {
    const result = await dialog.showSaveDialog(win!, {
      title: 'Name the recording and choose where to save it',
      buttonLabel: 'Record',
      defaultPath: suggested,
      filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  },
});

/** Sends the app's state to the window, unless it's already closed. */
const show = (state: unknown) => {
  if (win && !win.isDestroyed()) win.webContents.send('state', state);
};
runtime.on('state', show);
// The Sound meter's level in live mode, ten times a second, apart from the state.
runtime.on('level', (db: number) => {
  if (win && !win.isDestroyed()) win.webContents.send('level', db);
});
ipcMain.on('ready', () => show(runtime.state()));
ipcMain.handle('action', (_event, action: Action) => runtime.act(action));

app.whenReady().then(async () => {
  win = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    title: APP_NAME,
    backgroundColor: '#14161a',
    // The Program box plays clips with their sound as they go on air, without a click first.
    webPreferences: { preload: path.join(root, 'preload.cjs'), contextIsolation: true, sandbox: true, autoplayPolicy: 'no-user-gesture-required' },
  });
  await win.loadFile(path.join(root, 'dist/renderer/index.html'));
  await runtime.start();
});

app.on('window-all-closed', () => {
  win = null;
  runtime.close();
  app.quit();
});
