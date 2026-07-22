export default function RangeControl({ label, value, min, max, step = 1, suffix = '', onChange, hint }) {
  return (
    <label className="range-control">
      <span className="control-heading"><span>{label}</span><output>{value}{suffix}</output></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      {hint && <small>{hint}</small>}
    </label>
  )
}
