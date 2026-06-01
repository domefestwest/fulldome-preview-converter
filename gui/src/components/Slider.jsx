import styles from "./Slider.module.css";

export default function Slider({ min, max, value, onChange, tooltip }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className={styles.wrapper}>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className={styles.slider}
        style={{ "--pct": `${pct}%` }}
        title={tooltip || undefined}
      />
      <div className={styles.ticks}>
        <span>{min}</span>
        <span>{Math.round((min + max) / 2)}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}
