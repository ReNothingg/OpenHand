import { useMemo } from 'react'

function svgPath(strokes) {
  return strokes
    .map((stroke) => stroke.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(''))
    .join('')
}

export default function PlotterPaper({ layout, settings, metrics, pageIndex }) {
  const path = useMemo(() => svgPath(layout?.strokes || []), [layout?.strokes])
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
      <path className="plotter-strokes" d={path} style={{ stroke: settings.inkColor }} />
    </svg>
  )
}
