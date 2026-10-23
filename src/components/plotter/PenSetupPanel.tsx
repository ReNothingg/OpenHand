import { useState } from "react";
import PenTravelInfo from "./PenTravelInfo";
import LiquidRange from "../controls/LiquidRange";
import Toggle from "../settings/controls/Toggle";
import { automaticPenUpPosition, MAX_PEN_CLEARANCE_MM, MAX_PEN_PRESS_MM, MIN_PEN_CLEARANCE_MM, normalizePenJogStep, PEN_JOG_STEPS_MM, penGeometry } from "../../plotter/penLift";
import { LADDER_COUNT, LADDER_DASH_MM, LADDER_GAP_MM, LADDER_STEPS_MM, ladderDepths, TEST_STROKE_WIDTH_MM } from "../../plotter/penSetup";
import { MAX_PEN_PRESSURE_MM, pressureVariationMm } from "../../plotter/penTouch";

type Props = { workspace: any; execute: (action: () => Promise<unknown>) => Promise<void>; disabled: boolean };

const mm = (value: number, digits = 2) => `${Number(value.toFixed(digits)).toLocaleString("ru-RU")} мм`;

function LadderPicker({ step, onPick, disabled }: { step: number; onPick: (index: number) => void; disabled: boolean }) {
  const depths = ladderDepths(step);
  const pitch = LADDER_DASH_MM + LADDER_GAP_MM;
  return <div className="pen-ladder">
    <strong>Какая черта первой оставила чернила?</strong>
    <p>Черты идут вправо от пера: первая — самая высокая, каждая следующая на {mm(step, 1)} ниже. Нажмите на первую черту, где на бумаге есть линия, даже бледная.</p>
    <svg viewBox={`-2 -6 ${LADDER_COUNT * pitch + 2} 14`} role="group" aria-label="Черты лесенки касания">
      <circle cx="-0.6" cy="2" r="0.7" className="pen-ladder-origin" />
      {depths.map((depth, index) => <g key={index} className="pen-ladder-dash" role="button" tabIndex={disabled ? -1 : 0}
        aria-label={`Черта ${index + 1}: на ${mm(depth, 1)} ниже начала`} aria-disabled={disabled}
        onClick={() => !disabled && onPick(index)}
        onKeyDown={event => { if (!disabled && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); onPick(index); } }}>
        <rect x={index * pitch - 0.8} y={-5} width={LADDER_DASH_MM + 1.6} height={12} rx="1" />
        <line x1={index * pitch} x2={index * pitch + LADDER_DASH_MM} y1="2" y2="2" />
        <text x={index * pitch + LADDER_DASH_MM / 2} y="-1.6" textAnchor="middle">{index + 1}</text>
      </g>)}
    </svg>
    <small>Ни одной линии — опустите перо на 1–2 мм и повторите. Линия уже у первой черты — поднимите перо на 1–2 мм и повторите.</small>
  </div>;
}

