import PlotterFooter from '../plotter/PlotterFooter.jsx'
import PlotterPaper from '../plotter/PlotterPaper.jsx'
import { useEffect, useMemo, useRef, useState } from 'react'
import BlockInspector from './BlockInspector.jsx'
import ManualPageContent from './ManualPageContent.jsx'

export default function PreviewPanel({
  pages,
  manualPages,
  manualEditing,
  setManualEditing,
  onUpdateManualBlock,
  onCommitManualBlock,
  onMeasureManualBlocks,
  onResetManualBlock,
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
  const [selectedBlock, setSelectedBlock] = useState(null)
  const activeSheetFrameRef = useRef(0)
  const isNotebookSpread = settings.pageSize === 'NotebookSpread'
  const plotterMode = plotterWorkspace.enabled
  const displayedPages = useMemo(() => (
    plotterMode
      ? Array.from({ length: Math.max(1, plotterWorkspace.layouts.length) }, () => [])
      : isNotebookSpread
        ? Array.from({ length: Math.ceil(pages.length / 2) }, (_, index) => pages.slice(index * 2, index * 2 + 2))
        : pages.map((page) => [page])
  ), [isNotebookSpread, pages, plotterMode, plotterWorkspace.layouts.length])
  useEffect(() => {
    if (!manualEditing) setSelectedBlock(null)
  }, [manualEditing])
  useEffect(() => {
    if (!selectedBlock) return
    for (let pageIndex = 0; pageIndex < manualPages.length; pageIndex += 1) {
      const block = manualPages[pageIndex]?.find((item) => item.id === selectedBlock.block.id)
      if (block && (pageIndex !== selectedBlock.pageIndex || block.layout !== selectedBlock.block.layout)) {
        setSelectedBlock({ pageIndex, block })
        return
      }
    }
  }, [manualPages, selectedBlock])
  useEffect(() => () => cancelAnimationFrame(activeSheetFrameRef.current), [])
  const sheetCount = displayedPages.length
  const plotterStatusLabel = {
    disconnected: 'Не подключён',
    connecting: 'Подключение…',
    connected: 'Подключён',
    running: 'Печать',
    paused: 'Пауза',
  }[plotterWorkspace.plotter.status]

  const detectActiveSheet = (event) => {
    const viewport = event.currentTarget
    if (activeSheetFrameRef.current) return
    activeSheetFrameRef.current = requestAnimationFrame(() => {
      activeSheetFrameRef.current = 0
      const centerX = viewport.scrollLeft + viewport.clientWidth / 2
      const centerY = viewport.scrollTop + viewport.clientHeight / 2
      const shells = Array.from(viewport.querySelectorAll('.page-shell'))
      if (!shells.length) return
      const closest = shells.reduce((best, shell, index) => {
        const distance = Math.hypot(
          shell.offsetLeft + shell.offsetWidth / 2 - centerX,
          shell.offsetTop + shell.offsetHeight / 2 - centerY,
        )
        return distance < best.distance ? { index, distance } : best
      }, { index: 0, distance: Infinity })
      if (closest.index !== activeSheetIndex) onActiveSheetChange(closest.index)
    })
  }

  return (
    <main className="preview-panel">
      <div className="preview-toolbar">
        <div className="preview-context">
          <span className="preview-sheet-status">
            Лист {Math.min(activeSheetIndex + 1, sheetCount)} из {sheetCount}
            <i aria-hidden="true" />
            {Math.round(settings.zoom)}%
          </span>
          {plotterMode && (
            <span className={`plotter-status ${plotterWorkspace.plotter.status}`}>
              <i />
              {plotterStatusLabel}
            </span>
          )}
        </div>
        <button className={`button compact placement-toggle ${manualEditing ? 'active' : ''}`} type="button" aria-pressed={manualEditing} onClick={() => setManualEditing((value) => !value)}>
          <span aria-hidden="true">⌁</span>{manualEditing ? 'Готово' : 'Расставить'}
        </button>
        <select className="layout-select" value={viewMode} onChange={(event) => setViewMode(event.target.value)} aria-label="Раскладка страниц"><option value="single">По 1 листу</option><option value="spread">По 2 листа</option></select>
        {!plotterMode && <button className="button ghost compact" type="button" onClick={reshuffle}>Перемешать</button>}
        <button className="button ghost compact" type="button" onClick={() => setPreviewOnly((value) => !value)}>{previewOnly ? 'Вернуть панели' : 'Только листы'}</button>
      </div>
      {manualEditing && <BlockInspector selected={selectedBlock} onUpdate={onUpdateManualBlock} onCommit={onCommitManualBlock} onReset={(originPage, blockId) => { onResetManualBlock(originPage, blockId); setSelectedBlock(null) }} />}
      <div className="pages-viewport" ref={previewRef} {...panHandlers} onScroll={detectActiveSheet}>
        <div className={`pages-canvas ${viewMode}`}>
          {displayedPages.map((spreadPages, index) => {
            const left = isNotebookSpread
              ? settings.marginLeft
              : (index % 2 === 1 ? settings.marginLeftEven : settings.marginLeft)
            const firstPageIndex = isNotebookSpread ? index * 2 : index
            return (
              <div className="page-shell" data-page-index={firstPageIndex} data-sheet-index={index} key={`${index}-${settings.seed}`} style={{ width: metrics.width * settings.zoom / 100, height: metrics.height * settings.zoom / 100 }}>
                <article
                  className={`paper ${manualEditing ? 'manual-editing' : ''} ${settings.ruledPaper || settings.pageSize.startsWith('Notebook') ? 'ruled' : ''} ${settings.pageSize.startsWith('Notebook') ? 'notebook-paper' : ''} ${settings.pageSize === 'NotebookSpread' ? 'notebook-spread' : ''} ${settings.pageSize === 'Notebook' ? (index % 2 === 0 ? 'notebook-right-page' : 'notebook-left-page') : ''}`}
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
                  {plotterMode && !manualEditing ? (
                    <>
                      <PlotterPaper
                        layout={plotterWorkspace.layouts[index]}
                        settings={settings}
                        metrics={metrics}
                        pageIndex={index}
                        playback={index === plotterWorkspace.activeIndex ? plotterWorkspace.playback : null}
                      />
                      {plotterWorkspace.busy && <div className="integrated-plotter-loading">Строю траекторию…</div>}
                    </>
                  ) : <>
                    <ManualPageContent
                      blocks={manualPages[firstPageIndex] || []}
                      pageIndex={firstPageIndex}
                      editing={manualEditing}
                      selected={selectedBlock}
                      zoom={settings.zoom}
                      onSelect={setSelectedBlock}
                      onUpdate={onUpdateManualBlock}
                      onCommit={onCommitManualBlock}
                      onMeasure={onMeasureManualBlocks}
                      contentStyle={{
                        top: settings.marginTop,
                        left,
                        width: metrics.contentWidth,
                        height: metrics.contentHeight,
                        transform: `rotate(${settings.textRotation}deg)`,
                      }}
                    />
                    {isNotebookSpread && (
                      <ManualPageContent
                        blocks={manualPages[firstPageIndex + 1] || []}
                        pageIndex={firstPageIndex + 1}
                        editing={manualEditing}
                        selected={selectedBlock}
                        zoom={settings.zoom}
                        onSelect={setSelectedBlock}
                        onUpdate={onUpdateManualBlock}
                        onCommit={onCommitManualBlock}
                        onMeasure={onMeasureManualBlocks}
                        contentStyle={{
                          top: settings.marginTop,
                          left: metrics.width / 2 + settings.marginLeftEven,
                          width: metrics.contentWidth,
                          height: metrics.contentHeight,
                          transform: `rotate(${settings.textRotation}deg)`,
                        }}
                      />
                    )}
                  </>}
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
