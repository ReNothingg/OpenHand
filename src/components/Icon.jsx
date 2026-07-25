export default function Icon({ name, className = '' }) {
  return (
    <span
      className={`svg-icon ${className}`.trim()}
      style={{ '--icon-url': `url("/icons/${name}.svg")` }}
      aria-hidden="true"
    />
  )
}