export default function PenSetupPanel({ workspace, execute, disabled }: Props) {
  const { config, connected, penPositionsVerified: saved, penReferenceConfirmed: referenced, penSetupPosition: position } = workspace;
  const [ladderStep, setLadderStep] = useState<number>(0.2);
  const freshIdle = config.profile !== "grbl" || (workspace.plotter.machineStatus?.state === "Idle"
    && Date.now() - workspace.plotter.machineStatus.receivedAt < 3000);
  const unavailable = disabled || !connected || !freshIdle || !workspace.controllerPenKey || workspace.emergencyStopped;
  const step = normalizePenJogStep(config.penJogStep);
  const stepLabel = step.toLocaleString("ru-RU");
  const geometry = penGeometry(config);
  const upper = automaticPenUpPosition(config);
  const height = geometry && referenced && position !== null ? (position - geometry.contact) * (config.zUpDirection === 1 ? 1 : -1) : null;
  const pendingLadder = workspace.penLadderStep;
  const ready = saved && referenced;

  const jogControls = <div className="pen-adjustment">
    <div className="pen-step-picker" role="group" aria-label="Шаг пера">
      <span>Шаг</span>
      <div>{PEN_JOG_STEPS_MM.map(value => <button key={value} type="button"
        disabled={disabled} aria-pressed={step === value}
        onClick={() => workspace.updateConfig("penJogStep", value)}>{value.toLocaleString("ru-RU")} мм</button>)}</div>
    </div>
    <div className="pen-step-actions">
      <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(() => workspace.jogPen(true, step))}>↑ Выше на {stepLabel} мм</button>
      <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(() => workspace.jogPen(false, step))}>↓ Ниже на {stepLabel} мм</button>
    </div>
  </div>;

  const blocker = !connected ? "Подключите плоттер, чтобы настроить перо. Без станка можно выбрать «Виртуальный плоттер» в блоке подключения."
    : workspace.emergencyStopped ? "Управление остановлено. Разрешите его в панели СТОП после проверки механизма."
    : !workspace.controllerPenKey ? "Прочитайте параметры платы в блоке подключения."
    : !freshIdle ? "Ждём готовности контроллера к ручному движению." : "";

  return <div className="pen-setup">
    {blocker ? <p className="pen-next-step">{blocker}</p>
      : pendingLadder !== null ? <LadderPicker step={pendingLadder} disabled={unavailable}
          onPick={index => void execute(() => workspace.applyPenLadder(index))} />
      : !ready ? <div className="pen-wizard">
        <ol className="pen-guide">
          <li><strong>Подведите перо к бумаге.</strong> Положите лист и кнопками опустите перо так, чтобы до бумаги осталось 1–2 мм. Кнопки двигают перо на выбранный шаг.</li>
          <li><strong>Отметьте касание.</strong> Видно, что стержень коснулся листа, — нажмите «Перо касается бумаги». Не видно — нажмите «Найти лесенкой»: плоттер проведёт {LADDER_COUNT} коротких черт вправо, каждую чуть глубже, а вы выберете первую с чернилами.</li>
        </ol>
        {jogControls}
        <div className="pen-contact-actions">
          <button className="pen-primary-action" disabled={unavailable} data-plotter-motion="" onClick={() => void execute(workspace.confirmPenContact)}>Перо касается бумаги</button>
          <div className="pen-ladder-start">
            <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(() => workspace.runPenLadder(ladderStep))}>Найти лесенкой</button>
            <label><span>шаг</span>
              <select value={ladderStep} disabled={disabled} onChange={event => setLadderStep(Number(event.target.value))}>
                {LADDER_STEPS_MM.map(value => <option key={value} value={value}>{value.toLocaleString("ru-RU")} мм</option>)}
              </select>
            </label>
          </div>
        </div>
        <p className="pen-step-caption">Лесенке нужно {Math.round(LADDER_COUNT * (LADDER_DASH_MM + LADDER_GAP_MM) / 10)} см бумаги справа от пера. Она опускает перо не глубже чем на {mm(ladderDepths(ladderStep).at(-1)!, 1)} от начального положения.</p>
        {saved && <div className="pen-quick-reference">
          <span>Перо осталось в верхнем положении после прошлой записи?</span>
          <button disabled={unavailable} onClick={() => void execute(() => workspace.setPenReference("up"))}>Да, перо поднято</button>
        </div>}
      </div>
      : <div className="pen-ready">
        <p className="pen-state" aria-live="polite">{height === null ? position === null ? "Высота отсчитана от бумаги. Поднимите или опустите перо кнопками ниже." : `Перо на высоте Z${position.toLocaleString("ru-RU")}`
          : height > 0.005 ? `Перо над бумагой на ${mm(height)}` : height > -0.005 ? "Перо касается бумаги" : `Перо прижато к бумаге на ${mm(-height)}`}</p>
        <div className="pen-step-actions">
          <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(() => workspace.moveSavedPen(true))}>↑ Поднять перо</button>
          <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(() => workspace.moveSavedPen(false))}>↓ Опустить для письма</button>
        </div>
        {geometry ? <div className="pen-geometry">
          <label className="pen-range">
            <span>Прижим при письме<output>{mm(geometry.pressure)}</output></span>
            <LiquidRange min={0} max={MAX_PEN_PRESS_MM} step={0.05} value={geometry.pressure} disabled={disabled || !connected}
              aria-label="Прижим при письме, мм" onChange={event => void workspace.adjustPenGeometry({ pressure: Number(event.target.value) })} />
            <small>Насколько ниже касания опускается перо. Бледно или с пропусками — больше; толсто или царапает — меньше.</small>
          </label>
          <label className="pen-range">
            <span>Подъём над бумагой<output>{mm(geometry.clearance, 1)}</output></span>
            <LiquidRange min={MIN_PEN_CLEARANCE_MM} max={Math.min(MAX_PEN_CLEARANCE_MM, 6)} step={0.1} value={geometry.clearance} disabled={disabled || !connected}
              aria-label="Подъём над бумагой, мм" onChange={event => void workspace.adjustPenGeometry({ clearance: Number(event.target.value) })} />
            <small>Высота пера при переездах. Меньше — быстрее письмо; на волнистой бумаге и у корешка тетради нужен запас.</small>
          </label>
          <div className="pen-test">
            <button disabled={unavailable} data-plotter-motion="" onClick={() => void execute(workspace.testPenStroke)}>Пробный штрих рядом с пером</button>
            <small>Петли, волна и точка правее и ниже пера, около {(TEST_STROKE_WIDTH_MM / 10).toLocaleString("ru-RU")} см. Пишутся так же, как документ.</small>
          </div>
        </div> : <p className="device-hint">Высоты сохранены по старой схеме, без точки касания. Чтобы настраивать прижим и подъём от бумаги, нажмите «Настроить заново» и отметьте касание.</p>}
        <details className="pen-fine-adjustment">
          <summary>Подвести перо вручную</summary>
          {jogControls}
        </details>
      </div>}

    {["stepper", "estepper"].includes(config.penMode) && config.profile !== "ebb" && <div className="pen-writing device-subsection">
      <h3>Как перо пишет</h3>
      <Toggle label="Касание на ходу" checked={config.penSoftTouch !== false} onChange={value => workspace.updateConfig("penSoftTouch", value)}>
        <p className="device-hint">Перо опускается до {mm(0.5, 1)} над бумагой и касается её уже в движении, а в конце штриха уходит с листа тоже в движении. Начало и конец линии получаются тонкими, как у руки, без точки-кляксы.</p>
      </Toggle>
      {config.penSoftTouch !== false && <label className="pen-range">
        <span>Живой нажим<output>{mm(Number(config.penPressureVariation) || 0)}</output></span>
        <LiquidRange min={0} max={MAX_PEN_PRESSURE_MM} step={0.02} value={Number(config.penPressureVariation) || 0} disabled={disabled || !geometry}
          aria-label="Живой нажим, мм" onChange={event => workspace.updateConfig("penPressureVariation", Number(event.target.value))} />
        <small>{!geometry ? "Доступен после отметки касания." : pressureVariationMm(config) < (Number(config.penPressureVariation) || 0) - 1e-6
          ? `Ограничен до ${mm(pressureVariationMm(config))}: перо не должно отрываться от бумаги. Увеличьте прижим, чтобы получить больше.`
          : "На штрихах вверх перо идёт чуть легче, на штрихах вниз — с полным прижимом, как при письме рукой. Нужен держатель с пружиной."}</small>
      </label>}
    </div>}

    <PenTravelInfo config={config} />
    {(referenced || config.penVerifiedUp || config.penVerifiedDown) && <div className="device-reset-pen">
      <button disabled={disabled} onClick={() => void execute(workspace.resetPenSetup)}>Настроить заново</button>
      <small>Удаляет сохранённые высоты. Механизм остаётся на месте.</small>
    </div>}
    {upper === config.zDown && saved && <p className="plotter-warning">Верхнее и нижнее положения совпадают. Настройте перо заново.</p>}
  </div>;
}
