import { memo, useMemo } from 'react'

function svgPath(strokes) {
  return strokes
    .map((stroke) => stroke.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(''))
    .join('')
}

function pointOnStroke(stroke, progress) {
  const segments = []
  let total = 0
  for (let index = 1; index < stroke.length; index += 1) {
    const length = Math.hypot(stroke[index].x - stroke[index - 1].x, stroke[index].y - stroke[index - 1].y)
    if (length > 0) {
      total += length
      segments.push({ start: stroke[index - 1], end: stroke[index], length, endDistance: total })
    }
  }
  if (!segments.length) return null
  const target = total * Math.max(0, Math.min(1, progress))
  let low = 0
  let high = segments.length - 1
  while (low < high) {
    const middle = Math.floor((low + high) / 2)
    if (segments[middle].endDistance < target) low = middle + 1
    else high = middle
  }
  const segment = segments[low]
  const startDistance = segment.endDistance - segment.length
  const ratio = Math.max(0, Math.min(1, (target - startDistance) / segment.length))
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  }
}

function PlotterPaper({ layout, settings, metrics, pageIndex, playback }) {
  const orderedStrokes = playback?.strokes?.length ? playback.strokes : (layout?.strokes || [])
  const playbackHead = useMemo(
    () => {
      if (!playback?.active) return null
      for (let index = orderedStrokes.length - 1; index >= 0; index -= 1) {
        const progress = playback.strokeProgress?.[index] || 0
        if (progress > 0) return pointOnStroke(orderedStrokes[index], progress)
      }
      return null
    },
    [orderedStrokes, playback?.active, playback?.strokeProgress],
  )
  const pageWidth = layout?.page?.pageWidth || metrics.width * 25.4 / 96
  const pageHeight = layout?.page?.pageHeight || metrics.height * 25.4 / 96

  return (
    <svg className="integrated-plotter-paper" viewBox={`0 0 ${pageWidth} ${pageHeight}`} preserveAspectRatio="none" shapeRendering="geometricPrecision" aria-label={`Траектория листа ${pageIndex + 1}`}>
      <defs>
        <pattern id={`plotter-rules-${pageIndex}`} width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 5 5 L 0 5" className="plotter-rule-line" />
        </pattern>
      </defs>
      <rect className="plotter-paper-background" x="0" y="0" width={pageWidth} height={pageHeight} style={{ fill: settings.pageColor }} />
      {settings.pageSize.startsWith('Notebook') && <>
        <rect className="plotter-grid-fill" x="0" y="0" width={pageWidth} height={pageHeight} style={{ fill: `url(#plotter-rules-${pageIndex})` }} />
        {settings.pageSize === 'NotebookSpread' ? <>
          <line className="plotter-margin-line" x1="16.5" y1="0" x2="16.5" y2={pageHeight} />
          <line className="plotter-binding-line" x1={pageWidth / 2} y1="0" x2={pageWidth / 2} y2={pageHeight} />
          <line className="plotter-margin-line" x1={pageWidth - 16.5} y1="0" x2={pageWidth - 16.5} y2={pageHeight} />
        </> : <line className="plotter-margin-line" x1={pageIndex % 2 === 0 ? pageWidth - 16.5 : 16.5} y1="0" x2={pageIndex % 2 === 0 ? pageWidth - 16.5 : 16.5} y2={pageHeight} />}
      </>}
      {orderedStrokes.map((stroke, index) => {
        const pressure = stroke.pressure || 1
        const completed = playback?.active ? (playback.strokeProgress?.[index] || 0) : 1
        const path = svgPath([stroke])
        return (
          <g key={index}>
            <path className="plotter-strokes playback-pending" d={path} style={{ stroke: '#64748b', strokeWidth: 0.22 * pressure, opacity: playback?.active ? 0.22 : 0 }} />
            {completed > 0 && <path
              className="plotter-playback-stroke"
              d={path}
              pathLength="1000"
              style={{
                stroke: settings.inkColor,
                strokeWidth: 0.22 * pressure,
                strokeDasharray: 1000,
                strokeDashoffset: 1000 * (1 - completed),
                opacity: Math.min(1, 0.72 + pressure * 0.25),
              }}
            />}
          </g>
        )
      })}
      {playbackHead && (
        <g className="plotter-playback-head" transform={`translate(${playbackHead.x} ${playbackHead.y})`}>
          <circle r="1.35" />
          <circle r="0.45" />
        </g>
      )}
    </svg>
  )
}

export default memo(PlotterPaper, (previous, next) => (
  previous.layout === next.layout &&
  previous.pageIndex === next.pageIndex &&
  previous.metrics.width === next.metrics.width &&
  previous.metrics.height === next.metrics.height &&
  previous.settings.pageColor === next.settings.pageColor &&
  previous.settings.inkColor === next.settings.inkColor &&
  previous.settings.pageSize === next.settings.pageSize &&
  previous.playback?.progress === next.playback?.progress &&
  previous.playback?.active === next.playback?.active &&
  previous.playback?.strokeProgress === next.playback?.strokeProgress &&
  previous.playback?.strokes === next.playback?.strokes
))
