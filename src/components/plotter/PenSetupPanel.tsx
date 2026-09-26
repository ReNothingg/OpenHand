import PenTravelInfo from "./PenTravelInfo";
import { automaticPenUpPosition, MAX_AUTOMATIC_PEN_LIFT_MM, penLiftDistance, penPositionKey, normalizePenJogStep, PEN_JOG_STEPS_MM } from "../../plotter/penLift";

type Props = { workspace: any; execute: (action: () => Promise<unknown>) => Promise<void>; disabled: boolean };

export default function PenSetupPanel({ workspace, execute, disabled }: Props) {
  const { config, connected, penPositionsVerified: saved, penReferenceConfirmed: referenced, penSetupPosition: position } = workspace;
  const freshIdle = config.profile !== "grbl" || (workspace.plotter.machineStatus?.state === "Idle"
    && Date.now() - workspace.plotter.machineStatus.receivedAt < 3000);
  const unavailable = disabled || !connected || !freshIdle || !workspace.controllerPenKey || workspace.emergencyStopped;
  const canTeach = !unavailable && referenced && position !== null;
  const step = normalizePenJogStep(config.penJogStep);
  const stepLabel = step.toLocaleString("ru-RU");
  const upper = automaticPenUpPosition(config);
  const availableLift = Math.min(MAX_AUTOMATIC_PEN_LIFT_MM, Math.abs(config.zUp - config.zDown));
  const lift = penLiftDistance(config);
  const adjust = <div className="pen-adjustment">
    <div className="pen-step-picker" role="group" aria-label="Шаг пера">
      <span>Шаг пера</span>
      <div>{PEN_JOG_STEPS_MM.map(value => <button key={value} type="button"
        disabled={disabled} aria-pressed={step === value}
        onClick={() => workspace.updateConfig("penJogStep", value)}>{value.toLocaleString("ru-RU")} мм</button>)}</div>
    </div>
    <div className="pen-step-actions">
      <button disabled={!canTeach} data-plotter-motion="" onClick={() => void execute(() => workspace.jogPen(true, step))}>↑ Выше на {stepLabel} мм</button>
      <button disabled={!canTeach} data-plotter-motion="" onClick={() => void execute(() => workspace.jogPen(false, step))}>↓ Ниже на {stepLabel} мм</button>
    </div>
    <p className="pen-step-caption">Одно нажатие — одно движение. Выбор шага не двигает перо.</p>
  </div>;

  return <div className="pen-setup">
    {!connected ? <p className="pen-next-step">Подключите плоттер, чтобы настроить перо.</p>
      : workspace.emergencyStopped ? <p className="pen-next-step">Управление остановлено. Разрешите его в панели СТОП после проверки механизма.</p>
      : !workspace.controllerPenKey ? <p className="pen-next-step">Прочитайте параметры платы в блоке подключения.</p>
      : !freshIdle ? <p className="pen-next-step">Ждём готовности контроллера к ручному движению.</p>
      : !referenced ? <div className="pen-next-step">
        <strong>{saved ? "Где перо сейчас?" : "Начните с текущего положения"}</strong>
        <p>{saved ? `Выберите точку только если перо физически уже находится точно в ней: верх записи Z${upper} или письмо Z${config.zDown}. Кнопки не двигают перо. После упора или ручного изменения высоты используйте «Настроить заново».` : "Начало отсчёта не двигает перо. Затем подведите его короткими шагами и запомните две высоты."}</p>
        {saved ? <div className="device-buttons">
          <button disabled={unavailable} onClick={() => void execute(() => workspace.setPenReference("up"))}>Сейчас верх записи · Z{upper}</button>
          <button disabled={unavailable} onClick={() => void execute(() => workspace.setPenReference("down"))}>Сейчас на бумаге · Z{config.zDown}</button>
        </div> : <button disabled={unavailable} onClick={() => void execute(workspace.beginPenSetup)}>Начать настройку</button>}
      </div> : saved ? <div className="pen-ready-controls">
        <div className="pen-step-actions">
          <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(() => workspace.moveSavedPen(true))}>↑ Поднять перо</button>
          <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(() => workspace.moveSavedPen(false))}>↓ Опустить перо</button>
        </div>
        <p className="pen-step-caption">Перемещение между сохранёнными высотами</p>
      </div> : adjust}

    <p className="pen-position-caption">Числа ниже — координаты Z относительно точки начала настройки. Они не задают длину одного движения.</p>
    <div className="pen-height-cards">
      {[true, false].map(up => {
        const stored = config[up ? "penVerifiedUp" : "penVerifiedDown"] === penPositionKey(config, up);
        const verified = stored && (config.profile !== "grbl" || workspace.controllerPenKey === config.penControllerKey);
        return <section className={`pen-height-card ${verified ? "is-saved" : ""}`} key={String(up)}>
          <h3>{up ? "Над бумагой" : "На бумаге"}</h3>
          <p>{up ? "Перо не касается листа при перемещении." : "Перо касается листа без чрезмерного нажима."}</p>
          <output>{stored ? `Z${Number(up ? config.zUp : config.zDown).toLocaleString("ru-RU")}` : "Не сохранено"}</output>
          {stored && !verified && <small>{!connected ? "Сохранено · сверим после подключения" : !workspace.controllerPenKey ? "Параметры платы ещё не прочитаны" : "Параметры платы изменились — проверьте высоту"}</small>}
          <button disabled={!canTeach} aria-label={up ? "Сохранить верхнее положение" : "Сохранить нижнее положение"}
            onClick={() => void execute(() => workspace.rememberPenPosition(up))}>
            {verified ? "Заменить текущим" : "Запомнить здесь"}
          </button>
        </section>;
      })}
    </div>
    {config.profile === "grbl" && <section className="pen-lift-setting" aria-labelledby="pen-lift-title">
      <div className="pen-lift-setting-heading"><h3 id="pen-lift-title">Ход пера при записи</h3><output>{lift.toLocaleString("ru-RU")} мм</output></div>
      <input type="range" aria-label="Ход пера при записи, мм" min="0.1" max={Math.max(0.1, availableLift)} step="0.1"
        value={Math.min(Number(config.maxAutomaticPenLift) || 3, Math.max(0.1, availableLift))}
        disabled={disabled || !saved || availableLift < 0.1}
        onChange={event => workspace.updateConfig("maxAutomaticPenLift", Number(event.target.value))} />
      <p>При письме перо идёт от Z{upper.toLocaleString("ru-RU")} до Z{Number(config.zDown).toLocaleString("ru-RU")}. Можно увеличить ход до {availableLift.toLocaleString("ru-RU")} мм — выше сохранённого Z{Number(config.zUp).toLocaleString("ru-RU")} программа не поднимет. Ползунок сам не двигает механизм.</p>
      {lift > 3 && <p className="pen-lift-caution">Перед длинной записью проверьте новые положения кнопками «Поднять перо» и «Опустить перо» выше. Если перо упирается, нажмите СТОП.</p>}
    </section>}
    <PenTravelInfo config={config} />
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
