import { useId } from 'react'
import LiquidRange from '../../controls/LiquidRange.jsx'

export default function RangeControl({ label, value, min, max, step = 1, suffix = '', onChange, hint, disabled = false }) {
  const inputId = useId()
  const hintId = hint ? `${inputId}-hint` : undefined

  return (
    <div className={`range-control ${disabled ? 'is-disabled' : ''}`}>
      <span className="control-heading">
        <label className="control-label" htmlFor={inputId}>
          {label}
          {hint && <span id={hintId} className="setting-help" tabIndex="0" title={hint} aria-label={hint}>!</span>}
        </label>
        <output htmlFor={inputId}>{value}{suffix}</output>
      </span>
      <LiquidRange
        id={inputId}
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-describedby={hintId}
        disabled={disabled}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  )
}
