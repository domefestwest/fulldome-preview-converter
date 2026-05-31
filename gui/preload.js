const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("api", {
  // Static info
  platform: process.platform,

  // File operations
  extractFrame: (filePath) => ipcRenderer.invoke("extract-frame", filePath),
  scrubFrame: (filePath, seekSeconds) => ipcRenderer.invoke("scrub-frame", filePath, seekSeconds),
  browseFile: () => ipcRenderer.invoke("browse-file"),
  browseOutputDir: (defaultPath) => ipcRenderer.invoke("browse-output-dir", defaultPath),
  probeFile: (filePath) => ipcRenderer.invoke("probe-file", filePath),
  openFile: (filePath) => ipcRenderer.invoke("open-file", filePath),
  openFolder: (filePath) => ipcRenderer.invoke("open-folder", filePath),
  confirmOverwrite: (filePath) => ipcRenderer.invoke("confirm-overwrite", filePath),

  // Conversion
  startConversion: (opts) => ipcRenderer.invoke("start-conversion", opts),
  cancelConversion: () => ipcRenderer.invoke("cancel-conversion"),

  // Progress / events from main → renderer
  onProgress: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on("conversion-progress", handler);
    return () => ipcRenderer.removeListener("conversion-progress", handler);
  },
  onConversionDone: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on("conversion-done", handler);
    return () => ipcRenderer.removeListener("conversion-done", handler);
  },
  onConversionError: (cb) => {
    const handler = (_evt, data) => cb(data);
    ipcRenderer.on("conversion-error", handler);
    return () => ipcRenderer.removeListener("conversion-error", handler);
  },
});
