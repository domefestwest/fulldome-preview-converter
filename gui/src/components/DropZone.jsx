import { useState, useRef } from "react";
import styles from "./DropZone.module.css";

export default function DropZone({ file, onDrop, onBrowse, disabled, isElectron }) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef(null);

  function handleDragOver(e) {
    e.preventDefault();
    if (!disabled) setDragging(true);
  }
  function handleDragLeave() { setDragging(false); }

  function handleDrop(e) {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const f = e.dataTransfer.files[0];
    if (f && f.name.toLowerCase().endsWith(".mp4")) {
      // In Electron the path property is available on the File object
      onDrop(f.path || f.name);
    }
  }

  function handleFileInput(e) {
    const f = e.target.files[0];
    if (f) onDrop(f.path || f.name);
    e.target.value = "";
  }

  function handleClick() {
    if (disabled) return;
    if (isElectron) {
      onBrowse();
    } else {
      inputRef.current?.click();
    }
  }

  return (
    <div
      className={[
        styles.zone,
        dragging ? styles.dragging : "",
        disabled ? styles.disabled : "",
        file ? styles.hasFile : "",
      ].join(" ")}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      aria-label="Drop MP4 file or click to browse"
    >
      <input
        ref={inputRef}
        type="file"
        accept=".mp4"
        className={styles.hiddenInput}
        onChange={handleFileInput}
      />

      {!file ? (
        <div className={styles.empty}>
          <svg className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
          </svg>
          <p className={styles.prompt}>Drop a fulldome <strong>.mp4</strong> here</p>
          <p className={styles.sub}>or click to browse</p>
        </div>
      ) : (
        <div className={styles.fileInfo}>
          <svg className={styles.fileIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9A2.25 2.25 0 0013.5 5.25h-9A2.25 2.25 0 002.25 7.5v9A2.25 2.25 0 004.5 18.75z" />
          </svg>
          <div className={styles.fileDetails}>
            <span className={styles.fileName}>{file.name}</span>
            <span className={styles.fileMeta}>{file.width}×{file.height} · click to change</span>
          </div>
        </div>
      )}
    </div>
  );
}
