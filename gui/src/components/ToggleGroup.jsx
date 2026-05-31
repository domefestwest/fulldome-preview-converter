import styles from "./ToggleGroup.module.css";

export default function ToggleGroup({ options, value, onChange }) {
  return (
    <div className={styles.group}>
      {options.map((opt) => (
        <button
          key={opt.value}
          className={[styles.btn, value === opt.value ? styles.active : ""].join(" ")}
          onClick={() => onChange(opt.value)}
          type="button"
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
