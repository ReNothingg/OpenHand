export default function Toggle({ label, checked, onChange, children }) {
  return (
    <div className={`toggle-block ${checked ? 'is-on' : ''}`}>
      <label className="toggle-row">
        <span>{label}</span>
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <i aria-hidden="true" />
      </label>
      {checked && children}
    </div>
  )
}
