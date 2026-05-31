import { useState, useEffect } from "react";
import styles from "./ProgressBar.module.css";

function fmt(s) {
  const m = Math.floor(s / 60);
  const sec = String(Math.floor(s % 60)).padStart(2, "0");
  return `${m}:${sec}`;
}

export default function ProgressBar({ pct, startTime, done }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (done) return;
    const iv = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(iv);
  }, [done]);

  const elapsed = startTime ? (now - startTime) / 1000 : 0;
  const estimated = pct > 2 ? (elapsed / pct) * (100 - pct) : null;

  return (
    <div className={styles.wrapper}>
      <div className={styles.track}>
        <div
          className={[styles.fill, done ? styles.done : ""].join(" ")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className={styles.meta}>
        <span className={styles.pct}>{pct}%</span>
        <span className={styles.times}>
          {done
            ? `Completed in ${fmt(elapsed)}`
            : `${fmt(elapsed)} elapsed${estimated !== null ? ` · ~${fmt(estimated)} remaining` : ""}`}
        </span>
      </div>
    </div>
  );
}
