import { useId } from "react";

export default function Toggle({ label, checked, onChange, children }) {
  const inputId = useId();

  return (
    <div className={`toggle-block ${checked ? "is-on" : ""}`}>
      <label className="toggle-row" htmlFor={inputId}>
        <span>{label}</span>
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <i aria-hidden="true" />
      </label>
      {checked && children}
    </div>
  );
}
