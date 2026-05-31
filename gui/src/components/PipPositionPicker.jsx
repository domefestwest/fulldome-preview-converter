import styles from "./PipPositionPicker.module.css";

const POSITIONS = [
  { value: "tl", label: "↖", row: 0, col: 0 },
  { value: "tr", label: "↗", row: 0, col: 1 },
  { value: "bl", label: "↙", row: 1, col: 0 },
  { value: "br", label: "↘", row: 1, col: 1 },
];

const LABELS = { tl: "Top-left", tr: "Top-right", bl: "Bottom-left", br: "Bottom-right" };

export default function PipPositionPicker({ value, onChange }) {
  return (
    <div className={styles.wrapper}>
      <div className={styles.screen}>
        {POSITIONS.map((p) => (
          <button
            key={p.value}
            type="button"
            className={[
              styles.corner,
              styles[`r${p.row}c${p.col}`],
              value === p.value ? styles.active : "",
            ].join(" ")}
            onClick={() => onChange(p.value)}
            title={LABELS[p.value]}
            aria-label={LABELS[p.value]}
            aria-pressed={value === p.value}
          >
            <span className={styles.dot} />
          </button>
        ))}
      </div>
      <span className={styles.label}>{LABELS[value]}</span>
    </div>
  );
}
