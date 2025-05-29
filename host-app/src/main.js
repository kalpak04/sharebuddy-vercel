const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const path = require('node:path');
const fs = require('fs');
const { promisify } = require('util');
const checkDiskSpace = require('check-disk-space').default;

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
  app.quit();
}

const createWindow = () => {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
    },
  });

  // and load the index.html of the app.
  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);

  // Open the DevTools.
  mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.

// Add IPC handler for folder selection
ipcMain.handle('select-folder', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

// Add IPC handler to save files to disk when requested by the renderer process
ipcMain.handle('save-file', async (event, folder, filename, fileBuffer) => {
  try {
    const filePath = path.join(folder, filename);
    // fileBuffer may be a base64 string or ArrayBuffer; handle both
    let buffer;
    if (typeof fileBuffer === 'string') {
      buffer = Buffer.from(fileBuffer, 'base64');
    } else {
      buffer = Buffer.from(fileBuffer);
    }
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch (err) {
    console.error('Error saving file:', err);
    return false;
  }
});

// Add IPC handler to check disk space
ipcMain.handle('check-disk-space', async (event, folderPath) => {
  try {
    if (!folderPath) return null;
    const space = await checkDiskSpace(folderPath);
    return {
      free: space.free,
      total: space.size,
      available: space.free
    };
  } catch (err) {
    console.error('Error checking disk space:', err);
    return null;
  }
});

// Add IPC handler for streaming file writes
ipcMain.handle('stream-file', async (event, folder, filename) => {
  try {
    const filePath = path.join(folder, filename);
    const writeStream = fs.createWriteStream(filePath);
    
    // Store the write stream in a map using the filePath as key
    if (!global.writeStreams) global.writeStreams = new Map();
    global.writeStreams.set(filePath, writeStream);
    
    return { success: true, filePath };
  } catch (err) {
    console.error('Error creating write stream:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('stream-chunk', async (event, filePath, chunk) => {
  try {
    const writeStream = global.writeStreams.get(filePath);
    if (!writeStream) throw new Error('No write stream found for file');
    
    return new Promise((resolve, reject) => {
      writeStream.write(Buffer.from(chunk), (err) => {
        if (err) reject(err);
        else resolve({ success: true });
      });
    });
  } catch (err) {
    console.error('Error writing chunk:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('end-stream', async (event, filePath) => {
  try {
    const writeStream = global.writeStreams.get(filePath);
    if (!writeStream) throw new Error('No write stream found for file');
    
    await new Promise((resolve, reject) => {
      writeStream.end((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    
    global.writeStreams.delete(filePath);
    return { success: true };
  } catch (err) {
    console.error('Error ending write stream:', err);
    return { success: false, error: err.message };
  }
});
