export default function RangeControl({ label, value, min, max, step = 1, suffix = '', onChange, hint }) {
  return (
    <label className="range-control">
      <span className="control-heading">
        <span className="control-label">
          {label}
          {hint && <span className="setting-help" tabIndex="0" title={hint} aria-label={hint}>!</span>}
        </span>
        <output>{value}{suffix}</output>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  )
}
