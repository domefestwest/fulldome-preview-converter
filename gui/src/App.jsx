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

  const scrubTimerRef = useRef(null);
  const isElectron = typeof window.api !== "undefined";
  const platform   = window.api?.platform || "darwin";

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

  // Output path — recomputed from filename template
  useEffect(() => {
    if (!file) return;
    const dir = file.path.replace(/[/\\][^/\\]+$/, "");
    const fileBase = file.name.replace(/\.[^.]+$/, "");
    const rendered = applyFilenameTemplate(settings.filenameTemplate, {
      filename: fileBase,
      resolution: settings.resolution,
      cropMode: settings.cropMode,
    });
    const ext = fileType === "image" ? `.${settings.outputImageFormat}` : ".mp4";
    setOutputPath(`${dir}/${rendered}${ext}`);
  }, [file, settings.resolution, settings.cropMode, fileType, settings.outputImageFormat, settings.filenameTemplate]);

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
    if (p) setOutputPath(p);
  }

  function buildConversionOpts(filePath, outPath) {
    const preset   = CRF_PRESETS.find((p) => p.value === settings.quality);
    const isManual = settings.quality === "manual";
    return {
      inputPath:         filePath,
      outputPath:        outPath,
      resolution:        settings.resolution,
      cropMode:          settings.cropMode,
      sweetSpot:         settings.sweetSpot,
      pipSize:           settings.pipSize,
      pipMargin:         settings.pipMargin,
      pipPosition:       settings.pipPosition,
      audio:             settings.audio,
      crf:               isManual ? null : (preset?.crf ?? 18),
      scale:             settings.scale / 100,
      hPan:              settings.hPan,
      pipEnabled:        settings.pipEnabled,
      bitrateKbps:       isManual ? settings.bitrateKbps : null,
      burninTitle:       settings.burninEnabled ? settings.burninTitle : "",
      burninFilename:    settings.burninEnabled && settings.burninFilename,
      burninFramenumber: settings.burninEnabled && settings.burninFramenumber,
      burninCorner:      settings.burninCorner,
      trimStart:         settings.trimStart || 0,
      trimEnd:           settings.trimEnd || null,
      slateTitle:        settings.slateEnabled ? settings.slateTitle : "",
      slateCreator:      settings.slateEnabled ? settings.slateCreator : "",
      slateYear:         settings.slateEnabled ? settings.slateYear : "",
      watermarkPath:     settings.watermarkEnabled ? settings.watermarkPath : "",
      watermarkCorner:   settings.watermarkCorner,
      watermarkOpacity:  settings.watermarkOpacity,
      watermarkSize:     settings.watermarkSize,
    };
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

  function buildBatchOutputPath(item) {
    const dir = item.path.replace(/[/\\][^/\\]+$/, "");
    const fileBase = item.name.replace(/\.[^.]+$/, "");
    const rendered = applyFilenameTemplate(settings.filenameTemplate, {
      filename: fileBase,
      resolution: settings.resolution,
      cropMode: settings.cropMode,
    });
    const ft = getFileType(item.path);
    const ext = ft === "image" ? `.${settings.outputImageFormat}` : ".mp4";
    return `${dir}/${rendered}${ext}`;
  }

  async function runBatch() {
    if (!isElectron) return;
    setBatchRunning(true);
    const items = queue;
    for (let i = 0; i < items.length; i++) {
      if (items[i].status !== "pending") continue;
      batchIndexRef.current = i;
      const outPath = buildBatchOutputPath(items[i]);
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
    const preset = presets[name];
    if (preset) setSettings({ ...DEFAULT_STATE, ...preset });
  }

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
      </header>

      <main className={styles.main}>

        {/* Batch mode toggle */}
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
            {Object.keys(presets).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button className={styles.btnGhost} onClick={handleSavePreset}>Save</button>
          <button className={styles.btnGhost} onClick={handleDeletePreset} disabled={!activePreset}>Delete</button>
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

            {activeTab === "framing" && (
              <div className={styles.tabGrid}>
                {/* Left column: position controls */}
                <div className={styles.tabCol}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>
                      Vertical Position
                      <span className={styles.numBadge}>{settings.sweetSpot}%</span>
                    </label>
                    <Slider min={0} max={100} value={settings.sweetSpot} onChange={set("sweetSpot")} />
                    <p className={styles.hint}>0% = top of dome · 100% = bottom</p>
                  </div>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>
                      Horizontal Position
                      <span className={styles.numBadge}>{settings.hPan}%</span>
                    </label>
                    <Slider min={0} max={100} value={settings.hPan} onChange={set("hPan")} />
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
                    <Slider min={100} max={400} value={settings.scale} onChange={set("scale")} />
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
                        <Slider min={120} max={PIP_MAX[settings.resolution]} value={settings.pipSize} onChange={set("pipSize")} />
                        <p className={styles.hint}>Default: {AUTO_PIP[settings.resolution]}px</p>
                      </div>
                      <div className={styles.field}>
                        <label className={styles.fieldLabel}>
                          Padding
                          <span className={styles.numBadge}>{settings.pipMargin}px</span>
                        </label>
                        <Slider min={0} max={300} value={settings.pipMargin} onChange={set("pipMargin")} />
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
                          <Slider min={0} max={100} value={settings.watermarkOpacity} onChange={set("watermarkOpacity")} />
                        </div>
                        <div className={styles.burnInRow}>
                          <label className={styles.burnInLabel}>
                            Size: {settings.watermarkSize}% of width
                          </label>
                          <Slider min={5} max={50} value={settings.watermarkSize} onChange={set("watermarkSize")} />
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

        {/* Convert / Cancel */}
        {!batchMode && (
          <div className={styles.actions}>
            {status !== "converting" ? (
              <button className={styles.btnConvert} disabled={!file} onClick={handleConvert}>
                Convert
              </button>
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
            <span className={styles.resultPath}>{doneOutput}</span>
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
