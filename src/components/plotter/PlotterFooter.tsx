import { useRef, useState } from "react";
import { enablePlotterNotifications } from "../../lib/notifications";
import PlotterManualStart from "./PlotterManualStart";
import Icon from "../Icon";
import { withoutConnectBlocker } from "../../plotter/preflight";
import { plural } from "../../lib/plural";

export function formatDuration(seconds: number) {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.ceil(seconds);
  if (rounded >= 3600) return `${Math.floor(rounded / 3600)} ч. ${Math.floor((rounded % 3600) / 60)} мин.`;
  if (rounded < 60) return `${rounded} сек.`;
  return `${Math.floor(rounded / 60)} мин. ${rounded % 60} сек.`;
}

export const timingExplanation = "Расчёт по длине пути, заданным скоростям, ходу шагового пера и паузам. Без разгона, торможения, задержек связи и пользовательских G-code-команд. Реальное время не измерено.";
export function formatNominalDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  return `≈ ${formatDuration(Math.ceil(seconds / 5) * 5)}`;
}

/** The right-hand recording panel: sheets, origin, checks, launch and progress. */
export default function PlotterFooter({ workspace, onClose }: { workspace: any; onClose: () => void }) {
  const gcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [scope, setScope] = useState("remaining");
  const [notificationPending, setNotificationPending] = useState(false);
  const [notificationNotice, setNotificationNotice] = useState("");
  if (!workspace.enabled) return null;
  const {
    activeLayout: layout,
    job,
    config,
    busy,
    error,
    connected,
    running,
    plotter,
    playback,
    recoveryAvailable,
    calibrationActive,
    preflight,
    originConfirmed,
  } = workspace;
  const jobBlockers = withoutConnectBlocker(preflight.blockers);
  const remainingSheets = Math.max(0, workspace.layouts.length - workspace.activeIndex);
  const startSheets = () =>
    config.profile === "ebb"
      ? workspace.run()
      : workspace.runSheets(
          scope === "current"
            ? [workspace.activeIndex]
            : Array.from(
                { length: workspace.layouts.length - (scope === "all" ? 0 : workspace.activeIndex) },
                (_, i) => (scope === "all" ? 0 : workspace.activeIndex) + i,
              ),
        );

  return (
    <aside className="settings-panel panel oh-inspector recording-panel" aria-label="Запись на бумаге">
      <div className="oh-toolbar inspector-header">
        <h2 className="oh-panel-title">Запись на бумаге</h2>
        <span className="oh-spacer" />
        {!running && (
          <button type="button" className="oh-icon-button" onClick={onClose} aria-label="Закрыть панель записи" title="Закрыть">
            <Icon name="close" />
          </button>
        )}
      </div>
      <div className="oh-inspector-body">
        {plotter.progress.total > 0 && (
          <section className="oh-group recording-progress" aria-label="Ход записи">
            <div className="recording-progress-head">
              <strong>{Math.round(workspace.progressPercent)}%</strong>
              <span>лист {Math.min(workspace.activeIndex + 1, workspace.layouts.length)} из {workspace.layouts.length}</span>
            </div>
            <div className="oh-progress" role="progressbar" aria-label="Передано команд"
              aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(workspace.progressPercent)}>
              <i style={{ width: `${workspace.progressPercent}%` }} />
            </div>
            <span className="oh-note">Передано команд: {plotter.progress.current.toLocaleString("ru-RU")} из {plotter.progress.total.toLocaleString("ru-RU")}</span>
          </section>
        )}

        {!running && (
          <section className="oh-group oh-step">
            <h3 className="oh-group-title"><span className="oh-step-number" aria-hidden="true">1</span>Какие листы записать</h3>
            <select
              className="oh-select"
              aria-label="Какие листы записать"
              value={config.profile === "ebb" ? "current" : scope}
              disabled={calibrationActive || recoveryAvailable || config.profile === "ebb"}
              onChange={(e) => setScope(e.target.value)}
            >
              <option value="current">Текущий лист</option>
              <option value="all">С первого листа · все листы</option>
              <option value="remaining">
                С текущего до конца · {plural(remainingSheets, "лист", "листа", "листов")}
              </option>
            </select>
          </section>
        )}

        {!running && (
          <section className="oh-group oh-step">
            <h3 className="oh-group-title"><span className="oh-step-number" aria-hidden="true">2</span>Начальная точка</h3>
            <PlotterManualStart workspace={workspace} />
          </section>
        )}

        {!running && (
          <section className="oh-group oh-step">
            <h3 className="oh-group-title"><span className="oh-step-number" aria-hidden="true">3</span>Проверка<small>· по желанию</small></h3>
            <div className="oh-button-row">
              <button
                className="oh-button"
                type="button"
                disabled={!preflight.canStart || !job.commands.length || busy || config.profile === "ebb"}
                data-plotter-motion=""
                onClick={workspace.dryRun}
              >
                <Icon name="frame" />
                <span>Обвести рамку</span>
              </button>
            </div>
            <div className="oh-button-row" aria-label="Живое воспроизведение траектории">
              <button
                className="oh-button"
                type="button"
                disabled={!job.strokes?.length}
                onClick={playback.playing ? playback.pause : playback.play}
              >
                <Icon name="play" />
                <span>
                  {playback.playing
                    ? "Пауза анимации"
                    : playback.progress > 0.001 && playback.progress < 0.999
                      ? "Продолжить анимацию"
                      : "Предпросмотр движения"}
                </span>
              </button>
              <select
                className="oh-select is-compact"
                value={playback.speed}
                aria-label="Скорость воспроизведения"
                onChange={(event) => playback.setSpeed(Number(event.target.value))}
              >
                <option value="1">1×</option>
                <option value="4">4×</option>
                <option value="8">8×</option>
                <option value="16">16×</option>
              </select>
              {playback.progress > 0.001 && playback.progress < 0.999 && (
                <button className="oh-link-button" type="button" disabled={!job.strokes?.length} onClick={playback.reset}>
                  Сначала · {Math.round(playback.progress * 100)}%
                </button>
              )}
            </div>
          </section>
        )}

        <details className="oh-disclosure plotter-job-details">
          <summary>{preflight.canStart || !jobBlockers.length ? "Проверка задания · готово" : `Проверка задания · ${jobBlockers[0]}`}</summary>
          {layout.missing.length > 0 && (
            <p className="plotter-note">
              Нет глифов: {layout.missing.slice(0, 24).join(" ")}
              {layout.missing.length > 24 ? ` и ещё ${layout.missing.length - 24}` : ""}
            </p>
          )}
          {layout.clipped && (
            <p className="plotter-warning">Текст не поместился на выбранный лист. Остаток не будет отправлен.</p>
          )}
          {config.optimizePath && job.optimizationSaved > 0.01 && (
            <p className="plotter-note">
              Оптимизатор сократил холостой путь на {(job.optimizationSaved / 1000).toFixed(2)} м.
            </p>
          )}
          {jobBlockers.length > 1 && <ul className="plotter-readiness-details">
            {jobBlockers.slice(1).map(message => <li key={message}>{message}</li>)}
          </ul>}
          {preflight.warnings.map(message => <p className="plotter-note" key={message}>{message}</p>)}
        </details>
        {!workspace.placementReadiness.canStart && workspace.penPositionsVerified && !running && <button className="oh-link-button" type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
          Открыть настройки плоттера →
        </button>}

        {error && <p className="plotter-error" role="alert">{error}</p>}
        {workspace.recoveryOtherSource === "workshop" && !running && <button className="oh-link-button" type="button"
          onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "workshop" }))}>К прерванному рисунку в мастерской →</button>}
        {workspace.recoveryProblem && !running && !busy && <p className="plotter-warning">
          Сохранённое продолжение недоступно: {workspace.recoveryProblem} Можно сбросить прогресс и начать заново.
        </p>}
        {plotter.recoveryWarning && <p className="plotter-warning" role="status">{plotter.recoveryWarning}</p>}
        {recoveryAvailable && !originConfirmed && (
          <p className="plotter-warning">
            Для продолжения выберите прежний режим привязки — первый штрих текста или угол бумаги — и запомните прежнюю точку.
          </p>
        )}

        <details className="oh-disclosure plotter-imported-job" aria-label="Импорт готового G-code">
          <summary>Готовый G-code и уведомления</summary>
          <div className="oh-button-row">
            <button className="oh-button" type="button" disabled={running} onClick={() => gcodeInputRef.current?.click()}>
              <Icon name="folder-open" />
              <span>Открыть .gcode</span>
            </button>
            {workspace.importedGcode && (
              <button className="oh-link-button" type="button" disabled={running} onClick={workspace.clearImportedGcode}>
                Убрать
              </button>
            )}
            <button
              className="oh-button"
              type="button"
              disabled={running || notificationPending}
              onClick={async () => {
                setNotificationPending(true);
                setNotificationNotice("Ожидаю разрешение на уведомления…");
                let timeout: ReturnType<typeof setTimeout>;
                try {
                  setNotificationNotice(
                    (await Promise.race([enablePlotterNotifications(), new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("timeout")), 15000); })]))
                      ? "Системные уведомления включены."
                      : "Разрешение не получено. Проверьте уведомления для этого сайта в настройках браузера. Напоминание о бумаге останется в приложении.",
                  );
                } catch {
                  setNotificationNotice(
                    "Браузер не подтвердил разрешение. Проверьте его запрос или настройки сайта. Напоминание о бумаге останется в приложении.",
                  );
                } finally { clearTimeout(timeout!); setNotificationPending(false); }
              }}
            >
              {notificationPending ? "Ожидание…" : "Уведомления"}
            </button>
          </div>
          {notificationNotice && <p className="plotter-note" role="status">{notificationNotice}</p>}
          <input
            ref={gcodeInputRef}
            type="file"
            accept=".gcode,.nc,.tap,.cnc,.txt,text/plain"
            hidden
            onChange={(event) => {
              void workspace.importGcode(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          {workspace.importedGcode && (
            <div className="plotter-imported-summary">
              <small>
                Координаты файла не переставляются и не отражаются по профилю.
                Перед записью и после успешного окончания приложение поднимает перо.
                Файл использует начало листа, заданное в приложении.
              </small>
              <span title={workspace.importedGcode.name}>{workspace.importedGcode.name}</span>
              <small>
                {workspace.importedGcode.commands.length.toLocaleString("ru-RU")} команд ·{" "}
                {workspace.importedGcode.parsed.bounds.width.toFixed(1)} × {workspace.importedGcode.parsed.bounds.height.toFixed(1)} мм
              </small>
              {!workspace.importedWithinWorkArea && <p className="plotter-error">Траектория выходит за рабочую область профиля.</p>}
              {workspace.importedGcode.warnings.map((warning) => <p className="plotter-warning" key={warning}>{warning}</p>)}
              {workspace.importedLaunchBlockers.map(message => <p className="plotter-warning" key={message}>{message}</p>)}
              <button
                className="oh-button is-primary"
                data-plotter-motion="" type="button"
                disabled={
                  calibrationActive || !connected || running || !workspace.deviceReadiness.canStart ||
                  !originConfirmed || !workspace.importedWithinWorkArea ||
                  workspace.importedLaunchBlockers.length > 0 || config.profile === "ebb"
                }
                onClick={workspace.runImportedGcode}
              >
                Отправить файл
              </button>
            </div>
          )}
        </details>

        <details className="oh-disclosure plotter-console">
          <summary>Журнал порта · {plotter.logs.length}</summary>
          <div>
            {plotter.logs.map((entry, index) => (
              <code className={entry.direction} key={`${entry.time}-${index}`}>
                <time>{entry.time}</time>
                <b>{entry.direction === "in" ? "←" : entry.direction === "out" ? "→" : "·"}</b>
                {entry.message}
              </code>
            ))}
          </div>
          <button className="oh-link-button" type="button" onClick={plotter.clearLogs}>Очистить</button>
        </details>
      </div>
      <div className="oh-inspector-footer recording-footer">
        {!running && !recoveryAvailable && (
          <button
            className="oh-button is-primary"
            data-plotter-motion="" type="button"
            disabled={calibrationActive || !connected || !workspace.deviceReadiness.canStart || !preflight.canStart || !job.commands.length || busy}
            title={!connected ? "Сначала подключите плоттер" : preflight.canStart ? undefined : preflight.blockers[0]}
            onClick={startSheets}
          >
            <Icon name="pen" />
            <span>Начать запись</span>
          </button>
        )}
        {!running && recoveryAvailable && (
          <button
            className="oh-button is-primary"
            data-plotter-motion="" type="button"
            disabled={calibrationActive || !connected || !workspace.deviceReadiness.canStart || !originConfirmed || busy}
            onClick={workspace.recover}
          >
            {workspace.recoveryLabel ? `Продолжить: ${workspace.recoveryLabel.toLowerCase()}` : "Продолжить запись"}
          </button>
        )}
        {plotter.status === "running" && (
          <button className="oh-button" type="button" onClick={workspace.pause}>Приостановить</button>
        )}
        {plotter.status === "paused" && (
          <button className="oh-button is-primary" data-plotter-motion="" type="button" onClick={workspace.resume}>
            Продолжить передачу
          </button>
        )}
        {!running && (
          <button className="oh-button is-quiet" type="button"
            disabled={calibrationActive}
            title="Сбросить счётчик команд, восстановление задания и анимацию. Плоттер не двигается, нули и калибровка сохраняются."
            onClick={async () => {
              if (await workspace.resetProgress()) setScope("all");
            }}>
            Сбросить прогресс
          </button>
        )}
      </div>
    </aside>
  );
}
