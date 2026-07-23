import { useState, useEffect, useRef } from "react";
import styles from "./App.module.css";
import ToggleGroup from "./components/ToggleGroup.jsx";
import Slider from "./components/Slider.jsx";
import PipPositionPicker from "./components/PipPositionPicker.jsx";
import ProgressBar from "./components/ProgressBar.jsx";
import Preview from "./components/Preview.jsx";

const AUTO_PIP = { "4k": 480, "1080p": 270 };
const PIP_MAX  = { "4k": 2160, "1080p": 1080 };

const CRF_PRESETS = [
  { value: "draft",    label: "Draft",    crf: 26 },
  { value: "standard", label: "Standard", crf: 18 },
  { value: "high",     label: "High",     crf: 12 },
  { value: "manual",   label: "Manual",   crf: null },
];

const CROP_MODE_OPTIONS = [
  { value: "16:9", label: "16:9 Widescreen" },
  { value: "9:16", label: "9:16 Vertical" },
  { value: "1:1",  label: "1:1 Square" },
];

const IMAGE_EXTS = new Set([
  "jpg","jpeg","png","tif","tiff","exr","dpx","tga","bmp","webp","psd",
]);

function getFileType(filePath) {
  const ext = filePath.split(".").pop().toLowerCase();
  return IMAGE_EXTS.has(ext) ? "image" : "video";
}

function getOutputDims(resolution, cropMode) {
  const base = resolution === "4k" ? 2160 : 1080;
  if (cropMode === "16:9") return { w: base * 16 / 9, h: base };
  if (cropMode === "9:16") return { w: base, h: base * 16 / 9 };
  return { w: base, h: base }; // 1:1
}

const DEFAULT_STATE = {
  resolution:        "4k",
  cropMode:          "16:9",
  sweetSpot:         30,
  pipSize:           480,
  pipEnabled:        true,
  pipMargin:         40,
  pipPosition:       "br",
  audio:             "stereo",
  quality:           "standard",
  scale:             100,
  hPan:              50,
  bitrateKbps:       20000,
  burninEnabled:     false,
  burninTitle:       "",
  burninFilename:    false,
  burninFramenumber: false,
  burninCorner:      "bl",
  outputImageFormat: "jpg",
  // Trim
  trimStart:         0,
  trimEnd:           null,
  // Slate
  slateEnabled:      false,
  slateTitle:        "",
  slateCreator:      "",
  slateYear:         "",
  // Watermark
  watermarkEnabled:  false,
  watermarkPath:     "",
  watermarkCorner:   "br",
  watermarkOpacity:  80,
  watermarkSize:     15,
  // Filename template
  filenameTemplate:  "{filename}_{resolution}_{cropmode}_preview",
  // Hardware acceleration
  hwAccel:           true,
  // Color tag (Rec.709)
  colorTagBt709:     true,
  // Audio loudness normalization: "none" | "-23" | "-14"
  loudnorm:          "none",
  // Poster frame export
  posterFrameEnabled: false,
  // System notifications when conversion done
  enableNotifications: true,
};

// Settings keys owned by each tab — used by the per-tab Reset button.
const TAB_SETTINGS = {
  framing: ["resolution", "cropMode", "sweetSpot", "hPan", "scale", "pipSize"],
  pip:     ["pipEnabled", "pipSize", "pipMargin", "pipPosition"],
  export:  [
    "audio", "quality", "bitrateKbps", "hwAccel",
    "burninEnabled", "burninTitle", "burninFilename", "burninFramenumber", "burninCorner",
    "slateEnabled", "slateTitle", "slateCreator", "slateYear",
    "watermarkEnabled", "watermarkPath", "watermarkCorner", "watermarkOpacity", "watermarkSize",
    "outputImageFormat", "filenameTemplate",
    "colorTagBt709", "loudnorm", "posterFrameEnabled", "enableNotifications",
  ],
};

const BUILTIN_PRESETS = {
  "🌟 Quick Teaser": {
    cropMode: "9:16", trimStart: 0, trimEnd: 30,
    watermarkEnabled: false, slateEnabled: true,
    slateTitle: "", slateCreator: "", slateYear: "",
  },
  "🌟 Festival Submission": {
    resolution: "4k", cropMode: "16:9", quality: "high",
    hwAccel: true, colorTagBt709: true, loudnorm: "-23",
    slateEnabled: true, slateTitle: "", slateCreator: "", slateYear: "",
  },
  "🌟 Social Reels": {
    cropMode: "9:16", quality: "manual", bitrateKbps: 8000,
    loudnorm: "-14",
  },
};

// Social platform duration limits (seconds), highest priority = smallest limit
const PLATFORM_LIMITS = [
  { name: "Instagram Feed",     limit: 60  },
  { name: "YouTube Shorts",     limit: 60  },
  { name: "Instagram Reels",    limit: 90  },
  { name: "Facebook Reels",     limit: 90  },
  { name: "X (Twitter)",        limit: 140 },
  { name: "TikTok",             limit: 600 },
  { name: "LinkedIn video",     limit: 600 },
];

// Tooltips for sliders
const TOOLTIPS = {
  sweetSpot: "Crops the fulldome image vertically. 0% shows the top of the dome (zenith); 100% shows the bottom (horizon).",
  hPan:      "When scale > 100%, controls left/right cropping position. 0% = left, 50% = center, 100% = right.",
  scale:     "Zooms into the fulldome image before cropping. Useful for filling black corners or focusing on a region of interest.",
  pipSize:   "Diameter of the Picture-in-Picture circle, in pixels.",
  pipMargin: "Distance from the corner edge to the PiP circle, in pixels.",
  wmOpacity: "Transparency of the logo overlay. 0% = invisible, 100% = solid.",
  wmSize:    "Width of the logo overlay as a percentage of the output frame width.",
};

function loadSavedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("dfw-settings") || "{}");
    return { ...DEFAULT_STATE, ...saved };
  } catch {
    return DEFAULT_STATE;
  }
}

function loadSavedPresets() {
  try {
    return JSON.parse(localStorage.getItem("dfw-presets") || "{}");
  } catch {
    return {};
  }
}

const TABS = [
  { id: "framing", label: "Background Image" },
  { id: "pip",     label: "Picture-in-Picture" },
  { id: "export",  label: "Export" },
];

function applyFilenameTemplate(template, { filename, resolution, cropMode }) {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const croptag = cropMode.replace(/:/g, "x");
  return template
    .replace(/{filename}/g, filename || "preview")
    .replace(/{resolution}/g, resolution)
    .replace(/{cropmode}/g, croptag)
    .replace(/{date}/g, date);
}

function loadRecentFiles() {
  try {
    const r = JSON.parse(localStorage.getItem("dfw-recent-files") || "[]");
    return Array.isArray(r) ? r : [];
  } catch { return []; }
}

