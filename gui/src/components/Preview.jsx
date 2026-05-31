import { useEffect, useRef, useState } from "react";
import styles from "./Preview.module.css";

const RESOLUTIONS = {
  "4k":    { w: 3840, h: 2160 },
  "1080p": { w: 1920, h: 1080 },
};

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

export default function Preview({
  frameSrc, isLoading, settings, duration, onScrub, fileType,
  file, onDrop, onBrowse, disabled, isElectron,
}) {
  const canvasRef  = useRef(null);
  const imgRef     = useRef(null);
  const inputRef   = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [seekPct, setSeekPct]   = useState(Math.round(5 / Math.max(duration || 60, 1) * 100));

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
      resolution, sweetSpot, pipSize, pipMargin, pipPosition,
      scale: scalePct = 100, hPan = 50,
    } = settings;

    const res         = RESOLUTIONS[resolution];
    const outW        = res.w;
    const outH        = res.h;
    const scaleFactor = scalePct / 100;

    const scaleDim  = outW * scaleFactor;
    const maxY      = scaleDim - outH;
    const maxX      = scaleDim - outW;
    const cropY     = Math.round(maxY * (1 - sweetSpot / 100));
    const cropX     = maxX > 0 ? Math.round(maxX * (hPan / 100)) : 0;

    const pip    = pipSize || (resolution === "4k" ? 480 : 270);
    const cScale = canvas.width / outW;
    const cH     = Math.round(outH * cScale);
    if (canvas.height !== cH) canvas.height = cH;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const drawSide     = scaleDim * cScale;
    const drawCropTop  = cropY * cScale;
    const drawCropLeft = cropX * cScale;
    ctx.drawImage(img, -drawCropLeft, -drawCropTop, drawSide, drawSide);

    if (settings.pipEnabled !== false) {
      const pipPx  = pip * cScale;
      const margin = pipMargin * cScale;
      let px, py;
      if (pipPosition === "br") { px = canvas.width - pipPx - margin; py = cH - pipPx - margin; }
      if (pipPosition === "bl") { px = margin;                         py = cH - pipPx - margin; }
      if (pipPosition === "tr") { px = canvas.width - pipPx - margin; py = margin; }
      if (pipPosition === "tl") { px = margin;                         py = margin; }

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
  }

  function handleSeekChange(e) {
    const pct = Number(e.target.value);
    setSeekPct(pct);
    if (duration && onScrub) onScrub((pct / 100) * duration);
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
              width={960}
              height={540}
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
        </>
      )}
    </div>
  );
}
