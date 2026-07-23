import { useEffect, useMemo, useState } from 'react'

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  const rounded = Math.ceil(seconds)
  const minutes = Math.floor(rounded / 60)
  const remainder = rounded % 60
  return minutes ? `${minutes} мин ${remainder} сек` : `${remainder} сек`
}

export default function PreflightDialog({ workspace, onClose }) {
  const [selected, setSelected] = useState(() => workspace.activeIndex)
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose()
    window.addEventListener('keydown', close)
    return () => window.removeEventListener('keydown', close)
  }, [onClose])

  const totals = useMemo(() => {
    const job = workspace.jobs[selected]
    return {
      time: job?.estimatedSeconds || 0,
      path: job?.drawDistance || 0,
      travel: job?.travelDistance || 0,
      lifts: job?.penLifts || 0,
    }
  }, [selected, workspace.jobs])
  const allMissing = [...new Set(workspace.layouts[selected]?.missing || [])]
  const clipped = workspace.layouts[selected]?.clipped
    ? [{ index: selected, items: workspace.layouts[selected].clippedItems || [] }]
    : []

  return (
    <div className="preflight-backdrop" role="presentation" onPointerDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="preflight-title">
        <header>
          <div><span className="preflight-kicker">Проверка листов</span><h2 id="preflight-title">Всё ли готово к запуску?</h2></div>
          <button type="button" onClick={onClose} aria-label="Закрыть">×</button>
        </header>
        <div className="preflight-summary">
          <span><small>Листов</small><strong>1</strong></span>
          <span><small>Путь пера</small><strong>{(totals.path / 1000).toFixed(2)} м</strong></span>
          <span><small>Холостой путь</small><strong>{(totals.travel / 1000).toFixed(2)} м</strong></span>
          <span><small>Поднятий пера</small><strong>{totals.lifts.toLocaleString('ru-RU')}</strong></span>
          <span><small>Расчётное время</small><strong>{formatDuration(totals.time)}</strong></span>
        </div>
        <div className="preflight-body">
          <section className="preflight-sheets">
            <div className="preflight-section-title"><div><h3>Лист для отправки</h3><p>Плоттер запускает один физический лист за раз.</p></div></div>
            <div className="preflight-sheet-list">
              {workspace.layouts.map((layout, index) => {
                const job = workspace.jobs[index]
                const checked = selected === index
                return (
                  <label className={`preflight-sheet ${checked ? 'selected' : ''}`} key={index}>
                    <input type="radio" name="preflight-sheet" checked={checked} onChange={() => setSelected(index)} />
                    <span className="sheet-number">{index + 1}</span>
                    <span className="sheet-info"><strong>Лист {index + 1}</strong><small>{layout.strokes.length.toLocaleString('ru-RU')} штрихов · {(job?.drawDistance / 1000 || 0).toFixed(2)} м · {formatDuration(job?.estimatedSeconds)}</small></span>
                    <span className={`sheet-state ${layout.clipped ? 'warning' : layout.missing.length ? 'note' : 'ready'}`}>{layout.clipped ? 'Есть обрезка' : layout.missing.length ? `Нет глифов: ${layout.missing.length}` : 'Готов'}</span>
                  </label>
                )
              })}
            </div>
          </section>
          <aside className="preflight-checks">
            <h3>Результаты проверки</h3>
            <div className={`preflight-check ${clipped.length ? 'warning' : 'ok'}`}><span>{clipped.length ? '!' : '✓'}</span><div><strong>Обрезанные элементы</strong><p>{clipped.length ? clipped.map(({ index, items }) => `Лист ${index + 1}: ${items.length ? items.join(', ') : 'текст за рабочей областью'}`).join(' · ') : 'Элементы находятся в рабочей области.'}</p></div></div>
            <div className={`preflight-check ${allMissing.length ? 'warning' : 'ok'}`}><span>{allMissing.length ? '!' : '✓'}</span><div><strong>Отсутствующие глифы</strong><p>{allMissing.length ? `${allMissing.slice(0, 30).join(' ')}${allMissing.length > 30 ? ` и ещё ${allMissing.length - 30}` : ''}` : 'Все символы есть в выбранном GFont.'}</p></div></div>
            <div className="preflight-check ok"><span>✓</span><div><strong>Траектория</strong><p>{totals.lifts.toLocaleString('ru-RU')} поднятий пера, {(totals.travel / 1000).toFixed(2)} м перемещений без рисования.</p></div></div>
          </aside>
        </div>
        <footer>
          <p>{clipped.length ? 'Обрезанные части не попадут в команды плоттера.' : 'Проверка завершена без критических замечаний.'}</p>
          <div><button className="button" type="button" onClick={onClose}>Вернуться</button><button className="button primary" type="button" disabled={!workspace.connected || !workspace.armed || workspace.busy} onClick={() => { workspace.runSheets([selected]); onClose() }}>Запустить лист {selected + 1}</button></div>
        </footer>
      </section>
    </div>
  )
}