function estimateFileSizeMB(settings, durationSec, fileType) {
  if (fileType === "image" || !durationSec || durationSec <= 0) return null;
  const { w, h } = getOutputDims(settings.resolution, settings.cropMode);
  const isManual = settings.quality === "manual";
  let mbps;
  if (isManual) {
    mbps = settings.bitrateKbps / 1000;
  } else {
    const preset = { draft: 26, standard: 18, high: 12 }[settings.quality] ?? 18;
    // Heuristic interpolation: anchors at 4K and 1080p
    const points4k = [[12, 35], [18, 20], [26, 10]];
    const points1080 = [[12, 12], [18, 6], [26, 3]];
    function interp(points, crf) {
      if (crf <= points[0][0]) return points[0][1];
      if (crf >= points[points.length-1][0]) return points[points.length-1][1];
      for (let i = 0; i < points.length-1; i++) {
        const [x1,y1] = points[i], [x2,y2] = points[i+1];
        if (crf >= x1 && crf <= x2) {
          const t = (crf - x1) / (x2 - x1);
          return y1 + t * (y2 - y1);
        }
      }
      return points[points.length-1][1];
    }
    const mbps4k = interp(points4k, preset);
    const mbps1080 = interp(points1080, preset);
    const base = settings.resolution === "4k" ? mbps4k : mbps1080;
    // Scale by area ratio (relative to native 16:9 for that resolution)
    const nativeArea = settings.resolution === "4k" ? (3840 * 2160) : (1920 * 1080);
    mbps = base * (w * h) / nativeArea;
  }
  const mb = mbps * durationSec / 8;
  return mb;
}

function getPlatformWarning(durationSec) {
  if (!durationSec || durationSec <= 60) return null;
  // Find all platforms exceeded
  const exceeded = PLATFORM_LIMITS.filter(p => durationSec > p.limit);
  if (!exceeded.length) return null;
  const minLimit = Math.min(...exceeded.map(p => p.limit));
  const names = exceeded.filter(p => p.limit === minLimit).map(p => p.name).join(" & ");
  return `⚠ Over ${names} (${minLimit}s)`;
}

