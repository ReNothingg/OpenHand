import { downloadFile } from '../../lib/files.js'

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)} сек.`
  return `${Math.floor(seconds / 60)} мин. ${Math.ceil(seconds % 60)} сек.`
}

export default function PlotterFooter({ workspace }) {
  if (!workspace.enabled) return null
  const { activeLayout: layout, job, config, busy, error, armed, setArmed, connected, running, plotter } = workspace

  return (
    <section className="integrated-plotter-footer" aria-label="Статистика и запуск плоттера">
      <div className="plotter-footer-head">
        <div><strong>Лист {workspace.activeIndex + 1}</strong><span>{workspace.fontStatus}</span></div>
        <span className={`plotter-status ${plotter.status}`}><i />{{ disconnected: 'Не подключён', connecting: 'Подключение…', connected: 'Подключён', running: 'Печать', paused: 'Пауза' }[plotter.status]}</span>
      </div>
      <div className="job-stats">
        <span><strong>{layout.strokes.length.toLocaleString('ru-RU')}</strong> штрихов</span>
        <span><strong>{job.commands.length.toLocaleString('ru-RU')}</strong> команд</span>
        <span><strong>{(job.distance / 1000).toFixed(2)}</strong> м пути</span>
        <span><strong>{formatDuration(job.estimatedSeconds)}</strong> расчётно</span>
      </div>
      {layout.missing.length > 0 && <p className="plotter-note">Нет глифов: {layout.missing.slice(0, 24).join(' ')}{layout.missing.length > 24 ? ` и ещё ${layout.missing.length - 24}` : ''}</p>}
      {layout.clipped && <p className="plotter-warning">Текст не поместился на выбранный лист. Остаток не будет отправлен.</p>}
      {error && <p className="plotter-error">{error}</p>}
      <div className="plotter-footer-actions">
        <label className="plotter-arm"><input type="checkbox" checked={armed} onChange={(event) => setArmed(event.target.checked)} /><span>Перо и нулевая точка проверены.</span></label>
        <div className="plotter-runbar">
          <button className="button compact" type="button" disabled={!job.commands.length || busy} onClick={() => downloadFile(`openhand-page-${workspace.activeIndex + 1}.${config.profile === 'ebb' ? 'ebb.txt' : 'gcode'}`, `${job.commands.join('\n')}\n`, 'text/plain;charset=utf-8')}>Скачать команды</button>
          {!running && <button className="button primary compact" type="button" disabled={!connected || !armed || !job.commands.length || busy} onClick={workspace.run}>Запустить</button>}
          {plotter.status === 'running' && <button className="button compact" type="button" onClick={workspace.pause}>Пауза</button>}
          {plotter.status === 'paused' && <button className="button primary compact" type="button" onClick={workspace.resume}>Продолжить</button>}
          {running && <button className="button danger compact" type="button" onClick={workspace.stop}>Стоп</button>}
        </div>
      </div>
      {plotter.progress.total > 0 && <div className="plotter-progress"><i style={{ width: `${workspace.progressPercent}%` }} /><span>{plotter.progress.current} / {plotter.progress.total}</span></div>}
      <details className="plotter-console">
        <summary>Журнал порта · {plotter.logs.length}</summary>
        <div>{plotter.logs.map((entry, index) => <code className={entry.direction} key={`${entry.time}-${index}`}><time>{entry.time}</time><b>{entry.direction === 'in' ? '←' : entry.direction === 'out' ? '→' : '·'}</b>{entry.message}</code>)}</div>
        <button className="text-button" type="button" onClick={plotter.clearLogs}>Очистить</button>
      </details>
    </section>
  )
}
