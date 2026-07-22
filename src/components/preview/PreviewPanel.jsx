import { PAGE_SIZES } from '../../app/config.js'

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
}) {
  return (
    <main className="preview-panel">
      <div className="preview-toolbar">
        <div className="preview-heading"><strong>Предпросмотр</strong><span>{PAGE_SIZES[settings.pageSize].label} · {Math.round(settings.zoom)}% · {pages.length} стр.</span></div>
        <select className="layout-select" value={viewMode} onChange={(event) => setViewMode(event.target.value)} aria-label="Раскладка страниц"><option value="single">По 1 листу</option><option value="spread">По 2 листа</option></select>
        <button className="button ghost compact" type="button" onClick={reshuffle}>Перемешать</button>
        <button className="button ghost compact" type="button" onClick={() => setPreviewOnly((value) => !value)}>{previewOnly ? 'Вернуть панели' : 'Только листы'}</button>
      </div>
      <div className="pages-viewport" ref={previewRef} {...panHandlers}>
        <div className={`pages-canvas ${viewMode}`}>
          {pages.map((page, index) => {
            const left = index % 2 === 1 ? settings.marginLeftEven : settings.marginLeft
            return (
              <div className="page-shell" data-page-index={index} key={`${index}-${settings.seed}`} style={{ width: metrics.width * settings.zoom / 100, height: metrics.height * settings.zoom / 100 }}>
                <article
                  className={`paper ${settings.ruledPaper || settings.pageSize === 'Notebook' ? 'ruled' : ''} ${settings.pageSize === 'Notebook' ? 'notebook-paper' : ''}`}
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
                  <div
                    className="page-content markdown-body"
                    style={{
                      top: settings.marginTop,
                      left,
                      width: metrics.contentWidth,
                      height: metrics.contentHeight,
                      transform: `rotate(${settings.textRotation}deg)`,
                    }}
                    dangerouslySetInnerHTML={{ __html: page }}
                  />
                  <span className="page-number">{index + 1}</span>
                </article>
              </div>
            )
          })}
        </div>
      </div>
      <div className="measure-host" ref={measureRef} aria-hidden="true" />
    </main>
  )
}
