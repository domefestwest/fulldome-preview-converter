import { useState, useEffect, useRef } from "react";
import styles from "./App.module.css";
import DropZone from "./components/DropZone.jsx";
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
];

const DEFAULT_STATE = {
  resolution: "4k",
  sweetSpot: 30,
  pipSize: 480,
  pipMargin: 40,
  pipPosition: "br",
  audio: "stereo",
  quality: "standard",
};

function loadSavedSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem("dfw-settings") || "{}");
    return { ...DEFAULT_STATE, ...saved };
  } catch {
    return DEFAULT_STATE;
  }
}

export default function App() {
  const [file, setFile]             = useState(null);
  const [fileDuration, setFileDuration] = useState(null);
  const [frameSrc, setFrameSrc]     = useState(null);
  const [frameLoading, setFrameLoading] = useState(false);
  const [outputPath, setOutputPath] = useState("");
  const [settings, setSettings]     = useState(loadSavedSettings);

  const [status, setStatus]     = useState("idle"); // idle | converting | done | error
  const [progress, setProgress] = useState(0);
  const [startTime, setStartTime] = useState(null);
  const [errorText, setErrorText] = useState("");
  const [doneOutput, setDoneOutput] = useState("");

  const scrubTimerRef = useRef(null);
  const isElectron = typeof window.api !== "undefined";
  const platform   = window.api?.platform || "darwin";

  // ---- persist settings ----
  useEffect(() => {
    localStorage.setItem("dfw-settings", JSON.stringify(settings));
  }, [settings]);

  // ---- register IPC listeners ----
  useEffect(() => {
    if (!isElectron) return;
    const offProgress = window.api.onProgress(({ pct }) => setProgress(pct));
    const offDone = window.api.onConversionDone(({ outputPath: op }) => {
      setStatus("done");
      setProgress(100);
      setDoneOutput(op);
    });
    const offError = window.api.onConversionError(({ message }) => {
      setStatus("error");
      setErrorText(message);
    });
    return () => { offProgress(); offDone(); offError(); };
  }, [isElectron]);

  // ---- auto output path ----
  useEffect(() => {
    if (!file) return;
    const base = file.path.replace(/\.mp4$/i, "");
    setOutputPath(`${base}_${settings.resolution}_preview.mp4`);
  }, [file, settings.resolution]);

  const set = (key) => (val) => setSettings((s) => ({ ...s, [key]: val }));

  // Reset pip size to auto default when resolution changes
  useEffect(() => {
    setSettings((s) => ({ ...s, pipSize: AUTO_PIP[s.resolution] }));
  }, [settings.resolution]);

  async function handleFileDrop(filePath) {
    setFile(null);
    setFrameSrc(null);
    setFileDuration(null);
    setStatus("idle");
    setFrameLoading(true);

    let info = { path: filePath, name: filePath.split(/[/\\]/).pop(), width: "?", height: "?" };

    if (isElectron) {
      const [probe, frame] = await Promise.all([
        window.api.probeFile(filePath),
        window.api.extractFrame(filePath),
      ]);
      if (probe) {
        info.width  = probe.width;
        info.height = probe.height;
        setFileDuration(probe.duration || null);
      }
      setFrameSrc(frame);
    } else {
      setFrameSrc(makeDemoFrame());
      setFileDuration(60);
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
    if (!file) return;
    clearTimeout(scrubTimerRef.current);
    scrubTimerRef.current = setTimeout(async () => {
      setFrameLoading(true);
      let frame = null;
      if (isElectron) {
        frame = await window.api.scrubFrame(file.path, seekSeconds);
      } else {
        frame = makeDemoFrame(); // browser demo
      }
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
    const p = await window.api.browseOutputDir(outputPath);
    if (p) setOutputPath(p);
  }

  async function handleConvert() {
    if (!file || status === "converting") return;

    // Overwrite warning
    if (isElectron) {
      const ok = await window.api.confirmOverwrite(outputPath);
      if (!ok) return;
    }

    setStatus("converting");
    setProgress(0);
    setStartTime(Date.now());
    setErrorText("");
    setDoneOutput("");

    const crf = CRF_PRESETS.find((p) => p.value === settings.quality)?.crf ?? 18;

    if (isElectron) {
      await window.api.startConversion({
        inputPath:   file.path,
        outputPath,
        resolution:  settings.resolution,
        sweetSpot:   settings.sweetSpot,
        pipSize:     settings.pipSize,
        pipMargin:   settings.pipMargin,
        pipPosition: settings.pipPosition,
        audio:       settings.audio,
        crf,
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

  const revealLabel = platform === "darwin" ? "Show in Finder" : platform === "win32" ? "Show in Explorer" : "Show in Folder";

  return (
    <div className={styles.shell}>
      <header className={styles.titleBar}>
        <span className={styles.wordmark}>
          <span className={styles.dfw}>DOME FEST WEST</span>
          <span className={styles.toolName}>Fulldome Preview Converter</span>
        </span>
      </header>

      <main className={styles.main}>
        <DropZone
          file={file}
          onDrop={handleFileDrop}
          onBrowse={handleBrowse}
          disabled={status === "converting"}
          isElectron={isElectron}
        />

        <Preview
          frameSrc={frameSrc}
          isLoading={frameLoading}
          settings={settings}
          duration={fileDuration}
          onScrub={handleScrub}
        />

        <div className={styles.grid}>
          {/* Left column */}
          <div className={styles.col}>
            <section className={styles.card}>
              <label className={styles.cardLabel}>Output Resolution</label>
              <ToggleGroup
                options={[{ value: "4k", label: "4K  (3840×2160)" }, { value: "1080p", label: "1080p  (1920×1080)" }]}
                value={settings.resolution}
                onChange={set("resolution")}
              />
            </section>

            <section className={styles.card}>
              <label className={styles.cardLabel}>
                Crop Position (Sweet Spot)
                <span className={styles.numBadge}>{settings.sweetSpot}%</span>
              </label>
              <Slider min={0} max={100} value={settings.sweetSpot} onChange={set("sweetSpot")} />
              <p className={styles.hint}>0% = top of dome · 50% = midpoint · 100% = bottom</p>
            </section>

            <section className={styles.card}>
              <label className={styles.cardLabel}>Audio</label>
              <ToggleGroup
                options={[
                  { value: "stereo",      label: "Downmix to stereo" },
                  { value: "passthrough", label: "Passthrough" },
                ]}
                value={settings.audio}
                onChange={set("audio")}
              />
            </section>

            <section className={styles.card}>
              <label className={styles.cardLabel}>Quality</label>
              <ToggleGroup
                options={CRF_PRESETS.map((p) => ({ value: p.value, label: p.label }))}
                value={settings.quality}
                onChange={set("quality")}
              />
              <p className={styles.hint}>
                Draft = faster/smaller · Standard = balanced · High = near-lossless
              </p>
            </section>
          </div>

          {/* Right column */}
          <div className={styles.col}>
            <section className={styles.card}>
              <label className={styles.cardLabel}>PiP Position</label>
              <PipPositionPicker value={settings.pipPosition} onChange={set("pipPosition")} />
            </section>

            <section className={styles.card}>
              <label className={styles.cardLabel}>
                PiP Size
                <span className={styles.numBadge}>{settings.pipSize}px</span>
              </label>
              <Slider min={120} max={PIP_MAX[settings.resolution]} value={settings.pipSize} onChange={set("pipSize")} />
              <p className={styles.hint}>Default: {AUTO_PIP[settings.resolution]}px</p>
            </section>

            <section className={styles.card}>
              <label className={styles.cardLabel}>
                PiP Image Padding
                <span className={styles.numBadge}>{settings.pipMargin}px</span>
              </label>
              <Slider min={0} max={300} value={settings.pipMargin} onChange={set("pipMargin")} />
            </section>
          </div>
        </div>

        {/* Output path */}
        <section className={styles.card}>
          <label className={styles.cardLabel}>Output Path</label>
          <div className={styles.outputRow}>
            <span className={styles.outputPathText} title={outputPath}>
              {outputPath || (file ? "…" : "Load a file first")}
            </span>
            {file && status !== "converting" && (
              <button className={styles.btnGhost} onClick={handleBrowseOutput}>Change…</button>
            )}
          </div>
        </section>

        {/* Convert button */}
        <div className={styles.actions}>
          {status !== "converting" ? (
            <button
              className={styles.btnConvert}
              disabled={!file}
              onClick={handleConvert}
            >
              Convert
            </button>
          ) : (
            <button className={styles.btnCancel} onClick={handleCancel}>Cancel</button>
          )}
        </div>

        {/* Progress */}
        {(status === "converting" || status === "done") && (
          <ProgressBar pct={progress} startTime={startTime} done={status === "done"} />
        )}

        {/* Success */}
        {status === "done" && (
          <div className={styles.resultSuccess}>
            <span className={styles.successIcon}>✓</span>
            <span className={styles.resultPath}>{doneOutput}</span>
            <div className={styles.resultActions}>
              <button className={styles.btnGhost} onClick={() => isElectron && window.api.openFile(doneOutput)}>
                Open File
              </button>
              <button className={styles.btnGhost} onClick={() => isElectron && window.api.openFolder(doneOutput)}>
                {revealLabel}
              </button>
              <button className={styles.btnGhost} onClick={() => setStatus("idle")}>
                Convert Another
              </button>
            </div>
          </div>
        )}

        {/* Error */}
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
