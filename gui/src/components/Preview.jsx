import { useEffect, useRef, useState } from "react";
import styles from "./Preview.module.css";

const VIDEO_EXTS = new Set([
  "mp4","mov","m4v","avi","mkv","mxf","mts","m2ts","webm","flv","wmv","3gp","mpg","mpeg","ts","dv",
]);
const IMAGE_EXTS = new Set([
  "jpg","jpeg","png","tif","tiff","exr","dpx","tga","bmp","webp","psd",
]);

function isSupportedFile(name) {
  const ext = name.split(".").pop().toLowerCase();
  return VIDEO_EXTS.has(ext) || IMAGE_EXTS.has(ext);
}

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${sec}`;
}

function getOutputDims(resolution, cropMode) {
  const base = resolution === "4k" ? 2160 : 1080;
  if (cropMode === "16:9") return { w: Math.round(base * 16 / 9), h: base };
  if (cropMode === "9:16") return { w: base, h: Math.round(base * 16 / 9) };
  return { w: base, h: base };
}

export default function Preview({
  frameSrc, isLoading, settings, duration, onScrub, fileType,
  file, onDrop, onBrowse, disabled, isElectron, onTrimChange,
}) {
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const inputRef   = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [seekPct, setSeekPct]   = useState(Math.round(5 / Math.max(duration || 60, 1) * 100));

  // Trim state (local, synced up via onTrimChange)
  const [trimStart, setTrimStart] = useState(settings.trimStart || 0);
  const [trimEnd, setTrimEnd]     = useState(settings.trimEnd || duration || 0);

  // Sync trimEnd when duration changes
  useEffect(() => {
    if (duration && (settings.trimEnd == null || settings.trimEnd === 0)) {
      setTrimEnd(duration);
    }
  }, [duration]);

  useEffect(() => {
    setTrimStart(settings.trimStart || 0);
    setTrimEnd(settings.trimEnd != null ? settings.trimEnd : (duration || 0));
  }, [settings.trimStart, settings.trimEnd, duration]);

  useEffect(() => {
    if (!frameSrc) return;
    const img = new Image();
    img.onload = () => { imgRef.current = img; draw(); };
    img.src = frameSrc;
  }, [frameSrc]);

  useEffect(() => {
    if (imgRef.current) draw();
  }, [settings]);

  function draw() {
    const canvas = canvasRef.current;
    const img    = imgRef.current;
    if (!canvas || !img) return;

    const {
      resolution, cropMode = "16:9",
      sweetSpot, pipSize, pipMargin, pipPosition,
      scale: scalePct = 100, hPan = 50,
      burninEnabled, burninTitle, burninFilename, burninFramenumber, burninCorner = "bl",
      slateEnabled, slateTitle, slateCreator, slateYear,
      watermarkEnabled, watermarkCorner = "br", watermarkSize = 15,
    } = settings;

    const { w: outW, h: outH } = getOutputDims(resolution, cropMode);
    const scaleFactor = scalePct / 100;

    // For non-16:9 modes the source square may need to be bigger
    const baseDim   = Math.max(outW, outH);
    const scaleDim  = baseDim * scaleFactor;
    const maxY      = scaleDim - outH;
    const maxX      = scaleDim - outW;
    const cropY     = maxY > 0 ? Math.round(maxY * (1 - sweetSpot / 100)) : 0;
    const cropX     = maxX > 0 ? Math.round(maxX * (hPan / 100)) : 0;

    const pip    = pipSize || (resolution === "4k" ? 480 : 270);

    // Set canvas dimensions based on aspect ratio
    // Display: max height 480px, width computed from aspect
    const displayH = 480;
    const displayW = Math.round(displayH * outW / outH);
    canvas.width  = displayW;
    canvas.height = displayH;

    const cScale = displayW / outW;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, displayW, displayH);

    const drawSide     = scaleDim * cScale;
    const drawCropTop  = cropY * cScale;
    const drawCropLeft = cropX * cScale;
    ctx.drawImage(img, -drawCropLeft, -drawCropTop, drawSide, drawSide);

    if (settings.pipEnabled !== false) {
      const pipPx  = pip * cScale;
      const margin = pipMargin * cScale;
      let px, py;
      if (pipPosition === "br") { px = displayW - pipPx - margin; py = displayH - pipPx - margin; }
      if (pipPosition === "bl") { px = margin;                     py = displayH - pipPx - margin; }
      if (pipPosition === "tr") { px = displayW - pipPx - margin; py = margin; }
      if (pipPosition === "tl") { px = margin;                     py = margin; }

      ctx.save();
      ctx.beginPath();
      ctx.arc(px + pipPx / 2, py + pipPx / 2, pipPx / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.drawImage(img, px, py, pipPx, pipPx);
      ctx.restore();

      ctx.beginPath();
      ctx.arc(px + pipPx / 2, py + pipPx / 2, pipPx / 2, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.25)";
      ctx.lineWidth   = 1.5;
      ctx.stroke();
    }

    // Burn-in overlay preview
    if (burninEnabled) {
      const lines = [];
      if (burninTitle)       lines.push(burninTitle);
      if (burninFilename)    lines.push(file?.name || "filename.mp4");
      if (burninFramenumber) lines.push("Frame: 000");

      if (lines.length > 0) {
        const fontSize  = Math.max(10, Math.round(14 * cScale));
        const lineH     = fontSize + Math.round(6 * cScale);
        const margin    = Math.round(10 * cScale);

        ctx.font      = `600 ${fontSize}px system-ui, sans-serif`;
        ctx.textAlign = burninCorner === "bl" ? "left" : "right";

        lines.forEach((text, i) => {
          const x = burninCorner === "bl" ? margin : displayW - margin;
          const y = displayH - margin - (lines.length - 1 - i) * lineH;
          ctx.lineWidth   = Math.max(2, Math.round(3 * cScale));
          ctx.strokeStyle = "rgba(0,0,0,0.8)";
          ctx.strokeText(text, x, y);
          ctx.fillStyle = "white";
          ctx.fillText(text, x, y);
        });
      }
    }

    // Slate bar preview
    if (slateEnabled && (slateTitle || slateCreator || slateYear)) {
      const barH = Math.round(displayH * 0.10);
      // Expand canvas height to fit slate
      canvas.height = displayH + barH;
      ctx.fillStyle = "#000";
      ctx.fillRect(0, displayH, displayW, barH);

      if (slateTitle) {
        ctx.font = `bold ${Math.max(8, Math.round(16 * cScale))}px system-ui, sans-serif`;
        ctx.fillStyle = "white";
        ctx.textAlign = "center";
        ctx.fillText(slateTitle, displayW / 2, displayH + barH / 2 + 5);
      }
      if (slateCreator) {
        ctx.font = `${Math.max(7, Math.round(12 * cScale))}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.textAlign = "left";
        ctx.fillText(slateCreator, 10 * cScale, displayH + barH - 6 * cScale);
      }
      if (slateYear) {
        ctx.font = `${Math.max(7, Math.round(12 * cScale))}px system-ui, sans-serif`;
        ctx.fillStyle = "rgba(255,255,255,0.65)";
        ctx.textAlign = "right";
        ctx.fillText(slateYear, displayW - 10 * cScale, displayH + barH - 6 * cScale);
      }
    }

    // Watermark placeholder
    if (watermarkEnabled && settings.watermarkPath) {
      const wPx = Math.round(displayW * watermarkSize / 100);
      const wH  = Math.round(wPx * 0.5); // estimate
      const margin = 10;
      let wx, wy;
      if (watermarkCorner === "br") { wx = displayW - wPx - margin; wy = displayH - wH - margin; }
      else if (watermarkCorner === "bl") { wx = margin; wy = displayH - wH - margin; }
      else if (watermarkCorner === "tr") { wx = displayW - wPx - margin; wy = margin; }
      else { wx = margin; wy = margin; }

      ctx.save();
      ctx.globalAlpha = (settings.watermarkOpacity || 80) / 100;
      ctx.fillStyle = "rgba(255,255,255,0.2)";
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1;
      ctx.fillRect(wx, wy, wPx, wH);
      ctx.strokeRect(wx, wy, wPx, wH);
      ctx.font = `bold ${Math.max(8, Math.round(11 * cScale))}px system-ui, sans-serif`;
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.textAlign = "center";
      ctx.fillText("LOGO", wx + wPx / 2, wy + wH / 2 + 4);
      ctx.restore();
    }
  }

  function handleSeekChange(e) {
    const pct = Number(e.target.value);
    setSeekPct(pct);
    if (duration && onScrub) onScrub((pct / 100) * duration);
  }

  function handleTrimStartChange(e) {
    const val = Number(e.target.value);
    const clamped = Math.min(val, trimEnd - 0.1);
    setTrimStart(clamped);
    onTrimChange?.({ start: clamped, end: trimEnd });
  }

  function handleTrimEndChange(e) {
    const val = Number(e.target.value);
    const clamped = Math.max(val, trimStart + 0.1);
    setTrimEnd(clamped);
    onTrimChange?.({ start: trimStart, end: clamped });
  }

  // ---- drag-and-drop on the zone ----
  function handleDragOver(e) {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }
  function handleDragLeave() { setDragging(false); }
  function handleDropFile(e) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f && isSupportedFile(f.name)) onDrop(f.path || f.name);
  }
  function handleFileInput(e) {
    const f = e.target.files[0];
    if (f) onDrop(f.path || f.name);
    e.target.value = "";
  }
  function handleBrowseClick() {
    if (disabled) return;
    if (isElectron) onBrowse();
    else inputRef.current?.click();
  }

  const isImage     = fileType === "image";
  const seekSeconds = duration ? (seekPct / 100) * duration : null;
  const hasFile     = !!frameSrc || isLoading;
  const showTrim    = !isImage && duration && duration > 0;

  return (
    <div
      className={[
        styles.zone,
        dragging    ? styles.dragging  : "",
        !hasFile    ? styles.empty     : "",
        disabled    ? styles.disabled  : "",
      ].join(" ")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDropFile}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,.mov,.m4v,.avi,.mkv,.mxf,.webm,.jpg,.jpeg,.png,.tif,.tiff,.exr,.dpx,.tga,.bmp,.webp"
        className={styles.hiddenInput}
        onChange={handleFileInput}
      />

      {/* Empty state — no file loaded yet */}
      {!hasFile && (
        <div
          className={styles.emptyState}
          onClick={handleBrowseClick}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && handleBrowseClick()}
          aria-label="Drop fulldome file or click to browse"
        >
          <svg className={styles.uploadIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className={styles.emptyTitle}>Drop a fulldome file here</p>
          <p className={styles.emptySub}>Video (MP4, MOV, MKV…) or image (JPEG, PNG, EXR…)</p>
          <p className={styles.emptySub}>or <span className={styles.browseLink}>click to browse</span></p>
        </div>
      )}

      {/* Preview canvas */}
      {hasFile && (
        <>
          <div className={styles.canvasWrapper}>
            <canvas
              ref={canvasRef}
              className={[styles.canvas, isLoading ? styles.dimmed : ""].join(" ")}
            />
            {isLoading && (
              <div className={styles.loadingOverlay}>
                <span className={styles.spinner} />
              </div>
            )}

            {/* File info bar overlaid at bottom of canvas */}
            {file && !isLoading && (
              <div className={styles.fileBar}>
                <span className={styles.fileName}>{file.name}</span>
                <span className={styles.fileMeta}>{file.width}×{file.height}</span>
                {!isLoading && (
                  <button className={styles.changeBtn} onClick={handleBrowseClick} disabled={disabled}>
                    Change file
                  </button>
                )}
                {!isLoading && seekSeconds !== null && !isImage && (
                  <span className={styles.timecode}>{fmt(seekSeconds)}</span>
                )}
              </div>
            )}
          </div>

          {/* Scrubber — video only */}
          {duration && !isImage && (
            <div className={styles.scrubRow}>
              <span className={styles.scrubLabel}>0:00</span>
              <input
                type="range"
                min={0} max={100}
                value={seekPct}
                onChange={handleSeekChange}
                className={styles.scrubSlider}
                style={{ "--pct": `${seekPct}%` }}
                aria-label="Scrub to frame"
              />
              <span className={styles.scrubLabel}>{fmt(duration)}</span>
            </div>
          )}

          {/* Trim controls — video only */}
          {showTrim && (
            <div className={styles.trimSection}>
              <div className={styles.trimRow}>
                <span className={styles.trimLabel}>In</span>
                <input
                  type="range"
                  className={styles.trimSlider}
                  min={0} max={duration} step={0.1}
                  value={trimStart}
                  onChange={handleTrimStartChange}
                  style={{ "--pct": `${(trimStart / duration) * 100}%` }}
                />
                <span className={styles.trimTime}>{fmt(trimStart)}</span>
              </div>
              <div className={styles.trimRow}>
                <span className={styles.trimLabel}>Out</span>
                <input
                  type="range"
                  className={styles.trimSlider}
                  min={0} max={duration} step={0.1}
                  value={trimEnd}
                  onChange={handleTrimEndChange}
                  style={{ "--pct": `${(trimEnd / duration) * 100}%` }}
                />
                <span className={styles.trimTime}>{fmt(trimEnd)}</span>
              </div>
              <p className={styles.trimDuration}>
                Duration: {fmt(Math.max(0, trimEnd - trimStart))}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
