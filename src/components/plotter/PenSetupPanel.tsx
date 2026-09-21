import { penLiftDistance, penPositionKey } from "../../plotter/penLift";

type Props = { workspace: any; execute: (action: () => Promise<unknown>) => Promise<void>; disabled: boolean };

export default function PenSetupPanel({ workspace, execute, disabled }: Props) {
  const { config, connected, penPositionsVerified: saved, penReferenceConfirmed: referenced, penSetupPosition: position } = workspace;
  const freshIdle = config.profile !== "grbl" || (workspace.plotter.machineStatus?.state === "Idle"
    && Date.now() - workspace.plotter.machineStatus.receivedAt < 3000);
  const unavailable = disabled || !connected || !freshIdle || workspace.emergencyStopped;
  const canTeach = !unavailable && referenced && position !== null;
  const adjust = <div className="pen-adjustment">
    <div className="pen-step-actions">
      <button disabled={!canTeach} onClick={() => void execute(() => workspace.jogPen(true, 0.1))}>↑ Чуть выше</button>
      <button disabled={!canTeach} onClick={() => void execute(() => workspace.jogPen(false, 0.1))}>↓ Чуть ниже</button>
    </div>
    <p className="pen-step-caption">Один шаг — 0,1 мм. Кнопка выполняет только одно движение.</p>
  </div>;

  return <div className="pen-setup">
    {!connected ? <p className="pen-next-step">Подключите плоттер, чтобы настроить перо.</p>
      : workspace.emergencyStopped ? <p className="pen-next-step">Управление остановлено. Разрешите его в панели СТОП после проверки механизма.</p>
      : !freshIdle ? <p className="pen-next-step">Ждём готовности контроллера к ручному движению.</p>
      : !referenced ? <div className="pen-next-step">
        <strong>{saved ? "Где перо сейчас?" : "Начните с текущего положения"}</strong>
        <p>{saved ? "Высоты сохранены. Укажите положение механизма, чтобы продолжить без повторной настройки." : "Начало отсчёта не двигает перо. Затем подведите его короткими шагами и запомните две высоты."}</p>
        {saved ? <div className="device-buttons">
          <button disabled={unavailable} onClick={() => void execute(() => workspace.setPenReference("up"))}>Сейчас поднято</button>
          <button disabled={unavailable} onClick={() => void execute(() => workspace.setPenReference("down"))}>Сейчас опущено</button>
        </div> : <button disabled={unavailable} onClick={() => void execute(workspace.beginPenSetup)}>Начать настройку</button>}
      </div> : saved ? <div className="pen-ready-controls">
        <div className="pen-step-actions">
          <button disabled={unavailable} onClick={() => void execute(() => workspace.moveSavedPen(true))}>↑ Поднять перо</button>
          <button disabled={unavailable} onClick={() => void execute(() => workspace.moveSavedPen(false))}>↓ Опустить перо</button>
        </div>
        <p className="pen-step-caption">Перемещение между сохранёнными высотами · ход {penLiftDistance(config)} мм</p>
      </div> : adjust}

    <div className="pen-height-cards">
      {[true, false].map(up => {
        const verified = config[up ? "penVerifiedUp" : "penVerifiedDown"] === penPositionKey(config, up);
        return <section className={`pen-height-card ${verified ? "is-saved" : ""}`} key={String(up)}>
          <h3>{up ? "Над бумагой" : "На бумаге"}</h3>
          <p>{up ? "Перо не касается листа при перемещении." : "Перо касается листа без чрезмерного нажима."}</p>
          <output>{verified ? `${up ? config.zUp : config.zDown} мм` : "Не сохранено"}</output>
          <button disabled={!canTeach} aria-label={up ? "Сохранить верхнее положение" : "Сохранить нижнее положение"}
            onClick={() => void execute(() => workspace.rememberPenPosition(up))}>
            {verified ? "Заменить текущим" : "Запомнить здесь"}
          </button>
        </section>;
      })}
    </div>
    {saved && referenced && <details className="pen-fine-adjustment"><summary>Подстроить положения</summary>
      {position === null ? <p className="device-hint">Сначала нажмите «Поднять перо» или «Опустить перо», затем подстройте высоту.</p> : adjust}
    </details>}
    {referenced && position !== null && <p className="pen-position-caption">Текущая отметка настройки: {position} мм</p>}
    {(referenced || config.penVerifiedUp || config.penVerifiedDown) && <div className="device-reset-pen">
      <button disabled={disabled} onClick={() => void execute(workspace.resetPenSetup)}>Настроить заново</button>
      <small>Удаляет сохранённые высоты. Механизм остаётся на месте.</small>
    </div>}
  </div>;
}
