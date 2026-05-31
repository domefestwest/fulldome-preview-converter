import { useEffect, useRef, useState } from "react";
import styles from "./Preview.module.css";

const RESOLUTIONS = {
  "4k":    { w: 3840, h: 2160 },
  "1080p": { w: 1920, h: 1080 },
};

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${sec}`;
}

export default function Preview({ frameSrc, isLoading, settings, duration, onScrub }) {
  const canvasRef = useRef(null);
  const imgRef    = useRef(null);
  const [seekPct, setSeekPct] = useState(Math.round(5 / Math.max(duration || 60, 1) * 100));

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

    const { resolution, sweetSpot, pipSize, pipMargin, pipPosition } = settings;
    const res      = RESOLUTIONS[resolution];
    const outW     = res.w;
    const outH     = res.h;
    const maxOffset = outW - outH;
    const cropOffset = Math.round(maxOffset * (1 - sweetSpot / 100));
    const pip      = pipSize || (resolution === "4k" ? 480 : 270);

    const scale = canvas.width / outW;
    const cH    = Math.round(outH * scale);
    if (canvas.height !== cH) canvas.height = cH;

    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background: scale source to square, draw shifted up by cropOffset
    const drawSide    = outW * scale;
    const drawCropTop = cropOffset * scale;
    ctx.drawImage(img, 0, -drawCropTop, drawSide, drawSide);

    // PiP: circular clip
    const pipPx  = pip * scale;
    const margin = pipMargin * scale;
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

  function handleSeekChange(e) {
    const pct = Number(e.target.value);
    setSeekPct(pct);
    if (duration && onScrub) {
      onScrub((pct / 100) * duration);
    }
  }

  if (!frameSrc && !isLoading) return null;

  const seekSeconds = duration ? (seekPct / 100) * duration : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.header}>
        <span className={styles.label}>Live Preview</span>
        {isLoading && <span className={styles.loadingBadge}>Extracting frame…</span>}
        {seekSeconds !== null && !isLoading && (
          <span className={styles.timecode}>{fmt(seekSeconds)}</span>
        )}
      </div>

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
      </div>

      {duration && (
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
    </div>
  );
}
