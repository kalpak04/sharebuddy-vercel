// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('select-folder'),
  saveFile: (folder, filename, fileBuffer) => ipcRenderer.invoke('save-file', folder, filename, fileBuffer),
  checkDiskSpace: (folderPath) => ipcRenderer.invoke('check-disk-space', folderPath),
  streamFile: (folder, filename) => ipcRenderer.invoke('stream-file', folder, filename),
  streamChunk: (filePath, chunk) => ipcRenderer.invoke('stream-chunk', filePath, chunk),
  endStream: (filePath) => ipcRenderer.invoke('end-stream', filePath)
});
