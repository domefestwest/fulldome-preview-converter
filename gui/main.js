const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs");
const { spawn, execFileSync } = require("child_process");

const isDev = process.env.NODE_ENV !== "production" && !app.isPackaged;

// ---------------------------------------------------------------------------
// FFmpeg / Python resolution
// ---------------------------------------------------------------------------

function findBinary(name) {
  const resourcesDir = app.isPackaged
    ? path.join(process.resourcesPath, "bin")
    : path.join(__dirname, "..", "bin");

  const candidates = [
    path.join(resourcesDir, name),
    path.join(resourcesDir, name + ".exe"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return name; // fall back to system PATH
}

function findPython() {
  for (const p of ["python3", "python"]) {
    try {
      execFileSync(p, ["--version"], { stdio: "ignore" });
      return p;
    } catch {}
  }
  return "python3";
}

function findConvertScript() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, "convert.py");
  }
  return path.join(__dirname, "..", "convert.py");
}

// Extensions readable directly by Electron/Chromium without FFmpeg
const BROWSER_IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".bmp", ".webp"]);

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 820,
    height: 820,
    minWidth: 720,
    minHeight: 700,
    backgroundColor: "#1a1a1a",
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "default",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5274");
  } else {
    mainWindow.loadFile(path.join(__dirname, "dist", "index.html"));
  }

  // Prevent Electron from navigating to dropped files
  mainWindow.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// ---------------------------------------------------------------------------
// IPC: file operations
// ---------------------------------------------------------------------------

