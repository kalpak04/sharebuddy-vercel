// See the Electron documentation for details on how to use preload scripts:
// https://www.electronjs.org/docs/latest/tutorial/process-model#preload-scripts

const { contextBridge, ipcRenderer } = require('electron');
const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs').promises;

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld(
  'electron',
  {
    ipcRenderer: {
      invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
      on: (channel, func) => {
        ipcRenderer.on(channel, (event, ...args) => func(...args));
      },
      removeAllListeners: (channel) => {
        ipcRenderer.removeAllListeners(channel);
      }
    }
  }
);

// Expose safe versions of Node.js modules
contextBridge.exposeInMainWorld('nodeFtp', {
  createClient: () => new ftp.Client(),
  // Add any specific FTP methods you need
});

contextBridge.exposeInMainWorld('nodePath', {
  join: (...args) => path.join(...args),
  resolve: (...args) => path.resolve(...args),
  dirname: (p) => path.dirname(p),
  basename: (p) => path.basename(p)
});

contextBridge.exposeInMainWorld('nodeFs', {
  readFile: (path) => fs.readFile(path),
  writeFile: (path, data) => fs.writeFile(path, data),
  mkdir: (path) => fs.mkdir(path, { recursive: true }),
  readdir: (path) => fs.readdir(path),
  stat: (path) => fs.stat(path)
});
