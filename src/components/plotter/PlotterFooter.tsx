import { serializePlotterGcode } from "../../gcode/penModel";
import { downloadFile } from "../../lib/files";
import { useRef, useState } from "react";
import { enablePlotterNotifications } from "../../lib/notifications";
import PlotterManualStart from "./PlotterManualStart";

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

export default function PlotterFooter({ workspace }: { workspace: any }) {
  const gcodeInputRef = useRef<HTMLInputElement | null>(null);
  const [collapsed, setCollapsed] = useState(false);
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

  return (
    <section
      className={`integrated-plotter-footer ${collapsed ? "is-collapsed" : ""}`}
      aria-label="Управление и запуск плоттера"
    >
      <div className="plotter-footer-heading">
        <button type="button" aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span> Запись и предпросмотр
        </button>
        {collapsed && running && <button className="button danger" onClick={workspace.stop}>Стоп</button>}
      </div>
      <div className="plotter-footer-body" hidden={collapsed}>
      <details className="plotter-job-details">
        <summary>{preflight.canStart ? "Проверка задания · готово" : `Проверка задания · ${preflight.blockers[0] || "нужна подготовка"}`}</summary>

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

      {preflight.blockers.length > 1 && <ul className="plotter-readiness-details">
        {preflight.blockers.slice(1).map(message => <li key={message}>{message}</li>)}
      </ul>}
      {preflight.warnings.map(message => <p className="plotter-note" key={message}>{message}</p>)}
      </details>
      {!workspace.placementReadiness.canStart && workspace.penPositionsVerified && !running && <button className="text-button" type="button"
        onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
        Открыть настройки плоттера →
      </button>}

      <div className="plotter-control-grid">
        <section className="plotter-control-card recording-card" aria-label="Запись на бумаге">
          <h3>Запись на бумаге</h3>
          <PlotterManualStart workspace={workspace} />
      <div className="plotter-sheet-options">
        <label>
          Записать
          <select
            aria-label="Какие листы записать"
            value={config.profile === "ebb" ? "current" : scope}
            disabled={running || calibrationActive || recoveryAvailable || config.profile === "ebb"}
            onChange={(e) => setScope(e.target.value)}
          >
            <option value="current">Текущий лист</option>
            <option value="all">С первого листа · все листы</option>
            <option value="remaining">
              С текущего до конца ·{" "}
              {Math.max(0, workspace.layouts.length - workspace.activeIndex)}{" "}
              {(() => { const n = Math.max(0, workspace.layouts.length - workspace.activeIndex); return n % 10 === 1 && n % 100 !== 11 ? "лист" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "листа" : "листов"; })()}
            </option>
          </select>
        </label>

      </div>
      <div className="plotter-footer-actions">
        <div className="plotter-runbar">

          <button
            className="button ghost compact"
            type="button"
            disabled={
              !preflight.canStart ||
              !job.commands.length ||
              busy ||
              config.profile === "ebb"
            }
            data-plotter-motion="" onClick={workspace.dryRun}
          >
            Проверить рамку
          </button>
          {!running && !recoveryAvailable && (
            <button
              className="button primary compact"
              data-plotter-motion="" type="button"
              disabled={
                calibrationActive ||
                !connected ||
                !workspace.deviceReadiness.canStart ||
                !preflight.canStart ||
                !job.commands.length ||
                busy
              }
              title={preflight.canStart ? undefined : preflight.blockers[0]}
              onClick={() =>
                config.profile === "ebb"
                  ? workspace.run()
                  : workspace.runSheets(
                      scope === "current"
                        ? [workspace.activeIndex]
                        : Array.from(
                            {
                              length:
                                workspace.layouts.length -
                                (scope === "all" ? 0 : workspace.activeIndex),
                            },
                            (_, i) => (scope === "all" ? 0 : workspace.activeIndex) + i,
                          ),
                    )
              }
            >
              Начать запись
            </button>
          )}
          {!running && recoveryAvailable && (
            <>
              <button
                className="button primary compact"
                data-plotter-motion="" type="button"
                disabled={
                  calibrationActive ||
                  !connected ||
                  !workspace.deviceReadiness.canStart ||
                  !originConfirmed ||
                  busy
                }
                onClick={workspace.recover}
              >
                {workspace.recoveryLabel ? `Продолжить: ${workspace.recoveryLabel.toLowerCase()}` : "Продолжить запись"}
              </button>
            </>
          )}
          <button className="button ghost compact" type="button"
            disabled={running || calibrationActive}
            title="Сбросить счётчик команд, восстановление задания и анимацию. Плоттер не двигается, нули и калибровка сохраняются."
            onClick={async () => {
              if (await workspace.resetProgress()) setScope("all");
            }}>
            Сбросить прогресс
          </button>
          {plotter.status === "running" && (
            <button
              className="button compact"
              type="button"
              onClick={workspace.pause}
            >
              Приостановить
            </button>
          )}
          {plotter.status === "paused" && (
            <button
              className="button primary compact"
              data-plotter-motion="" type="button"
              onClick={workspace.resume}
            >
              Продолжить передачу
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
        </section>
        <section className="plotter-control-card" aria-label="Предпросмотр движения">
          <h3>Предпросмотр</h3>

      <div
        className="plotter-playback-controls"
        aria-label="Живое воспроизведение траектории"
      >
        <button
          className="button compact"
          type="button"
          disabled={!job.strokes?.length || running}
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
          disabled={!job.strokes?.length || running}
          onClick={playback.reset}
        >
          Анимация сначала
        </button>
        <select
          value={playback.speed}
          disabled={running}
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
        </section>
        <section className="plotter-control-card" aria-label="Файлы и уведомления">
          <h3>Файлы и уведомления</h3>
          <div className="plotter-file-buttons">
          <button
            className="button compact"
            type="button"
            disabled={!job.commands.length || busy}
            onClick={() => {
              const currentJob = workspace.createJob();
              downloadFile(
                `openhand-page-${workspace.activeIndex + 1}.${config.profile === "ebb" ? "ebb.txt" : "gcode"}`,
                serializePlotterGcode(currentJob.commands, config),
                "text/plain;charset=utf-8",
              );
            }}
          >
            Скачать G-code
          </button>        <button
          className="button compact"
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
        </button>          </div>
      {notificationNotice && (
        <p className="plotter-note" role="status">
          {notificationNotice}
        </p>
      )}
      <div className="plotter-imported-job" aria-label="Импорт готового G-code">
        <div className="plotter-imported-actions">
          <button
            className="button ghost compact"
            type="button"
            disabled={running}
            onClick={() => gcodeInputRef.current?.click()}
          >
            Открыть .gcode
          </button>
          {workspace.importedGcode && (
            <button
              className="text-button"
              type="button"
              disabled={running}
              onClick={workspace.clearImportedGcode}
            >
              Убрать
            </button>
          )}
        </div>
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
            <span title={workspace.importedGcode.name}>
              {workspace.importedGcode.name}
            </span>
            <small>
              {workspace.importedGcode.commands.length.toLocaleString("ru-RU")}{" "}
              команд · {workspace.importedGcode.parsed.bounds.width.toFixed(1)}{" "}
              × {workspace.importedGcode.parsed.bounds.height.toFixed(1)} мм
            </small>
            {!workspace.importedWithinWorkArea && (
              <p className="plotter-error">
                Траектория выходит за рабочую область профиля.
              </p>
            )}
            {workspace.importedGcode.warnings.map((warning) => (
              <p className="plotter-warning" key={warning}>
                {warning}
              </p>
            ))}
            {workspace.importedLaunchBlockers.map(message => <p className="plotter-warning" key={message}>{message}</p>)}
            <button
              className="button primary compact"
              data-plotter-motion="" type="button"
              disabled={
                calibrationActive ||
                !connected ||
                running ||
                !workspace.deviceReadiness.canStart ||
                !originConfirmed ||
                !workspace.importedWithinWorkArea ||
                workspace.importedLaunchBlockers.length > 0 ||
                config.profile === "ebb"
              }
              onClick={workspace.runImportedGcode}
            >
              Отправить файл
            </button>
          </div>
        )}
      </div>
        </section>
      </div>
      {error && <p className="plotter-error" role="alert">{error}</p>}
      {workspace.recoveryOtherSource === "workshop" && !running && <button className="text-button" type="button"
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
      {plotter.progress.total > 0 && (
        <div className="plotter-progress">
          <i style={{ width: `${workspace.progressPercent}%` }} />
          <span>
            Передано команд: {plotter.progress.current} / {plotter.progress.total}
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
      </div>
    </section>
  );
}