ipcMain.handle("browse-file", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select fulldome file",
    filters: [
      {
        name: "Fulldome Files",
        extensions: [
          "mp4","mov","m4v","avi","mkv","mxf","mts","m2ts","webm","flv","wmv","3gp","mpg","mpeg","ts","dv",
          "jpg","jpeg","png","tif","tiff","exr","dpx","tga","bmp","webp","psd",
        ],
      },
      {
        name: "Video Files",
        extensions: ["mp4","mov","m4v","avi","mkv","mxf","mts","m2ts","webm","flv","wmv","3gp","mpg","mpeg","ts","dv"],
      },
      {
        name: "Image Files",
        extensions: ["jpg","jpeg","png","tif","tiff","exr","dpx","tga","bmp","webp","psd"],
      },
    ],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("browse-output-dir", async (_evt, defaultPath, fileType) => {
  const isImage = fileType === "image";
  const filters = isImage
    ? [
        { name: "JPEG Image", extensions: ["jpg"] },
        { name: "PNG Image",  extensions: ["png"] },
        { name: "TIFF Image", extensions: ["tif"] },
      ]
    : [{ name: "MP4 Video", extensions: ["mp4"] }];

  const result = await dialog.showSaveDialog(mainWindow, {
    title: "Save preview as…",
    defaultPath,
    filters,
  });
  if (result.canceled) return null;
  return result.filePath;
});

ipcMain.handle("probe-file", async (_evt, filePath) => {
  const ffprobe = findBinary("ffprobe");
  return new Promise((resolve) => {
    const proc = spawn(ffprobe, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height,duration,r_frame_rate,codec_name",
      "-show_entries", "format=duration",
      "-of", "json",
      filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d) => (out += d));
    proc.on("close", () => {
      try {
        const data = JSON.parse(out);
        const s = data.streams?.[0] ?? {};
        const duration = parseFloat(s.duration || data.format?.duration || 0);
        resolve({ width: s.width, height: s.height, codec: s.codec_name, fps: s.r_frame_rate, duration });
      } catch {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
});

ipcMain.handle("open-file", async (_evt, filePath) => {
  shell.openPath(filePath);
});

ipcMain.handle("open-folder", async (_evt, filePath) => {
  shell.showItemInFolder(filePath);
});

// Read an image file and return base64 data URL, or null on error
function readImageAsDataURL(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mime = ext === ".png" ? "image/png"
               : ext === ".bmp" ? "image/bmp"
               : ext === ".webp" ? "image/webp"
               : "image/jpeg";
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// Extract a single frame at a given time offset (seconds). Falls back to 0s if seek fails.
async function extractFrameAt(filePath, seekSeconds) {
  const ffmpeg = findBinary("ffmpeg");
  return new Promise((resolve) => {
    const args = [
      "-ss", String(seekSeconds),
      "-i", filePath,
      "-vframes", "1",
      "-vf", "scale=1920:1920:flags=lanczos",
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-q:v", "4",
      "pipe:1",
    ];
    const proc = spawn(ffmpeg, args);
    const chunks = [];
    proc.stdout.on("data", (d) => chunks.push(d));
    proc.on("close", (code) => {
      if (code === 0 && chunks.length) {
        const b64 = Buffer.concat(chunks).toString("base64");
        resolve(`data:image/jpeg;base64,${b64}`);
      } else {
        resolve(null);
      }
    });
    proc.on("error", () => resolve(null));
  });
}

ipcMain.handle("extract-frame", async (_evt, filePath) => {
  const ext = path.extname(filePath).toLowerCase();

  // For browser-renderable images, read the file directly (no FFmpeg needed)
  if (BROWSER_IMAGE_EXTS.has(ext)) {
    return readImageAsDataURL(filePath);
  }

  // For other image formats (EXR, DPX, TIFF, TGA, PSD) or video, use FFmpeg
  // Video: try 5s first, fall back to 0s for short clips
  let result = await extractFrameAt(filePath, 5);
  if (!result) result = await extractFrameAt(filePath, 0);
  return result;
});

ipcMain.handle("scrub-frame", async (_evt, filePath, seekSeconds) => {
  return extractFrameAt(filePath, seekSeconds);
});

ipcMain.handle("confirm-overwrite", async (_evt, filePath) => {
  if (!fs.existsSync(filePath)) return true;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "File already exists",
    message: `"${path.basename(filePath)}" already exists. Replace it?`,
    buttons: ["Replace", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  return response === 0;
});

// ---------------------------------------------------------------------------
// IPC: conversion
// ---------------------------------------------------------------------------

let activeConversion = null;

ipcMain.handle("start-conversion", async (_evt, opts) => {
  const {
    inputPath,
    outputPath,
    resolution,
    sweetSpot,
    pipSize,
    pipMargin,
    pipPosition,
    audio,
    crf,
    scale,
    hPan,
    pipEnabled,
    bitrateKbps,
    burninTitle,
    burninFilename,
    burninFramenumber,
    burninCorner,
    cropMode,
    trimStart,
    trimEnd,
    slateTitle,
    slateCreator,
    slateYear,
    watermarkPath,
    watermarkCorner,
    watermarkOpacity,
    watermarkSize,
    hwAccel,
  } = opts;

  const python = findPython();
  const script = findConvertScript();

  const args = [
    script,
    "--input",        inputPath,
    "--output",       outputPath,
    "--resolution",   resolution,
    "--sweet-spot",   String(sweetSpot),
    "--pip-size",     String(pipSize),
    "--pip-margin",   String(pipMargin),
    "--pip-position", pipPosition,
    "--scale",        String(scale ?? 1.0),
    "--h-pan",        String(hPan ?? 50),
  ];

  if (pipEnabled === false) args.push("--no-pip");

  // Quality: either CRF or manual bitrate
  if (bitrateKbps) {
    args.push("--bitrate", String(bitrateKbps));
  } else {
    args.push("--crf", String(crf ?? 18));
  }

  // Audio (not applicable for image inputs, but harmless to pass — convert.py ignores it)
  if (audio) args.push("--audio", audio);

  // Burn-in overlays
  if (burninTitle) args.push("--burnin-title", burninTitle);
  if (burninFilename) args.push("--burnin-filename");
  if (burninFramenumber) args.push("--burnin-framenumber");
  if (burninCorner) args.push("--burnin-corner", burninCorner);

  // Crop mode
  if (cropMode) args.push("--crop-mode", cropMode);

  // Trim
  if (trimStart && trimStart > 0) args.push("--trim-start", String(trimStart));
  if (trimEnd != null) args.push("--trim-end", String(trimEnd));

  // Slate
  if (slateTitle) args.push("--slate-title", slateTitle);
  if (slateCreator) args.push("--slate-creator", slateCreator);
  if (slateYear) args.push("--slate-year", slateYear);

  // Watermark
  if (watermarkPath) {
    args.push("--watermark", watermarkPath);
    args.push("--watermark-corner", watermarkCorner || "br");
    args.push("--watermark-opacity", String(watermarkOpacity ?? 80));
    args.push("--watermark-size", String(watermarkSize ?? 15));
  }

  // GPU acceleration (default on — pass flag only to disable)
  if (hwAccel === false) args.push("--no-hw-accel");

  const proc = spawn(python, args, { stdio: ["ignore", "pipe", "pipe"] });
  activeConversion = proc;

  let errorBuf = "";

  proc.stdout.on("data", (chunk) => {
    const text = chunk.toString();
    const matches = text.match(/Progress:\s*(\d+)%/g) || [];
    for (const m of matches) {
      const pct = parseInt(m.match(/\d+/)[0], 10);
      mainWindow?.webContents.send("conversion-progress", { pct });
    }
  });

  proc.stderr.on("data", (chunk) => {
    errorBuf += chunk.toString();
  });

  proc.on("close", (code) => {
    activeConversion = null;
    if (code === 0) {
      mainWindow?.webContents.send("conversion-done", { outputPath });
    } else {
      mainWindow?.webContents.send("conversion-error", {
        message: errorBuf || `Process exited with code ${code}`,
      });
    }
  });

  proc.on("error", (err) => {
    activeConversion = null;
    const isNotFound = err.code === "ENOENT";
    mainWindow?.webContents.send("conversion-error", {
      message: isNotFound
        ? `Python not found. Install Python 3.10+ and ensure it's on your PATH.`
        : err.message,
    });
  });

  return { pid: proc.pid };
});

ipcMain.handle("cancel-conversion", () => {
  if (activeConversion) {
    activeConversion.kill("SIGTERM");
    activeConversion = null;
  }
});

ipcMain.handle("browse-watermark", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select watermark image",
    filters: [
      { name: "Image Files", extensions: ["png", "jpg", "jpeg", "svg", "bmp", "webp"] },
    ],
    properties: ["openFile"],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("browse-files", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Select fulldome files",
    filters: [
      {
        name: "Fulldome Files",
        extensions: [
          "mp4","mov","m4v","avi","mkv","mxf","mts","m2ts","webm","flv","wmv","3gp","mpg","mpeg","ts","dv",
          "jpg","jpeg","png","tif","tiff","exr","dpx","tga","bmp","webp","psd",
        ],
      },
    ],
    properties: ["openFile", "multiSelections"],
  });
  if (result.canceled || !result.filePaths.length) return [];
  return result.filePaths;
});
