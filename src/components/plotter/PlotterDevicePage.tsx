import { useEffect, useRef, useState } from "react";
import PlotterSettings from "./PlotterSettings";
import PlotterDiagnostics from "./PlotterDiagnostics";
import PenSetupPanel from "./PenSetupPanel";
import { MAX_REQUESTED_PEN_SPEED_MM_MIN } from "../../plotter/penLift";
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
  const locked = busy || workspace.penSetupBusy || workspace.plotter.operationBusy || running || calibrationActive;
  const canMove = connected && !locked && !alarm && !workspace.emergencyStopped;
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
    </header>
    {workspace.error && <p className="plotter-error" role="alert">{workspace.error}</p>}
    <div className="device-configuration settings-panel">
      <PlotterSettings workspace={workspace} penControls={<section className="device-pen-card" aria-labelledby="device-pen-title">
        <h2 id="device-pen-title">Перо</h2>
        {stepper ? <PenSetupPanel workspace={workspace} execute={execute} disabled={locked} />
          : config.penMode === "laser" ? <p className="device-hint">В режиме лазера проверка пера недоступна.</p> : <>
          <p className="device-hint">Сохраните положения сервопривода. Проверка перемещает перо в выбранное положение.</p>
          <NumberSetting label="Перо поднято" description="Перемещение над бумагой" unit={stepper ? "мм" : undefined} value={stepper ? config.zUp : config.penUp}
            min={stepper ? -50 : 0} max={stepper ? 50 : config.profile === "marlin" ? 180 : 32767}
            disabled={locked} onChange={(v: number) => set(stepper ? "zUp" : "penUp", v)}
            testLabel="Проверить ↑" testDisabled={!canMove || (stepper && (!workspace.penReferenceConfirmed || workspace.penSetupPosition === null))}
            onTest={(v: number) => execute(() => workspace.pen(true, v))} />
          <NumberSetting label="Перо опущено" description="Положение для письма" unit={stepper ? "мм" : undefined} value={stepper ? config.zDown : config.penDown}
            min={stepper ? -50 : 0} max={stepper ? 50 : config.profile === "marlin" ? 180 : 32767}
            disabled={locked} onChange={(v: number) => set(stepper ? "zDown" : "penDown", v)}
            testLabel="Проверить ↓" testDisabled={!canMove || (stepper && (!workspace.penReferenceConfirmed || workspace.penSetupPosition === null))}
            onTest={(v: number) => execute(() => workspace.pen(false, v))} />
        </>}
        <details className="device-advanced"><summary>Механизм и точная настройка</summary>
          <label className="device-number"><span>Механизм подъёма</span>
            <select value={config.penMode} disabled={locked || config.profile === "ebb"} onChange={e => set("penMode", e.target.value)}>
              <option value="stepper">Шаговый двигатель · Z</option><option value="servo">Сервопривод</option>
              {config.profile === "marlin" && <option value="estepper">Шаговый двигатель · E</option>}
              {config.profile === "grbl" && <option value="laser">Лазер / PWM</option>}
            </select>
          </label>
          {stepper && <>
            <label className="device-number"><span>Направление подъёма</span><select value={config.zUpDirection} disabled={locked} onChange={e => set("zUpDirection", Number(e.target.value))}><option value={-1}>К уменьшению Z/E</option><option value={1}>К увеличению Z/E</option></select></label>
            {config.profile === "grbl" && <p>Параметры удержания моторов в плате автоматически не меняются.</p>}
            <NumberSetting label="Скорость пера, мм/мин" description="Значения выше 3000 ускоряют подъём пера. Проверьте короткий ход: на высокой скорости возможны пропуски шагов." value={config.zSpeed} min={1} max={MAX_REQUESTED_PEN_SPEED_MM_MIN} disabled={locked} onChange={(v: number) => set("zSpeed", v)} />

          </>}
          {config.profile === "ebb" && <NumberSetting label="Шагов на миллиметр" value={config.mmToSteps} min={1} max={1000} disabled={locked} onChange={(v: number) => set("mmToSteps", v)} />}
          {config.penMode === "laser" && <NumberSetting label="Мощность S" value={config.laserPower} min={0} max={1000} disabled={locked} onChange={(v: number) => set("laserPower", v)} />}
        </details>
      </section>} />
      <PlotterDiagnostics workspace={workspace} />
    </div>
  </main>;
}
