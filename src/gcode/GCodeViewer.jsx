import { useEffect, useMemo, useRef, useState } from 'react'
import { parseGCode, segmentsToPath } from './parser.js'

function decodePayload(payload) {
  if (!payload) return null
  if (typeof payload.text === 'string') {
    return { name: payload.name || 'openhand.gcode', text: payload.text }
  }
  if (typeof payload.data !== 'string') return null
  const binary = atob(payload.data)
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return {
    name: payload.name || 'openhand.gcode',
    text: new TextDecoder().decode(bytes),
  }
}

function formatDistance(value) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} м`
  return `${value.toFixed(1)} мм`
}

function initialDocument(payload) {
  try {
    return decodePayload(payload)
  } catch {
    return null
  }
}

export default function GCodeViewer({ payload, onClose }) {
  const [document, setDocument] = useState(() => initialDocument(payload))
  const [error, setError] = useState('')
  const [showTravel, setShowTravel] = useState(true)
  const [zoom, setZoom] = useState(1)
  const inputRef = useRef(null)

  useEffect(() => {
    if (!payload) return
    try {
      const nextDocument = decodePayload(payload)
      if (nextDocument) {
        setDocument(nextDocument)
        setError('')
        setZoom(1)
      }
    } catch {
      setError('Не удалось прочитать содержимое файла.')
    }
  }, [payload])

  const result = useMemo(() => parseGCode(document?.text || ''), [document?.text])
  const padding = Math.max(4, Math.max(result.bounds.width, result.bounds.height) * 0.035)
  const viewBox = [
    result.bounds.minX - padding,
    result.bounds.minY - padding,
    result.bounds.width + padding * 2,
    result.bounds.height + padding * 2,
  ].join(' ')

  const openFile = async (file) => {
    if (!file) return
    const extension = file.name.split('.').pop()?.toLowerCase()
    if (!['gcode', 'nc', 'tap'].includes(extension)) {
      setError('Выберите файл G-code с расширением .gcode, .nc или .tap.')
      return
    }
    try {
      setDocument({ name: file.name, text: await file.text() })
      setError('')
      setZoom(1)
    } catch {
      setError('Не удалось прочитать выбранный файл.')
    }
  }

  const hasDrawing = result.drawing.length > 0

  return (
    <main
      className="gcode-viewer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        openFile(event.dataTransfer.files[0])
      }}
    >
      <header className="gcode-viewer-header">
        <div className="gcode-viewer-title">
          <button className="button compact" type="button" onClick={onClose}>← К документу</button>
          <div>
            <strong>Просмотр G-code</strong>
            <span>{document?.name || 'Файл не выбран'}</span>
          </div>
        </div>
        {document && (
          <div className="gcode-viewer-stats" aria-label="Сведения о файле">
            <span><strong>{result.commandCount.toLocaleString('ru-RU')}</strong> команд</span>
            <span><strong>{result.drawing.length.toLocaleString('ru-RU')}</strong> линий</span>
            <span><strong>{formatDistance(result.drawDistance)}</strong> пером</span>
          </div>
        )}
        <div className="gcode-viewer-actions">
          <input
            ref={inputRef}
            type="file"
            accept=".gcode,.nc,.tap,text/plain"
            hidden
            onChange={(event) => openFile(event.target.files[0])}
          />
          <button className="button primary compact" type="button" onClick={() => inputRef.current?.click()}>
            Открыть файл
          </button>
        </div>
      </header>

      {error && <p className="gcode-viewer-warning" role="alert">{error}</p>}
      {document && result.ignoredLines.length > 0 && (
        <p className="gcode-viewer-warning" role="status">
          Не распознаны строки: {result.ignoredLines.slice(0, 8).join(', ')}
          {result.ignoredLines.length > 8 ? ` и ещё ${result.ignoredLines.length - 8}` : ''}. Они не показаны на траектории.
        </p>
      )}

      {!document ? (
        <button className="gcode-dropzone" type="button" onClick={() => inputRef.current?.click()}>
          <strong>Перетащите сюда файл G-code</strong>
          <span>или нажмите, чтобы выбрать .gcode, .nc или .tap</span>
          <small>Файл обрабатывается только на этом устройстве.</small>
        </button>
      ) : (
        <div className="gcode-viewer-workspace">
          <section className="gcode-preview-panel" aria-label="Траектория G-code">
            <div className="gcode-preview-toolbar">
              <label>
                <input type="checkbox" checked={showTravel} onChange={(event) => setShowTravel(event.target.checked)} />
                <span>Холостые перемещения</span>
              </label>
              <label className="gcode-zoom">
                <span>Масштаб</span>
                <input type="range" min="0.6" max="3" step="0.1" value={zoom} aria-label="Масштаб просмотра G-code" onChange={(event) => setZoom(Number(event.target.value))} />
                <output>{Math.round(zoom * 100)}%</output>
              </label>
            </div>
            <div className="gcode-canvas">
              {hasDrawing ? (
                <svg
                  viewBox={viewBox}
                  style={{ transform: `scale(${zoom})` }}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label={`Траектория файла ${document.name}`}
                >
                  <rect
                    x={result.bounds.minX - padding}
                    y={result.bounds.minY - padding}
                    width={result.bounds.width + padding * 2}
                    height={result.bounds.height + padding * 2}
                    className="gcode-paper"
                  />
                  {showTravel && <path d={segmentsToPath(result.travel)} className="gcode-travel-path" />}
                  <path d={segmentsToPath(result.drawing)} className="gcode-draw-path" />
                </svg>
              ) : (
                <div className="gcode-empty-preview">
                  <strong>Нет линий для просмотра</strong>
                  <span>В файле не найдены перемещения G1 по осям X/Y.</span>
                </div>
              )}
            </div>
          </section>
          <aside className="gcode-source-panel" aria-label="Содержимое файла">
            <header><strong>Команды</strong><span>{result.lines.length.toLocaleString('ru-RU')} строк</span></header>
            <pre>{result.lines.map((line, index) => <code key={index}><i>{index + 1}</i><span>{line || ' '}</span></code>)}</pre>
          </aside>
        </div>
      )}
    </main>
  )
}
