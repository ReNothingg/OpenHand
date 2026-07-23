function glyphWidth(strokes) {
  const points = strokes.flat()
  if (!points.length) return { minX: 0, width: 150 }
  const xs = points.map((point) => point.x)
  const minX = Math.min(...xs)
  return { minX, width: Math.max(90, Math.max(...xs) - minX + 32) }
}

function strokePath(stroke, offsetX, minX, scale) {
  return stroke.map((point, index) => (
    `${index === 0 ? 'M' : 'L'} ${offsetX + (point.x - minX) * scale} ${92 + point.y * scale}`
  )).join(' ')
}

export default function FontPreview({ text, glyphs }) {
  const scale = 0.19
  let cursor = 18
  const paths = []

  Array.from(text).forEach((character, characterIndex) => {
    if (/\s/u.test(character)) {
      cursor += 28
      return
    }
    const strokes = glyphs[character] || []
    const metrics = glyphWidth(strokes)
    strokes.forEach((stroke, strokeIndex) => {
      paths.push(
        <path
          d={strokePath(stroke, cursor, metrics.minX, scale)}
          key={`${characterIndex}-${strokeIndex}`}
        />,
      )
    })
    cursor += metrics.width * scale
  })

  return (
    <svg className="font-preview-svg" viewBox={`0 0 ${Math.max(720, cursor + 18)} 124`} role="img" aria-label="Предпросмотр шрифта">
      <line x1="18" x2={Math.max(702, cursor)} y1="92" y2="92" />
      <g>{paths}</g>
    </svg>
  )
}
