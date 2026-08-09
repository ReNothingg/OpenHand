import { downloadFile } from "../../lib/files";
import LiquidRange from "../controls/LiquidRange";

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.ceil(seconds);
  if (rounded < 60) return `${rounded} сек.`;
  return `${Math.floor(rounded / 60)} мин. ${rounded % 60} сек.`;
}

export default function PlotterFooter({ workspace }: { workspace: any }) {
  if (!workspace.enabled) return null;
  const {
    activeLayout: layout,
    job,
    config,
    busy,
    error,
    armed,
    setArmed,
    connected,
    running,
    plotter,
    playback,
    recoveryAvailable,
    calibrationActive,
    preflight,
    originConfirmed,
  } = workspace;

  return (
    <section
      className="integrated-plotter-footer"
      aria-label="Управление и запуск плоттера"
    >
      {layout.missing.length > 0 && (
        <p className="plotter-note">
          Нет глифов: {layout.missing.slice(0, 24).join(" ")}
          {layout.missing.length > 24
            ? ` и ещё ${layout.missing.length - 24}`
            : ""}
        </p>
      )}
      {layout.clipped && (
        <p className="plotter-warning">
          Текст не поместился на выбранный лист. Остаток не будет отправлен.
        </p>
      )}
      {config.optimizePath && job.optimizationSaved > 0.01 && (
        <p className="plotter-note">
          Оптимизатор сократил холостой путь на{" "}
          {(job.optimizationSaved / 1000).toFixed(2)} м.
        </p>
      )}
      {error && <p className="plotter-error">{error}</p>}
      <div className="plotter-preflight" aria-label="Проверка перед запуском">
        <span className={preflight.calibrated ? "pass" : "warning"}>
          {preflight.calibrated ? "✓ Калибровка" : "• Нужна калибровка"}
        </span>
        <span className={!preflight.hasMissingGlyphs ? "pass" : "warning"}>
          {!preflight.hasMissingGlyphs ? "✓ Глифы" : "• Есть пропуски"}
        </span>
        <span className={!preflight.clipped ? "pass" : "warning"}>
          {!preflight.clipped ? "✓ Лист" : "• Есть обрезка"}
        </span>
        <span className={originConfirmed ? "pass" : "warning"}>
          {originConfirmed ? "✓ Ноль задан" : "• Проверьте ноль"}
        </span>
      </div>
      <div
        className="plotter-playback-controls"
        aria-label="Живое воспроизведение траектории"
      >
        <button
          className="button compact"
          type="button"
          disabled={!job.strokes?.length}
          onClick={playback.playing ? playback.pause : playback.play}
        >
          {playback.playing
            ? "Пауза анимации"
            : playback.progress < 0.999
              ? "Продолжить анимацию"
              : "▶ Воспроизвести"}
        </button>
        <button
          className="button ghost compact"
          type="button"
          disabled={!job.strokes?.length}
          onClick={playback.reset}
        >
          Сначала
        </button>
        <LiquidRange
          min="0"
          max="1"
          step="0.001"
          value={playback.progress}
          aria-label="Позиция воспроизведения"
          onChange={(event) => playback.seek(event.target.value)}
        />
        <select
          value={playback.speed}
          aria-label="Скорость воспроизведения"
          onChange={(event) => playback.setSpeed(Number(event.target.value))}
        >
          <option value="1">1×</option>
          <option value="4">4×</option>
          <option value="8">8×</option>
          <option value="16">16×</option>
        </select>
        <output>{Math.round(playback.progress * 100)}%</output>
      </div>
      <div className="plotter-footer-actions">
        <label className="plotter-arm">
          <input
            type="checkbox"
            checked={armed}
            disabled={calibrationActive}
            onChange={(event) => setArmed(event.target.checked)}
          />
          <span>Перо и нулевая точка проверены.</span>
        </label>
        <div className="plotter-runbar">
          <button
            className="button compact"
            type="button"
            disabled={!job.commands.length || busy}
            onClick={() => {
              const currentJob = workspace.createJob();
              downloadFile(
                `openhand-page-${workspace.activeIndex + 1}.${config.profile === "ebb" ? "ebb.txt" : "gcode"}`,
                `${currentJob.commands.join("\n")}\n`,
                "text/plain;charset=utf-8",
              );
            }}
          >
            Скачать команды
          </button>
          <button
            className="button ghost compact"
            type="button"
            disabled={
              calibrationActive ||
              !connected ||
              !job.commands.length ||
              busy ||
              config.profile === "ebb"
            }
            onClick={workspace.dryRun}
          >
            Проверить рамку
          </button>
          {!running && !recoveryAvailable && (
            <button
            className="button primary compact"
            type="button"
            disabled={
              calibrationActive ||
              !connected ||
              !armed ||
              !preflight.canStart ||
              !job.commands.length ||
              busy
            }
            title={preflight.canStart ? undefined : preflight.blockers[0]}
            onClick={workspace.run}
            >
              Запустить
            </button>
          )}
          {!running && recoveryAvailable && (
            <>
              <button
                className="button primary compact"
                type="button"
                disabled={
                  calibrationActive ||
                  !connected ||
                  !armed ||
                  !originConfirmed ||
                  busy
                }
                onClick={workspace.recover}
              >
                Продолжить с{" "}
                {Math.round(
                  (plotter.recovery.current / plotter.recovery.total) * 100,
                )}
                %
              </button>
              <button
                className="button ghost compact"
                type="button"
                onClick={workspace.discardRecovery}
              >
                Начать заново
              </button>
            </>
          )}
          {plotter.status === "running" && (
            <button
              className="button compact"
              type="button"
              onClick={workspace.pause}
            >
              Пауза
            </button>
          )}
          {plotter.status === "paused" && (
            <button
              className="button primary compact"
              type="button"
              onClick={workspace.resume}
            >
              Продолжить
            </button>
          )}
          {running && (
            <button
              className="button danger compact"
              type="button"
              onClick={workspace.stop}
            >
              Стоп
            </button>
          )}
        </div>
      </div>
      {recoveryAvailable && !originConfirmed && (
        <p className="plotter-warning">
          Для продолжения: выполните homing на контроллере, верните перо в
          исходную точку листа и нажмите «Установить ноль».
        </p>
      )}
      {plotter.progress.total > 0 && (
        <div className="plotter-progress">
          <i style={{ width: `${workspace.progressPercent}%` }} />
          <span>
            {plotter.progress.current} / {plotter.progress.total}
          </span>
        </div>
      )}
      <details className="plotter-console">
        <summary>Журнал порта · {plotter.logs.length}</summary>
        <div>
          {plotter.logs.map((entry, index) => (
            <code className={entry.direction} key={`${entry.time}-${index}`}>
              <time>{entry.time}</time>
              <b>
                {entry.direction === "in"
                  ? "←"
                  : entry.direction === "out"
                    ? "→"
                    : "·"}
              </b>
              {entry.message}
            </code>
          ))}
        </div>
        <button
          className="text-button"
          type="button"
          onClick={plotter.clearLogs}
        >
          Очистить
        </button>
      </details>
    </section>
  );
}
