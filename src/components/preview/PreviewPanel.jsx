import { PAGE_SIZES } from '../../app/config.js'
import PlotterFooter from '../plotter/PlotterFooter.jsx'
import PlotterPaper from '../plotter/PlotterPaper.jsx'

export default function PreviewPanel({
  pages,
  settings,
  metrics,
  viewMode,
  setViewMode,
  previewOnly,
  setPreviewOnly,
  reshuffle,
  previewRef,
  measureRef,
  panHandlers,
  plotterWorkspace,
  activeSheetIndex,
  onActiveSheetChange,
}) {
  const isNotebookSpread = settings.pageSize === 'NotebookSpread'
  const displayedPages = isNotebookSpread
    ? Array.from({ length: Math.ceil(pages.length / 2) }, (_, index) => pages.slice(index * 2, index * 2 + 2))
    : pages.map((page) => [page])
  const plotterMode = plotterWorkspace.enabled

  const detectActiveSheet = (event) => {
    const viewport = event.currentTarget
    const bounds = viewport.getBoundingClientRect()
    const centerX = bounds.left + bounds.width / 2
    const centerY = bounds.top + bounds.height / 2
    const shells = Array.from(viewport.querySelectorAll('.page-shell'))
    if (!shells.length) return
    const closest = shells.reduce((best, shell, index) => {
      const shellBounds = shell.getBoundingClientRect()
      const distance = Math.hypot(shellBounds.left + shellBounds.width / 2 - centerX, shellBounds.top + shellBounds.height / 2 - centerY)
      return distance < best.distance ? { index, distance } : best
    }, { index: 0, distance: Infinity })
    if (closest.index !== activeSheetIndex) onActiveSheetChange(closest.index)
  }

  return (
    <main className="preview-panel">
      <div className="preview-toolbar">
        <div className="preview-heading"><strong>{plotterMode ? 'Однолинейный предпросмотр' : 'Предпросмотр'}</strong><span>{PAGE_SIZES[settings.pageSize].label} · {metrics.orientation.toLowerCase()} · {Math.round(settings.zoom)}% · {isNotebookSpread ? `${displayedPages.length} разв.` : `${pages.length} стр.`}</span></div>
        <select className="layout-select" value={viewMode} onChange={(event) => setViewMode(event.target.value)} aria-label="Раскладка страниц"><option value="single">По 1 листу</option><option value="spread">По 2 листа</option></select>
        <button className="button ghost compact" type="button" onClick={reshuffle}>Перемешать</button>
        <button className="button ghost compact" type="button" onClick={() => setPreviewOnly((value) => !value)}>{previewOnly ? 'Вернуть панели' : 'Только листы'}</button>
      </div>
      <div className="pages-viewport" ref={previewRef} {...panHandlers} onScroll={detectActiveSheet}>
        <div className={`pages-canvas ${viewMode}`}>
          {displayedPages.map((spreadPages, index) => {
            const left = index % 2 === 1 ? settings.marginLeftEven : settings.marginLeft
            const firstPageIndex = isNotebookSpread ? index * 2 : index
            return (
              <div className="page-shell" data-page-index={firstPageIndex} data-sheet-index={index} key={`${index}-${settings.seed}`} style={{ width: metrics.width * settings.zoom / 100, height: metrics.height * settings.zoom / 100 }}>
                <article
                  className={`paper ${settings.ruledPaper || settings.pageSize.startsWith('Notebook') ? 'ruled' : ''} ${settings.pageSize.startsWith('Notebook') ? 'notebook-paper' : ''} ${settings.pageSize === 'NotebookSpread' ? 'notebook-spread' : ''} ${settings.pageSize === 'Notebook' ? (index % 2 === 0 ? 'notebook-right-page' : 'notebook-left-page') : ''}`}
                  style={{
                    width: metrics.width,
                    height: metrics.height,
                    transform: `scale(${settings.zoom / 100})`,
                    backgroundColor: settings.pageColor,
                    color: settings.inkColor,
                    fontFamily: `'${settings.fontFamily}'`,
                    fontSize: settings.fontSize,
                    lineHeight: settings.lineHeight,
                    '--rule-size': `${settings.fontSize * settings.lineHeight}px`,
                  }}
                >
                  {plotterMode ? (
                    <>
                      <PlotterPaper layout={plotterWorkspace.layouts[index]} settings={settings} metrics={metrics} pageIndex={index} />
                      {plotterWorkspace.busy && <div className="integrated-plotter-loading">Строю траекторию…</div>}
                    </>
                  ) : <>
                    <div
                      className="page-content markdown-body"
                      style={{
                        top: settings.marginTop,
                        left,
                        width: metrics.contentWidth,
                        height: metrics.contentHeight,
                        transform: `rotate(${settings.textRotation}deg)`,
                      }}
                      dangerouslySetInnerHTML={{ __html: spreadPages[0] || '' }}
                    />
                    {isNotebookSpread && (
                      <div
                        className="page-content markdown-body spread-right-content"
                        style={{
                          top: settings.marginTop,
                          left: metrics.width / 2 + metrics.spreadInnerMargin,
                          width: metrics.contentWidth,
                          height: metrics.contentHeight,
                          transform: `rotate(${settings.textRotation}deg)`,
                        }}
                        dangerouslySetInnerHTML={{ __html: spreadPages[1] || '' }}
                      />
                    )}
                  </>}
                  {isNotebookSpread ? <>
                    <span className="page-number spread-page-number left">{firstPageIndex + 1}</span>
                    <span className="page-number spread-page-number right">{firstPageIndex + 2}</span>
                  </> : <span className="page-number">{index + 1}</span>}
                </article>
              </div>
            )
          })}
        </div>
      </div>
      <PlotterFooter workspace={plotterWorkspace} />
      <div className="measure-host" ref={measureRef} aria-hidden="true" />
    </main>
  )
}