export default function App() {
  const [file, setFile]                 = useState(null);
  const [fileType, setFileType]         = useState("video");
  const [fileDuration, setFileDuration] = useState(null);
  const [frameSrc, setFrameSrc]         = useState(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [outputPath, setOutputPath]     = useState("");
  const [settings, setSettings]         = useState(loadSavedSettings);
  const [activeTab, setActiveTab]       = useState("framing");

  const [status, setStatus]       = useState("idle");
  const [progress, setProgress]   = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [errorText, setErrorText] = useState("");
  const [doneOutput, setDoneOutput] = useState("");

  // Presets
  const [presets, setPresets]           = useState(loadSavedPresets);
  const [activePreset, setActivePreset] = useState("");
  const presetImportRef = useRef(null);

  // Batch mode
  const [batchMode, setBatchMode]   = useState(false);
  const [queue, setQueue]           = useState([]);
  const [batchRunning, setBatchRunning] = useState(false);
  const batchIndexRef = useRef(-1);

  // System info (FFmpeg/Python/GPU detection from main process)
  const [systemInfo, setSystemInfo] = useState(null);

  // Recent files
  const [recentFiles, setRecentFiles] = useState(loadRecentFiles);
  const [showRecent, setShowRecent]   = useState(false);

  // Test render mode (uses isTesting to disable normal Convert button)
  const [isTesting, setIsTesting] = useState(false);

  // Help modal (keyboard shortcuts)
  const [showHelp, setShowHelp] = useState(false);

  // Settings / system diagnostics modal
  const [showSettings, setShowSettings] = useState(false);
  const [recheckingSystem, setRecheckingSystem] = useState(false);
  const [settingsToast, setSettingsToast] = useState("");

  // Tab reset toast
  const [tabResetToast, setTabResetToast] = useState("");

  // Copy ffmpeg toast
  const [copyToast, setCopyToast] = useState("");

  // Last-used output dir (persisted in localStorage)
  const [lastOutputDir, setLastOutputDir] = useState(() => {
    try { return localStorage.getItem("dfw-last-output-dir") || ""; } catch { return ""; }
  });

  const scrubTimerRef = useRef(null);
  const isElectron = typeof window.api !== "undefined";
  const platform   = window.api?.platform || "darwin";
  const appVersion = systemInfo?.appVersion || "";

  // Fetch system info once at startup — surfaces missing dependencies
  // and shows which encoder is actually being used.
  useEffect(() => {
    if (!isElectron) return;
    window.api.getSystemInfo().then(setSystemInfo).catch((err) => {
      setSystemInfo({ ok: false, error: String(err) });
    });
  }, [isElectron]);

  // Keyboard shortcuts
  useEffect(() => {
    function onKey(e) {
      const mod = e.metaKey || e.ctrlKey;
      // Ignore when typing in inputs
      const tag = (e.target?.tagName || "").toLowerCase();
      const isTyping = tag === "input" || tag === "textarea" || tag === "select";
      if (mod && e.key.toLowerCase() === "o" && !isTyping) {
        e.preventDefault(); handleBrowse();
      } else if (mod && e.key === "Enter") {
        e.preventDefault();
        if (file && status !== "converting") handleConvert();
      } else if (mod && e.key.toLowerCase() === "t" && !isTyping) {
        e.preventDefault(); handleTestRender();
      } else if (e.key === "Escape") {
        if (status === "converting") handleCancel();
        else { setShowRecent(false); setShowHelp(false); setShowSettings(false); }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, status, isTesting]);

  // Prevent Electron from navigating when files are dragged over non-target areas
  useEffect(() => {
    const prevent = (e) => e.preventDefault();
    document.addEventListener("dragover", prevent);
    document.addEventListener("drop", prevent);
    return () => {
      document.removeEventListener("dragover", prevent);
      document.removeEventListener("drop", prevent);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem("dfw-settings", JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    localStorage.setItem("dfw-presets", JSON.stringify(presets));
  }, [presets]);

  useEffect(() => {
    if (!isElectron) return;
    const offProgress = window.api.onProgress(({ pct }) => {
      if (batchRunning) {
        const idx = batchIndexRef.current;
        if (idx >= 0) {
          setQueue((q) => q.map((item, i) => i === idx ? { ...item, progress: pct } : item));
        }
      } else {
        setProgress(pct);
      }
    });
    const offDone = window.api.onConversionDone(({ outputPath: op }) => {
      if (batchRunning) {
        const idx = batchIndexRef.current;
        if (idx >= 0) {
          setQueue((q) => q.map((item, i) => i === idx ? { ...item, status: "done", progress: 100, outputPath: op } : item));
        }
      } else {
        setStatus("done"); setProgress(100); setDoneOutput(op);
      }
    });
    const offError = window.api.onConversionError(({ message }) => {
      if (batchRunning) {
        const idx = batchIndexRef.current;
        if (idx >= 0) {
          setQueue((q) => q.map((item, i) => i === idx ? { ...item, status: "error", error: message } : item));
        }
      } else {
        setStatus("error"); setErrorText(message);
      }
    });
    return () => { offProgress(); offDone(); offError(); };
  }, [isElectron, batchRunning]);

  // Output path — recomputed from filename template, joined via main process
  // (uses Node's path.join so separators are correct on Mac, Windows, Linux)
  useEffect(() => {
    if (!file) return;
    const fileBase = file.name.replace(/\.[^.]+$/, "");
    const rendered = applyFilenameTemplate(settings.filenameTemplate, {
      filename: fileBase,
      resolution: settings.resolution,
      cropMode: settings.cropMode,
    });
    const ext = fileType === "image" ? `.${settings.outputImageFormat}` : ".mp4";
    if (isElectron) {
      window.api.buildOutputPath(file.path, rendered, ext).then(setOutputPath);
    } else {
      // Browser preview fallback: use forward slash
      const dir = file.path.replace(/[/\\][^/\\]+$/, "");
      setOutputPath(`${dir}/${rendered}${ext}`);
    }
  }, [file, settings.resolution, settings.cropMode, fileType, settings.outputImageFormat, settings.filenameTemplate, isElectron]);

  const set = (key) => (val) => setSettings((s) => ({ ...s, [key]: val }));

  useEffect(() => {
    setSettings((s) => ({ ...s, pipSize: AUTO_PIP[s.resolution] }));
  }, [settings.resolution]);

  async function handleFileDrop(filePath) {
    setFile(null);
    setFrameSrc(null);
    setFileDuration(null);
    setStatus("idle");
    setFrameLoading(true);

    const detectedType = getFileType(filePath);
    setFileType(detectedType);

    let info = { path: filePath, name: filePath.split(/[/\\]/).pop(), width: "?", height: "?" };

    if (isElectron) {
      const [probe, frame] = await Promise.all([
        window.api.probeFile(filePath),
        window.api.extractFrame(filePath),
      ]);
      if (probe) {
        info.width  = probe.width;
        info.height = probe.height;
        if (detectedType === "video") setFileDuration(probe.duration || null);
      }
      setFrameSrc(frame);
    } else {
      setFrameSrc(makeDemoFrame());
      if (detectedType === "video") setFileDuration(60);
    }

    setFile(info);
    setFrameLoading(false);
    pushRecent(filePath, info.name);
  }

  function makeDemoFrame() {
    const c = document.createElement("canvas");
    c.width = 400; c.height = 400;
    const ctx = c.getContext("2d");
    const g = ctx.createRadialGradient(200, 200, 10, 200, 200, 200);
    g.addColorStop(0, "#ED8B1E");
    g.addColorStop(0.5, "#1a1a4a");
    g.addColorStop(1, "#0a0a0a");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 400, 400);
    ctx.strokeStyle = "rgba(242,194,0,0.4)";
    for (let r = 40; r <= 200; r += 40) {
      ctx.beginPath(); ctx.arc(200, 200, r, 0, Math.PI * 2); ctx.stroke();
    }
    return c.toDataURL("image/jpeg");
  }

  function handleScrub(seekSeconds) {
    if (!file || fileType === "image") return;
    clearTimeout(scrubTimerRef.current);
    scrubTimerRef.current = setTimeout(async () => {
      setFrameLoading(true);
      const frame = isElectron
        ? await window.api.scrubFrame(file.path, seekSeconds)
        : makeDemoFrame();
      if (frame) setFrameSrc(frame);
      setFrameLoading(false);
    }, 250);
  }

  async function handleBrowse() {
    if (!isElectron) return;
    const p = await window.api.browseFile();
    if (p) handleFileDrop(p);
  }

  async function handleBrowseOutput() {
    if (!isElectron) return;
    const p = await window.api.browseOutputDir(outputPath, fileType);
    if (p) {
      setOutputPath(p);
      // Remember the directory for future loads
      const dir = p.replace(/[/\\][^/\\]+$/, "");
      setLastOutputDir(dir);
      try { localStorage.setItem("dfw-last-output-dir", dir); } catch {}
    }
  }

  function useLastOutputDir() {
    if (!file || !lastOutputDir) return;
    const fileBase = file.name.replace(/\.[^.]+$/, "");
    const rendered = applyFilenameTemplate(settings.filenameTemplate, {
      filename: fileBase, resolution: settings.resolution, cropMode: settings.cropMode,
    });
    const ext = fileType === "image" ? `.${settings.outputImageFormat}` : ".mp4";
    // Use forward slash; main.js can normalize if needed
    const sep = lastOutputDir.includes("\\") ? "\\" : "/";
    setOutputPath(`${lastOutputDir}${sep}${rendered}${ext}`);
  }

  function buildConversionOpts(filePath, outPath, overrides = {}) {
    const merged  = { ...settings, ...overrides };
    const preset   = CRF_PRESETS.find((p) => p.value === merged.quality);
    const isManual = merged.quality === "manual";
    const s = merged;
    return {
      inputPath:         filePath,
      outputPath:        outPath,
      resolution:        s.resolution,
      cropMode:          s.cropMode,
      sweetSpot:         s.sweetSpot,
      pipSize:           s.pipSize,
      pipMargin:         s.pipMargin,
      pipPosition:       s.pipPosition,
      audio:             s.audio,
      crf:               isManual ? null : (preset?.crf ?? 18),
      scale:             s.scale / 100,
      hPan:              s.hPan,
      pipEnabled:        s.pipEnabled,
      bitrateKbps:       isManual ? s.bitrateKbps : null,
      burninTitle:       s.burninEnabled ? s.burninTitle : "",
      burninFilename:    s.burninEnabled && s.burninFilename,
      burninFramenumber: s.burninEnabled && s.burninFramenumber,
      burninCorner:      s.burninCorner,
      trimStart:         s.trimStart || 0,
      trimEnd:           s.trimEnd || null,
      slateTitle:        s.slateEnabled ? s.slateTitle : "",
      slateCreator:      s.slateEnabled ? s.slateCreator : "",
      slateYear:         s.slateEnabled ? s.slateYear : "",
      watermarkPath:     s.watermarkEnabled ? s.watermarkPath : "",
      watermarkCorner:   s.watermarkCorner,
      watermarkOpacity:  s.watermarkOpacity,
      watermarkSize:     s.watermarkSize,
      hwAccel:           s.hwAccel,
      colorTag:          s.colorTagBt709 ? "bt709" : "none",
      loudnorm:          (s.loudnorm && s.loudnorm !== "none") ? s.loudnorm : null,
      posterFrame:       !!s.posterFrameEnabled,
    };
  }

  // Push file onto recent list
  function pushRecent(p, name) {
    setRecentFiles((prev) => {
      const filtered = prev.filter((r) => r.path !== p);
      const next = [{ path: p, name }, ...filtered].slice(0, 8);
      try { localStorage.setItem("dfw-recent-files", JSON.stringify(next)); } catch {}
      return next;
    });
  }

  async function handleTestRender() {
    if (!file || status === "converting" || isTesting) return;
    if (!isElectron) return;
    if (fileType === "image") return;
    const tmp = await window.api.getTempOutputPath();
    setIsTesting(true);
    setStatus("converting");
    setProgress(0);
    setStartTime(Date.now());
    setErrorText("");
    setDoneOutput("");
    const opts = buildConversionOpts(file.path, tmp, { trimStart: 0, trimEnd: 5 });
    await window.api.startConversion(opts);
    // Hook into existing event listeners — when done, auto-open
    // We'll handle via a one-shot listener
    const offDone = window.api.onConversionDone(({ outputPath: op }) => {
      window.api.openFile(op);
      offDone();
      offErr();
      setIsTesting(false);
    });
    const offErr = window.api.onConversionError(() => {
      offDone();
      offErr();
      setIsTesting(false);
    });
  }

  function handleResetTab(tabId) {
    const keys = TAB_SETTINGS[tabId] || [];
    setSettings((s) => {
      const next = { ...s };
      for (const k of keys) next[k] = DEFAULT_STATE[k];
      return next;
    });
    setTabResetToast("Tab reset");
    setTimeout(() => setTabResetToast(""), 1500);
  }

  async function handleCopyFfmpegCommand() {
    if (!file || !isElectron) return;
    const opts = buildConversionOpts(file.path, outputPath);
    const result = await window.api.getFfmpegCommand(opts);
    if (result?.ok) {
      try {
        await navigator.clipboard.writeText(result.command);
        setCopyToast("Copied!");
      } catch {
        setCopyToast("Copy failed");
      }
    } else {
      setCopyToast("Error");
    }
    setTimeout(() => setCopyToast(""), 1500);
  }

  // ---- Settings panel: system diagnostics + housekeeping ----

  function flashSettingsToast(msg) {
    setSettingsToast(msg);
    setTimeout(() => setSettingsToast(""), 1800);
  }

  async function handleRecheckSystem() {
    if (!isElectron) return;
    setRecheckingSystem(true);
    try {
      const info = await window.api.getSystemInfo(true);
      setSystemInfo(info);
      flashSettingsToast(info?.ok ? "System check passed" : "Issue found — see above");
    } finally {
      setRecheckingSystem(false);
    }
  }

  async function handleCopyDiagnostics() {
    const lines = [
      `Fulldome Preview Converter — Diagnostic Report`,
      `App version: ${appVersion || "unknown"}`,
      `Platform: ${systemInfo?.platform || platform}`,
      `Conversion engine: ${systemInfo?.engine === "binary" ? "Built-in (compiled)" : "System Python"}`,
      `Python runtime: ${systemInfo?.python || "n/a"}`,
      `FFmpeg OK: ${systemInfo?.ffmpeg_ok ?? "unknown"}`,
      `FFmpeg version: ${systemInfo?.ffmpeg_version || "n/a"}`,
      `FFmpeg path: ${systemInfo?.ffmpeg_path || "n/a"}`,
      `ffprobe OK: ${systemInfo?.ffprobe_ok ?? "unknown"}`,
      `Encoder: ${systemInfo?.encoder_label || "unknown"} (${systemInfo?.encoder_kind || "n/a"})`,
      `Font bundled: ${systemInfo?.font_bundled ?? "unknown"}`,
      systemInfo && !systemInfo.ok ? `Error: ${systemInfo.error}` : null,
    ].filter(Boolean);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      flashSettingsToast("Diagnostic report copied");
    } catch {
      flashSettingsToast("Copy failed");
    }
  }

  function handleResetAllSettings() {
    if (!window.confirm("Reset all settings to defaults? Your presets and recent files are kept.")) return;
    setSettings(DEFAULT_STATE);
    setActivePreset("");
    flashSettingsToast("Settings reset to defaults");
  }

  function handleClearRecentFiles() {
    if (!window.confirm("Clear the recent files list?")) return;
    setRecentFiles([]);
    try { localStorage.removeItem("dfw-recent-files"); } catch {}
    flashSettingsToast("Recent files cleared");
  }

  function handleClearPresets() {
    if (!window.confirm("Delete all saved presets? Built-in presets are kept.")) return;
    setPresets({});
    setActivePreset("");
    flashSettingsToast("Saved presets cleared");
  }

  async function handleConvert() {
    if (!file || status === "converting") return;
    if (isElectron) {
      const ok = await window.api.confirmOverwrite(outputPath);
      if (!ok) return;
    }

    setStatus("converting");
    setProgress(0);
    setStartTime(Date.now());
    setErrorText("");
    setDoneOutput("");

    if (isElectron) {
      await window.api.startConversion(buildConversionOpts(file.path, outputPath));
    } else {
      let p = 0;
      const iv = setInterval(() => {
        p = Math.min(p + 2, 99);
        setProgress(p);
        if (p >= 99) {
          clearInterval(iv);
          setTimeout(() => { setStatus("done"); setProgress(100); setDoneOutput(outputPath); }, 400);
        }
      }, 120);
    }
  }

  async function handleCancel() {
    if (isElectron) await window.api.cancelConversion();
    setStatus("idle");
    setProgress(0);
  }

  // ---- Batch mode ----
  async function handleAddFiles() {
    if (!isElectron) return;
    const paths = await window.api.browseFiles();
    if (!paths || !paths.length) return;
    const newItems = paths.map((p) => ({
      id: `${p}-${Date.now()}-${Math.random()}`,
      path: p,
      name: p.split(/[/\\]/).pop(),
      status: "pending",
      progress: 0,
      error: "",
      outputPath: "",
    }));
    setQueue((q) => [...q, ...newItems]);
  }

  async function buildBatchOutputPath(item) {
    const fileBase = item.name.replace(/\.[^.]+$/, "");
    const rendered = applyFilenameTemplate(settings.filenameTemplate, {
      filename: fileBase,
      resolution: settings.resolution,
      cropMode: settings.cropMode,
    });
    const ft = getFileType(item.path);
    const ext = ft === "image" ? `.${settings.outputImageFormat}` : ".mp4";
    if (isElectron) {
      return await window.api.buildOutputPath(item.path, rendered, ext);
    }
    const dir = item.path.replace(/[/\\][^/\\]+$/, "");
    return `${dir}/${rendered}${ext}`;
  }

  async function runBatch() {
    if (!isElectron) return;
    setBatchRunning(true);
    const items = queue;
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== "pending") continue;
      batchIndexRef.current = i;
      const outPath = await buildBatchOutputPath(items[i]);
      setQueue((q) => q.map((item, idx) => idx === i ? { ...item, status: "converting", progress: 0, outputPath: outPath } : item));
      await window.api.startConversion(buildConversionOpts(items[i].path, outPath));
      // Wait for done or error event — poll queue state
      await new Promise((resolve) => {
        const interval = setInterval(() => {
          setQueue((q) => {
            const current = q[i];
            if (current && (current.status === "done" || current.status === "error")) {
              clearInterval(interval);
              resolve();
            }
            return q;
          });
        }, 300);
      });
    }
    batchIndexRef.current = -1;
    setBatchRunning(false);
  }

  // ---- Presets ----
  function handleSavePreset() {
    const name = window.prompt("Preset name:");
    if (!name || !name.trim()) return;
    setPresets((p) => ({ ...p, [name.trim()]: { ...settings } }));
    setActivePreset(name.trim());
  }

  function handleLoadPreset(name) {
    setActivePreset(name);
    if (!name) return;
    const preset = BUILTIN_PRESETS[name] || presets[name];
    if (preset) setSettings({ ...DEFAULT_STATE, ...preset });
  }

  const isBuiltinPreset = activePreset && Object.prototype.hasOwnProperty.call(BUILTIN_PRESETS, activePreset);

  function handleDeletePreset() {
    if (!activePreset) return;
    setPresets((p) => {
      const next = { ...p };
      delete next[activePreset];
      return next;
    });
    setActivePreset("");
  }

  function handleExportPresets() {
    const blob = new Blob([JSON.stringify(presets, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "dfw-presets.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImportPresets(e) {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (typeof data === "object") {
          setPresets((p) => ({ ...p, ...data }));
        }
      } catch {
        alert("Invalid preset file.");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  }

  const revealLabel = platform === "darwin" ? "Show in Finder"
                    : platform === "win32"   ? "Show in Explorer"
                    : "Show in Folder";

  const outDims = getOutputDims(settings.resolution, settings.cropMode);
  const hasSlate = settings.slateEnabled && (settings.slateTitle || settings.slateCreator || settings.slateYear);
  const slateBarH = hasSlate ? Math.round(outDims.h * 0.10) : 0;
  const finalDims = { w: outDims.w, h: outDims.h + slateBarH };

  // File size estimate
  const effectiveDuration = fileType === "image"
    ? null
    : ((settings.trimEnd ?? fileDuration ?? 0) - (settings.trimStart ?? 0));
  const sizeEstimateMB = estimateFileSizeMB(settings, effectiveDuration, fileType);
  const platformWarning = getPlatformWarning(effectiveDuration);

  // Live filename preview
  const fileBase = file ? file.name.replace(/\.[^.]+$/, "") : "filename";
  const previewFilename = applyFilenameTemplate(settings.filenameTemplate, {
    filename: fileBase,
    resolution: settings.resolution,
    cropMode: settings.cropMode,
  });

  return (
    <div className={styles.shell}>
      <header className={styles.titleBar}>
        <span className={styles.wordmark}>
          <span className={styles.dfw}>DOME FEST WEST</span>
          <span className={styles.toolName}>Fulldome Preview Converter</span>
        </span>
        {systemInfo?.ok && systemInfo.encoder_label && (
          <span
            className={styles.encoderBadge}
            title={`${systemInfo.encoder_label} — ${systemInfo.platform}`}
            data-kind={systemInfo.encoder_kind}
          >
            {systemInfo.encoder_kind === "gpu" ? "⚡" : "▢"} {systemInfo.encoder_label}
          </span>
        )}
        <button
          className={styles.helpBtn}
          onClick={() => setShowSettings(true)}
          title="Settings & system status"
          aria-label="Open settings and system status"
        >
          ⚙
        </button>
        <button
          className={styles.helpBtn}
          onClick={() => setShowHelp(true)}
          title="Keyboard shortcuts"
          aria-label="Show keyboard shortcuts"
        >
          ?
        </button>
      </header>

      {showHelp && (
        <div className={styles.modalBackdrop} onClick={() => setShowHelp(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <strong>Keyboard Shortcuts</strong>
              <button className={styles.btnGhost} onClick={() => setShowHelp(false)}>Close</button>
            </div>
            <div className={styles.shortcutList}>
              <div><kbd>⌘/Ctrl</kbd> + <kbd>O</kbd> — Open file</div>
              <div><kbd>⌘/Ctrl</kbd> + <kbd>Enter</kbd> — Convert</div>
              <div><kbd>⌘/Ctrl</kbd> + <kbd>T</kbd> — Test render (5s sample)</div>
              <div><kbd>Esc</kbd> — Cancel / close menus</div>
            </div>
          </div>
        </div>
      )}

      {showSettings && (
        <div className={styles.modalBackdrop} onClick={() => setShowSettings(false)}>
          <div className={styles.modalCard} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <strong>Settings & System Status</strong>
              <button className={styles.btnGhost} onClick={() => setShowSettings(false)}>Close</button>
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.settingsSectionHeader}>
                <span className={styles.settingsSectionTitle}>System</span>
                <button
                  className={styles.btnGhost}
                  onClick={handleRecheckSystem}
                  disabled={recheckingSystem}
                >
                  {recheckingSystem ? "Checking…" : "Re-check"}
                </button>
              </div>

              {!systemInfo && <p className={styles.hint}>Checking system…</p>}

              {systemInfo && !systemInfo.ok && (
                <div className={styles.settingsError}>
                  <strong>Something needs attention:</strong>
                  <p>{systemInfo.error || "System check failed."}</p>
                </div>
              )}

              {systemInfo && (
                <div className={styles.diagRows}>
                  <div className={styles.diagRow}>
                    <span>Conversion engine</span>
                    <span>{systemInfo.engine === "binary" ? "Built-in (no Python required)" : "System Python (dev mode)"}</span>
                  </div>
                  <div className={styles.diagRow}>
                    <span>Platform</span>
                    <span>{systemInfo.platform || platform}</span>
                  </div>
                  <div className={styles.diagRow}>
                    <span>FFmpeg</span>
                    <span className={systemInfo.ffmpeg_ok ? styles.diagOk : styles.diagBad}>
                      {systemInfo.ffmpeg_ok ? `✓ ${systemInfo.ffmpeg_version || "found"}` : "✗ not found"}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span>Encoder</span>
                    <span className={systemInfo.encoder_kind === "gpu" ? styles.diagOk : ""}>
                      {systemInfo.encoder_label || "unknown"}
                      {systemInfo.encoder_kind === "gpu" ? " (GPU)" : systemInfo.encoder_kind === "cpu" ? " (CPU)" : ""}
                    </span>
                  </div>
                  <div className={styles.diagRow}>
                    <span>Bundled font</span>
                    <span className={systemInfo.font_bundled ? styles.diagOk : styles.diagBad}>
                      {systemInfo.font_bundled ? "✓ DejaVu Sans" : "✗ missing"}
                    </span>
                  </div>
                  {appVersion && (
                    <div className={styles.diagRow}>
                      <span>App version</span>
                      <span>{appVersion}</span>
                    </div>
                  )}
                </div>
              )}

              <button className={styles.btnGhost} style={{ marginTop: 10 }} onClick={handleCopyDiagnostics}>
                📋 Copy diagnostic report
              </button>
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.settingsSectionHeader}>
                <span className={styles.settingsSectionTitle}>Performance</span>
              </div>
              <div className={styles.pipToggleRow} style={{ marginBottom: 0 }}>
                <span className={styles.pipToggleLabel}>GPU Acceleration</span>
                <button
                  className={settings.hwAccel ? styles.toggleOn : styles.toggleOff}
                  onClick={() => set("hwAccel")(!settings.hwAccel)}
                  aria-pressed={settings.hwAccel}
                >
                  {settings.hwAccel ? "On" : "Off"}
                </button>
              </div>
              <p className={styles.hint}>Mac: VideoToolbox · NVIDIA: NVENC · AMD/Intel Linux: VAAPI · AMD Windows: AMF · Intel: QSV</p>
            </div>

            <div className={styles.settingsSection}>
              <div className={styles.settingsSectionHeader}>
                <span className={styles.settingsSectionTitle}>Housekeeping</span>
              </div>
              <div className={styles.settingsActionsRow}>
                <button className={styles.btnGhost} onClick={handleClearRecentFiles}>Clear recent files</button>
                <button className={styles.btnGhost} onClick={handleClearPresets}>Clear saved presets</button>
                <button className={styles.btnGhost} onClick={handleResetAllSettings}>Reset all settings</button>
              </div>
            </div>

            {settingsToast && <div className={styles.settingsToast}>{settingsToast}</div>}
          </div>
        </div>
      )}

      {/* System health banner — shown if the conversion engine or FFmpeg is missing */}
      {systemInfo && !systemInfo.ok && (
        <div className={styles.healthBanner}>
          <strong>Setup needed:</strong> {systemInfo.error || "System check failed."}
          <button className={styles.btnGhost} style={{ marginLeft: 10 }} onClick={() => setShowSettings(true)}>
            Open Settings
          </button>
        </div>
      )}
      {systemInfo?.ok && !systemInfo.ffmpeg_ok && (
        <div className={styles.healthBanner}>
          <strong>FFmpeg not found.</strong> Install FFmpeg 6+ and make sure it's on your PATH,
          or place ffmpeg{platform === "win32" ? ".exe" : ""} in the app's bin/ folder.
          <button className={styles.btnGhost} style={{ marginLeft: 10 }} onClick={() => setShowSettings(true)}>
            Open Settings
          </button>
        </div>
      )}

      <main className={styles.main}>

        {/* Batch mode toggle + Recent files */}
        <div className={styles.batchToggleRow}>
          <button
            className={batchMode ? styles.toggleOn : styles.toggleOff}
            onClick={() => setBatchMode((v) => !v)}
          >
            {batchMode ? "Batch Mode: On" : "Batch Mode: Off"}
          </button>
          {batchMode && (
            <span className={styles.hint} style={{ marginLeft: 8 }}>
              Add multiple files to convert with the same settings
            </span>
          )}
          {recentFiles.length > 0 && (
            <div className={styles.recentWrapper}>
              <button
                className={styles.btnGhost}
                onClick={() => setShowRecent((v) => !v)}
                title="Recent files"
              >
                Recent ▾
              </button>
              {showRecent && (
                <div className={styles.recentMenu}>
                  {recentFiles.map((r) => (
                    <button
                      key={r.path}
                      className={styles.recentItem}
                      onClick={() => { setShowRecent(false); handleFileDrop(r.path); }}
                      title={r.path}
                    >
                      {r.name}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Unified drop zone + live preview */}
        {(!batchMode || !queue.length) && (
          <Preview
            frameSrc={frameSrc}
            isLoading={frameLoading}
            settings={settings}
            duration={fileDuration}
            onScrub={handleScrub}
            fileType={fileType}
            file={file}
            onDrop={handleFileDrop}
            onBrowse={handleBrowse}
            disabled={status === "converting"}
            isElectron={isElectron}
            onTrimChange={({ start, end }) => setSettings((s) => ({ ...s, trimStart: start, trimEnd: end }))}
          />
        )}

        {/* Batch queue panel */}
        {batchMode && (
          <div className={styles.batchPanel}>
            <div className={styles.batchHeader}>
              <span className={styles.batchTitle}>File Queue ({queue.length})</span>
              <div className={styles.batchHeaderActions}>
                <button className={styles.btnGhost} onClick={handleAddFiles} disabled={batchRunning}>
                  Add Files…
                </button>
                <button
                  className={styles.btnConvertSmall}
                  disabled={!queue.some((i) => i.status === "pending") || batchRunning}
                  onClick={runBatch}
                >
                  {batchRunning ? "Converting…" : "Convert All"}
                </button>
              </div>
            </div>
            {queue.length === 0 && (
              <p className={styles.batchEmpty}>No files added yet. Click "Add Files…" to get started.</p>
            )}
            {queue.map((item, idx) => (
              <div key={item.id} className={styles.batchRow}>
                <span className={styles.batchFileName}>{item.name}</span>
                <span className={[styles.batchChip, styles[`chip_${item.status}`]].join(" ")}>
                  {item.status}
                </span>
                {item.status === "converting" && (
                  <div className={styles.batchProgress}>
                    <div className={styles.batchProgressBar} style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.status === "pending" && !batchRunning && (
                  <button
                    className={styles.batchRemove}
                    onClick={() => setQueue((q) => q.filter((_, i) => i !== idx))}
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {queue.length > 0 && !batchRunning && (
              <button
                className={styles.btnGhost}
                style={{ marginTop: 8 }}
                onClick={() => setQueue([])}
              >
                Clear Queue
              </button>
            )}
          </div>
        )}

        {/* Crop mode selector */}
        <div className={styles.cropModeRow}>
          <label className={styles.cropModeLabel}>Output Format</label>
          <ToggleGroup
            options={CROP_MODE_OPTIONS}
            value={settings.cropMode}
            onChange={set("cropMode")}
          />
          <span className={styles.dimsBadge}>
            {finalDims.w}×{finalDims.h}
            {hasSlate && <span className={styles.slateNote}> (incl. slate)</span>}
          </span>
        </div>

        {/* Presets row */}
        <div className={styles.presetsRow}>
          <select
            className={styles.presetSelect}
            value={activePreset}
            onChange={(e) => handleLoadPreset(e.target.value)}
          >
            <option value="">— Default —</option>
            <optgroup label="Built-in">
              {Object.keys(BUILTIN_PRESETS).map((name) => (
                <option key={name} value={name}>{name}</option>
              ))}
            </optgroup>
            {Object.keys(presets).length > 0 && (
              <optgroup label="Your Presets">
                {Object.keys(presets).map((name) => (
                  <option key={name} value={name}>{name}</option>
                ))}
              </optgroup>
            )}
          </select>
          <button className={styles.btnGhost} onClick={handleSavePreset}>Save</button>
          <button className={styles.btnGhost} onClick={handleDeletePreset} disabled={!activePreset || isBuiltinPreset}>Delete</button>
          <button className={styles.btnGhost} onClick={handleExportPresets} title="Export presets as JSON">⬇ Export</button>
          <label className={styles.btnGhost} style={{ cursor: "pointer" }} title="Import presets from JSON">
            ⬆ Import
            <input ref={presetImportRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleImportPresets} />
          </label>
        </div>

        {/* Tabbed settings panel */}
        <div className={styles.tabPanel}>
          <div className={styles.tabBar} role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={activeTab === t.id}
                className={[styles.tabBtn, activeTab === t.id ? styles.tabBtnActive : ""].join(" ")}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className={styles.tabContent}>

            <div className={styles.tabResetRow}>
              <button
                className={styles.tabResetBtn}
                onClick={() => handleResetTab(activeTab)}
                title="Reset this tab's settings to defaults"
              >
                ↺ Reset
              </button>
              {tabResetToast && <span className={styles.tabResetToast}>{tabResetToast}</span>}
            </div>

            {activeTab === "framing" && (
              <div className={styles.tabGrid}>
                {/* Left column: position controls */}
                <div className={styles.tabCol}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>
                      Vertical Position
                      <span className={styles.numBadge}>{settings.sweetSpot}%</span>
                    </label>
                    <Slider min={0} max={100} value={settings.sweetSpot} onChange={set("sweetSpot")} tooltip={TOOLTIPS.sweetSpot} />
                    <p className={styles.hint}>0% = top of dome · 100% = bottom</p>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>
                      Horizontal Position
                      <span className={styles.numBadge}>{settings.hPan}%</span>
                    </label>
                    <Slider min={0} max={100} value={settings.hPan} onChange={set("hPan")} tooltip={TOOLTIPS.hPan} />
                    <p className={styles.hint}>0% = left · 50% = center · 100% = right</p>
                  </div>
                </div>
                {/* Right column: resolution + scale */}
                <div className={styles.tabCol}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Output Resolution</label>
                    <ToggleGroup
                      options={[{ value: "4k", label: "4K (3840×2160)" }, { value: "1080p", label: "1080p (1920×1080)" }]}
                      value={settings.resolution}
                      onChange={set("resolution")}
                    />
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>
                      Scale
                      <span className={styles.numBadge}>{settings.scale}%</span>
                    </label>
                    <Slider min={100} max={400} value={settings.scale} onChange={set("scale")} tooltip={TOOLTIPS.scale} />
                    <p className={styles.hint}>Zoom in to fill black corners</p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "pip" && (
              <>
                <div className={styles.pipToggleRow}>
                  <span className={styles.pipToggleLabel}>Picture-in-Picture overlay</span>
                  <button
                    className={settings.pipEnabled ? styles.toggleOn : styles.toggleOff}
                    onClick={() => set("pipEnabled")(!settings.pipEnabled)}
                    aria-pressed={settings.pipEnabled}
                  >
                    {settings.pipEnabled ? "On" : "Off"}
                  </button>
                </div>

                {settings.pipEnabled && (
                  <div className={styles.tabGrid}>
                    <div className={styles.tabCol}>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel}>Position</label>
                        <PipPositionPicker value={settings.pipPosition} onChange={set("pipPosition")} />
                      </div>
                    </div>
                    <div className={styles.tabCol}>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel}>
                          Size
                          <span className={styles.numBadge}>{settings.pipSize}px</span>
                        </label>
                        <Slider min={120} max={PIP_MAX[settings.resolution]} value={settings.pipSize} onChange={set("pipSize")} tooltip={TOOLTIPS.pipSize} />
                        <p className={styles.hint}>Default: {AUTO_PIP[settings.resolution]}px</p>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel}>
                          Padding
                          <span className={styles.numBadge}>{settings.pipMargin}px</span>
                        </label>
                        <Slider min={0} max={300} value={settings.pipMargin} onChange={set("pipMargin")} tooltip={TOOLTIPS.pipMargin} />
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}

            {activeTab === "export" && (
              <>
              <div className={styles.tabGrid}>
                <div className={styles.tabCol}>
                  {fileType === "video" && (
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Audio</label>
                      <ToggleGroup
                        options={[
                          { value: "stereo",      label: "Downmix to stereo" },
                          { value: "passthrough", label: "Passthrough" },
                        ]}
                        value={settings.audio}
                        onChange={set("audio")}
                      />
                    </div>
                  )}
                  {fileType === "video" && (
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Loudness Normalization</label>
                      <ToggleGroup
                        options={[
                          { value: "none", label: "Off" },
                          { value: "-23",  label: "-23 LUFS (Festival)" },
                          { value: "-14",  label: "-14 LUFS (Streaming)" },
                        ]}
                        value={settings.loudnorm}
                        onChange={set("loudnorm")}
                      />
                    </div>
                  )}
                  {fileType === "video" && (
                    <div className={styles.field}>
                      <div className={styles.burnInHeader}>
                        <label className={styles.fieldLabel} style={{ margin: 0 }}>Color Tag (Rec.709)</label>
                        <button
                          className={settings.colorTagBt709 ? styles.toggleOn : styles.toggleOff}
                          onClick={() => set("colorTagBt709")(!settings.colorTagBt709)}
                          aria-pressed={settings.colorTagBt709}
                        >
                          {settings.colorTagBt709 ? "On" : "Off"}
                        </button>
                      </div>
                      <p className={styles.hint}>Prevents washed-out playback in some players</p>
                    </div>
                  )}
                  <div className={styles.field}>
                    <div className={styles.burnInHeader}>
                      <label className={styles.fieldLabel} style={{ margin: 0 }}>Notify when done</label>
                      <button
                        className={settings.enableNotifications ? styles.toggleOn : styles.toggleOff}
                        onClick={() => set("enableNotifications")(!settings.enableNotifications)}
                        aria-pressed={settings.enableNotifications}
                      >
                        {settings.enableNotifications ? "On" : "Off"}
                      </button>
                    </div>
                    <p className={styles.hint}>System notification when conversion completes in background</p>
                  </div>
                  <div className={styles.field}>
                    <div className={styles.burnInHeader}>
                      <label className={styles.fieldLabel} style={{ margin: 0 }}>GPU Acceleration</label>
                      <button
                        className={settings.hwAccel ? styles.toggleOn : styles.toggleOff}
                        onClick={() => set("hwAccel")(!settings.hwAccel)}
                        aria-pressed={settings.hwAccel}
                        title="Uses VideoToolbox on Mac, NVENC on NVIDIA, AMF on AMD"
                      >
                        {settings.hwAccel ? "On" : "Off"}
                      </button>
                    </div>
                    <p className={styles.hint}>Mac: VideoToolbox · NVIDIA: NVENC · AMD/Intel Linux: VAAPI · AMD Windows: AMF · Intel: QSV · fallback: CPU</p>
                  </div>

                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Quality</label>
                    <ToggleGroup
                      options={CRF_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
                      value={settings.quality}
                      onChange={set("quality")}
                    />
                    {settings.quality !== "manual"
                      ? <p className={styles.hint}>Draft = faster · Standard = balanced · High = near-lossless</p>
                      : (
                        <div className={styles.bitrateRow}>
                          <label className={styles.bitrateLabel}>Bitrate (kbps)</label>
                          <input
                            type="number"
                            className={styles.bitrateInput}
                            min={500} max={200000} step={500}
                            value={settings.bitrateKbps}
                            onChange={(e) => set("bitrateKbps")(Number(e.target.value))}
                          />
                        </div>
                      )
                    }
                  </div>
                  {fileType === "image" && (
                    <div className={styles.field}>
                      <label className={styles.fieldLabel}>Output Format</label>
                      <ToggleGroup
                        options={[
                          { value: "jpg", label: "JPEG" },
                          { value: "png", label: "PNG" },
                          { value: "tif", label: "TIFF" },
                        ]}
                        value={settings.outputImageFormat}
                        onChange={set("outputImageFormat")}
                      />
                    </div>
                  )}

                  {/* Filename Template */}
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>Filename Template</label>
                    <input
                      type="text"
                      className={styles.burnInInput}
                      value={settings.filenameTemplate}
                      onChange={(e) => set("filenameTemplate")(e.target.value)}
                    />
                    <p className={styles.hint}>
                      Tokens: {"{filename}"} {"{resolution}"} {"{cropmode}"} {"{date}"}
                    </p>
                    <p className={styles.filenamePreview}>
                      → {previewFilename}{fileType === "image" ? `.${settings.outputImageFormat}` : ".mp4"}
                    </p>
                    {fileType === "video" && (
                      <label className={styles.burnInCheck} style={{ marginTop: 6 }}>
                        <input
                          type="checkbox"
                          checked={settings.posterFrameEnabled}
                          onChange={(e) => set("posterFrameEnabled")(e.target.checked)}
                        />
                        Also export first frame as JPG poster
                      </label>
                    )}
                    <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                      <button
                        className={styles.btnGhost}
                        onClick={handleCopyFfmpegCommand}
                        disabled={!file}
                        title="Copy the FFmpeg command to clipboard"
                      >
                        📋 Copy FFmpeg command
                      </button>
                      {copyToast && <span className={styles.hint} style={{ color: "var(--success)" }}>{copyToast}</span>}
                    </div>
                  </div>
                </div>

                <div className={styles.tabCol}>
                  <div className={styles.field}>
                    <div className={styles.burnInHeader}>
                      <label className={styles.fieldLabel} style={{ margin: 0 }}>Burn-in Overlays</label>
                      <button
                        className={settings.burninEnabled ? styles.toggleOn : styles.toggleOff}
                        onClick={() => set("burninEnabled")(!settings.burninEnabled)}
                        aria-pressed={settings.burninEnabled}
                      >
                        {settings.burninEnabled ? "On" : "Off"}
                      </button>
                    </div>
                    {settings.burninEnabled && (
                      <div className={styles.burnInFields}>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>Corner</label>
                          <ToggleGroup
                            options={[
                              { value: "bl", label: "Bottom Left" },
                              { value: "br", label: "Bottom Right" },
                            ]}
                            value={settings.burninCorner}
                            onChange={set("burninCorner")}
                          />
                        </div>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>Title text</label>
                          <input
                            type="text"
                            className={styles.burnInInput}
                            placeholder="e.g. My Dome Film"
                            value={settings.burninTitle}
                            onChange={(e) => set("burninTitle")(e.target.value)}
                          />
                        </div>
                        <label className={styles.burnInCheck}>
                          <input type="checkbox" checked={settings.burninFilename}
                            onChange={(e) => set("burninFilename")(e.target.checked)} />
                          Filename
                        </label>
                        <label className={styles.burnInCheck}>
                          <input type="checkbox" checked={settings.burninFramenumber}
                            onChange={(e) => set("burninFramenumber")(e.target.checked)} />
                          Frame number
                        </label>
                      </div>
                    )}
                  </div>

                  {/* Slate Bar */}
                  <div className={styles.field}>
                    <div className={styles.burnInHeader}>
                      <label className={styles.fieldLabel} style={{ margin: 0 }}>Slate Bar</label>
                      <button
                        className={settings.slateEnabled ? styles.toggleOn : styles.toggleOff}
                        onClick={() => set("slateEnabled")(!settings.slateEnabled)}
                        aria-pressed={settings.slateEnabled}
                      >
                        {settings.slateEnabled ? "On" : "Off"}
                      </button>
                    </div>
                    {settings.slateEnabled && (
                      <div className={styles.burnInFields}>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>Title</label>
                          <input type="text" className={styles.burnInInput} placeholder="Film title"
                            value={settings.slateTitle} onChange={(e) => set("slateTitle")(e.target.value)} />
                        </div>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>Creator</label>
                          <input type="text" className={styles.burnInInput} placeholder="Director / studio"
                            value={settings.slateCreator} onChange={(e) => set("slateCreator")(e.target.value)} />
                        </div>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>Year</label>
                          <input type="text" className={styles.burnInInput} placeholder="2024"
                            value={settings.slateYear} onChange={(e) => set("slateYear")(e.target.value)} />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Watermark */}
                  <div className={styles.field}>
                    <div className={styles.burnInHeader}>
                      <label className={styles.fieldLabel} style={{ margin: 0 }}>Watermark / Logo</label>
                      <button
                        className={settings.watermarkEnabled ? styles.toggleOn : styles.toggleOff}
                        onClick={() => set("watermarkEnabled")(!settings.watermarkEnabled)}
                        aria-pressed={settings.watermarkEnabled}
                      >
                        {settings.watermarkEnabled ? "On" : "Off"}
                      </button>
                    </div>
                    {settings.watermarkEnabled && (
                      <div className={styles.burnInFields}>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>Logo file</label>
                          <div className={styles.watermarkFileRow}>
                            <span className={styles.watermarkPath}>{settings.watermarkPath || "No file selected"}</span>
                            <button className={styles.btnGhost} onClick={async () => {
                              if (!isElectron) return;
                              const p = await window.api.browseWatermark();
                              if (p) set("watermarkPath")(p);
                            }}>Browse…</button>
                          </div>
                        </div>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>Position</label>
                          <PipPositionPicker value={settings.watermarkCorner} onChange={set("watermarkCorner")} />
                        </div>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>
                            Opacity: {settings.watermarkOpacity}%
                          </label>
                          <Slider min={0} max={100} value={settings.watermarkOpacity} onChange={set("watermarkOpacity")} tooltip={TOOLTIPS.wmOpacity} />
                        </div>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>
                            Size: {settings.watermarkSize}% of width
                          </label>
                          <Slider min={5} max={50} value={settings.watermarkSize} onChange={set("watermarkSize")} tooltip={TOOLTIPS.wmSize} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Output path — full width below the grid */}
              <div className={styles.field} style={{ marginTop: 14 }}>
                <label className={styles.fieldLabel}>Output Path</label>
                <div className={styles.outputRow}>
                  <span className={styles.outputPathText} title={outputPath}>
                    {outputPath || (file ? "…" : "Load a file first")}
                  </span>
                  {file && status !== "converting" && (
                    <button className={styles.btnGhost} onClick={handleBrowseOutput}>Change…</button>
                  )}
                </div>
              </div>

              </>
            )}

          </div>
        </div>

        {/* Platform duration warning */}
        {!batchMode && platformWarning && (
          <div className={styles.platformWarning}>{platformWarning}</div>
        )}

        {/* Last-output-dir chip */}
        {!batchMode && file && lastOutputDir && (
          (() => {
            const sourceDir = file.path.replace(/[/\\][^/\\]+$/, "");
            const outDir = outputPath.replace(/[/\\][^/\\]+$/, "");
            if (lastOutputDir !== sourceDir && lastOutputDir !== outDir) {
              return (
                <div className={styles.lastDirChip}>
                  Last saved to: <span className={styles.lastDirPath}>{lastOutputDir}</span>
                  <button className={styles.btnGhost} onClick={useLastOutputDir}>Use</button>
                </div>
              );
            }
            return null;
          })()
        )}

        {/* Convert / Cancel + Test render */}
        {!batchMode && (
          <div className={styles.actions}>
            {status !== "converting" ? (
              <>
                <button className={styles.btnConvert} disabled={!file} onClick={handleConvert}>
                  Convert
                </button>
                {fileType === "video" && (
                  <button
                    className={styles.btnGhost}
                    disabled={!file || isTesting}
                    onClick={handleTestRender}
                    title="Render a 5-second sample (⌘/Ctrl+T)"
                    style={{ marginLeft: 10 }}
                  >
                    Test Render
                  </button>
                )}
                {sizeEstimateMB != null && (
                  <span className={styles.sizeEstimate} title="Estimated output file size">
                    ≈ {sizeEstimateMB >= 1024 ? `${(sizeEstimateMB / 1024).toFixed(1)} GB` : `${Math.round(sizeEstimateMB)} MB`}
                  </span>
                )}
                {fileType === "video" && effectiveDuration && sizeEstimateMB == null && (
                  <span className={styles.sizeEstimate}>≈ ?</span>
                )}
              </>
            ) : (
              <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
            )}
          </div>
        )}

        {!batchMode && (status === "converting" || status === "done") && (
          <ProgressBar pct={progress} startTime={startTime} done={status === "done"} />
        )}

        {!batchMode && status === "done" && (
          <div className={styles.resultSuccess}>
            <span className={styles.successIcon}>✓</span>
            <span
              className={styles.resultPath}
              draggable={isElectron}
              onDragStart={(e) => {
                if (!isElectron) return;
                e.preventDefault();
                window.api.startFileDrag(doneOutput);
              }}
              title="Drag to share with another app"
            >
              ⇅ {doneOutput}
            </span>
            <div className={styles.resultActions}>
              <button className={styles.btnGhost} onClick={() => isElectron && window.api.openFile(doneOutput)}>Open File</button>
              <button className={styles.btnGhost} onClick={() => isElectron && window.api.openFolder(doneOutput)}>{revealLabel}</button>
              <button className={styles.btnGhost} onClick={() => setStatus("idle")}>Convert Another</button>
            </div>
          </div>
        )}

        {!batchMode && status === "error" && (
          <div className={styles.resultError}>
            <div className={styles.errorHeader}>
              <span>Conversion failed</span>
              <button className={styles.btnGhost} onClick={() => setStatus("idle")}>Dismiss</button>
            </div>
            <pre className={styles.errorLog}>{errorText}</pre>
          </div>
        )}

      </main>
    </div>
  );
}
