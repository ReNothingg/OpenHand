import { useEffect, useRef, useState } from "react";
import PlotterSettings from "./PlotterSettings";
import { penLiftDistance } from "../../plotter/penLift";
import "../../styles/plotter-device.css";

function NumberSetting({ label, value, onChange, min, max, disabled = false, onTest, testLabel, testDisabled, description, unit }: any) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const parsed = Number(draft.replace(",", "."));
  const valid = Boolean(draft.trim()) && Number.isFinite(parsed) && parsed >= min && parsed <= max;
  const commit = () => {
    if (!valid) return null;
    setDraft(String(parsed));
    if (parsed !== value) onChange(parsed);
    return parsed;
  };
  const field = <label className="device-number"><span className="device-number-label">{label}{description && <small>{description}</small>}</span>
    <span className="device-number-value"><input type="text" inputMode="decimal" aria-label={label} aria-invalid={!valid}
      value={draft} disabled={disabled} onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />{unit && <span className="device-unit">{unit}</span>}</span>
  </label>;
  return onTest ? <div className="device-position-row">
    {field}
    <button disabled={disabled || testDisabled || !valid} aria-label={testLabel} onClick={() => {
      const target = commit();
      if (target !== null) void onTest(target);
    }}>{testLabel}</button>
    {!valid && <small className="device-input-error" role="alert">Введите число от {min} до {max}.</small>}
  </div> : <>{field}{!valid && <small role="alert">Введите число от {min} до {max}.</small>}</>;
}

export default function PlotterDevicePage({ workspace }: { workspace: any }) {
  const { config, connected, running, calibrationActive, plotter } = workspace;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const stepper = ["stepper", "estepper"].includes(config.penMode);
  const alarm = plotter.machineStatus?.state === "Alarm";
  const locked = busy || running || calibrationActive;
  const canMove = connected && !locked && !alarm;
  const execute = async (action: () => Promise<unknown>) => {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await action(); }
    finally { inFlight.current = false; setBusy(false); }
  };
  const set = (key: string, value: number | string) => workspace.updateConfig(key, value);
  return <main className="device-page" aria-label="Общие настройки плоттера">
    <header className="device-page-heading">
      <div><h1>Плоттер</h1><p>Общие настройки для документа и мастерской · сохраняются автоматически</p></div>
      <button className="button danger" disabled={!connected} onClick={workspace.stop}>Стоп</button>
    </header>
    {workspace.error && <p className="plotter-error" role="alert">{workspace.error}</p>}
    <div className="device-configuration settings-panel">
      <PlotterSettings workspace={workspace} penControls={<section className="device-pen-card" aria-labelledby="device-pen-title">
        <h2 id="device-pen-title">Перо</h2>
        <p className="device-hint">Задайте положения для перемещения и письма. Проверка переместит перо и оставит его в выбранной точке.</p>
        {!connected && <p className="device-availability">Проверка станет доступна после подключения.</p>}
        {running && <p className="device-hint">Проверка доступна после завершения или остановки задания.</p>}
        {alarm && <p className="device-hint">Контроллер в Alarm. Сначала устраните причину аварии и снимите блокировку в блоке состояния.</p>}
        {config.penMode !== "laser" ? <>
          <NumberSetting label="Перо поднято" description="Перемещение над бумагой" unit={stepper ? "мм" : undefined} value={stepper ? config.zUp : config.penUp}
            min={stepper ? -50 : 0} max={stepper ? 50 : config.profile === "marlin" ? 180 : 32767}
            disabled={locked} onChange={(v: number) => set(stepper ? "zUp" : "penUp", v)}
            testLabel="Проверить ↑" testDisabled={!canMove || (stepper && !workspace.penReferenceConfirmed)}
            onTest={(v: number) => execute(() => workspace.pen(true, v))} />
          <NumberSetting label="Перо опущено" description="Положение для письма" unit={stepper ? "мм" : undefined} value={stepper ? config.zDown : config.penDown}
            min={stepper ? -50 : 0} max={stepper ? 50 : config.profile === "marlin" ? 180 : 32767}
            disabled={locked} onChange={(v: number) => set(stepper ? "zDown" : "penDown", v)}
            testLabel="Проверить ↓" testDisabled={!canMove || (stepper && !workspace.penReferenceConfirmed)}
            onTest={(v: number) => execute(() => workspace.pen(false, v))} />
          {stepper && <p className="device-travel"><span>Ход пера</span><strong>{penLiftDistance(config)} мм</strong></p>}
          {stepper && !workspace.penReferenceConfirmed && connected && !alarm && !running && (
            <div className="device-reference">
              <p>Укажите, в каком из этих положений перо находится сейчас. Это не двигает перо и не меняет введённые значения.</p>
              <div className="device-buttons">
                <button disabled={locked} onClick={() => void execute(() => workspace.setPenReference("up"))}>Сейчас поднято</button>
                <button disabled={locked} onClick={() => void execute(() => workspace.setPenReference("down"))}>Сейчас опущено</button>
              </div>
            </div>
          )}
        </> : <p className="device-hint">В режиме лазера проверка положения пера недоступна.</p>}
        <details className="device-advanced"><summary>Механизм и точная настройка</summary>
          <label className="device-number"><span>Механизм подъёма</span>
            <select value={config.penMode} disabled={locked || config.profile === "ebb"} onChange={e => set("penMode", e.target.value)}>
              <option value="stepper">Шаговый двигатель · Z</option><option value="servo">Сервопривод</option>
              {config.profile === "marlin" && <option value="estepper">Шаговый двигатель · E</option>}
              {config.profile === "grbl" && <option value="laser">Лазер / PWM</option>}
            </select>
          </label>
          {stepper && <>
            {config.profile === "grbl" && <p>Удержание моторов: {plotter.controllerSettings?.[1] === 255 ? "включено" : "проверяется при подключении и настройке пера"}. Для шагового пера приложение устанавливает $1=255: моторы остаются под током в паузах, чтобы пружина не сбивала положение. Настройка сохраняется в плате.</p>}
            <NumberSetting label="Скорость пера, мм/мин" value={config.zSpeed} min={1} max={3000} disabled={locked} onChange={(v: number) => set("zSpeed", v)} />
            <p>Ручной поиск положения — короткими шагами, без изменения сохранённых чисел.</p>
            <div className="device-buttons"><button disabled={!canMove} onClick={() => void execute(() => workspace.jogPen(true, 0.1))}>↑ На 0,1 мм</button>
              <button disabled={!canMove} onClick={() => void execute(() => workspace.jogPen(false, 0.1))}>↓ На 0,1 мм</button></div>
          </>}
          {config.profile === "ebb" && <NumberSetting label="Шагов на миллиметр" value={config.mmToSteps} min={1} max={1000} disabled={locked} onChange={(v: number) => set("mmToSteps", v)} />}
          {config.penMode === "laser" && <NumberSetting label="Мощность S" value={config.laserPower} min={0} max={1000} disabled={locked} onChange={(v: number) => set("laserPower", v)} />}
        </details>
      </section>} />
        <details className="device-advanced"><summary>Журнал команд</summary>
          <pre className="device-command-log">{plotter.logs.map((entry: any) => `${entry.time} ${entry.direction === "out" ? "→" : entry.direction === "in" ? "←" : "·"} ${entry.message}`).join("\n")}</pre>
        </details>
    </div>
  </main>;
}
