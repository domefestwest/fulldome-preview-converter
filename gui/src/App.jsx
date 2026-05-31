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

const IMAGE_EXTS = new Set([
  "jpg","jpeg","png","tif","tiff","exr","dpx","tga","bmp","webp","psd",
]);

function getFileType(filePath) {
  const ext = filePath.split(".").pop().toLowerCase();
  return IMAGE_EXTS.has(ext) ? "image" : "video";
}

const DEFAULT_STATE = {
  resolution:        "4k",
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
  outputImageFormat: "jpg",
};

function loadSavedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("dfw-settings") || "{}");
    return { ...DEFAULT_STATE, ...saved };
  } catch {
    return DEFAULT_STATE;
  }
}

const TABS = [
  { id: "framing", label: "Background Image" },
  { id: "pip",     label: "Picture-in-Picture" },
  { id: "export",  label: "Export" },
];

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
    if (!isElectron) return;
    const offProgress = window.api.onProgress(({ pct }) => setProgress(pct));
    const offDone = window.api.onConversionDone(({ outputPath: op }) => {
      setStatus("done"); setProgress(100); setDoneOutput(op);
    });
    const offError = window.api.onConversionError(({ message }) => {
      setStatus("error"); setErrorText(message);
    });
    return () => { offProgress(); offDone(); offError(); };
  }, [isElectron]);

  useEffect(() => {
    if (!file) return;
    const base = file.path.replace(/\.[^.]+$/, "");
    const suffix = `_${settings.resolution}_preview`;
    setOutputPath(fileType === "image"
      ? `${base}${suffix}.${settings.outputImageFormat}`
      : `${base}${suffix}.mp4`
    );
  }, [file, settings.resolution, fileType, settings.outputImageFormat]);

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

    const preset    = CRF_PRESETS.find((p) => p.value === settings.quality);
    const isManual  = settings.quality === "manual";

    if (isElectron) {
      await window.api.startConversion({
        inputPath:         file.path,
        outputPath,
        resolution:        settings.resolution,
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
      });
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

  const revealLabel = platform === "darwin" ? "Show in Finder"
                    : platform === "win32"   ? "Show in Explorer"
                    : "Show in Folder";

  return (
    <div className={styles.shell}>
      <header className={styles.titleBar}>
        <span className={styles.wordmark}>
          <span className={styles.dfw}>DOME FEST WEST</span>
          <span className={styles.toolName}>Fulldome Preview Converter</span>
        </span>
      </header>

      <main className={styles.main}>

        {/* Unified drop zone + live preview */}
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
        />

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
                      Vertical Position
                      <span className={styles.numBadge}>{settings.sweetSpot}%</span>
                    </label>
                    <Slider min={0} max={100} value={settings.sweetSpot} onChange={set("sweetSpot")} />
                    <p className={styles.hint}>0% = top of dome · 100% = bottom</p>
                  </div>
                </div>
                <div className={styles.tabCol}>
                  <div className={styles.field}>
                    <label className={styles.fieldLabel}>
                      Scale
                      <span className={styles.numBadge}>{settings.scale}%</span>
                    </label>
                    <Slider min={100} max={400} value={settings.scale} onChange={set("scale")} />
                    <p className={styles.hint}>Zoom in to fill black corners</p>
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
                          <label className={styles.burnInLabel}>Title text (top center)</label>
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
                          Filename (bottom left)
                        </label>
                        <label className={styles.burnInCheck}>
                          <input type="checkbox" checked={settings.burninFramenumber}
                            onChange={(e) => set("burninFramenumber")(e.target.checked)} />
                          Frame number (bottom right)
                        </label>
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
        <div className={styles.actions}>
          {status !== "converting" ? (
            <button className={styles.btnConvert} disabled={!file} onClick={handleConvert}>
              Convert
            </button>
          ) : (
            <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
          )}
        </div>

        {(status === "converting" || status === "done") && (
          <ProgressBar pct={progress} startTime={startTime} done={status === "done"} />
        )}

        {status === "done" && (
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

        {status === "error" && (
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
