import type { CSSProperties, InputHTMLAttributes } from 'react'

type LiquidRangeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  style?: CSSProperties
}

export default function LiquidRange({
  className = '',
  min = 0,
  max = 100,
  value,
  style,
  ...inputProps
}: LiquidRangeProps) {
  const numericMin = Number(min)
  const numericMax = Number(max)
  const numericValue = Number(value)
  const span = numericMax - numericMin
  const progress = span > 0
    ? Math.min(100, Math.max(0, ((numericValue - numericMin) / span) * 100))
    : 0

  return (
    <span
      className={`liquid-range ${className}`.trim()}
      style={{ ...style, '--liquid-range-progress': `${progress}%` }}
    >
      <i aria-hidden="true" />
      <input
        {...inputProps}
        type="range"
        min={min}
        max={max}
        value={value}
      />
    </span>
  )
}
