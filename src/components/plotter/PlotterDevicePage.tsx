import { useEffect, useRef, useState } from "react";
import PlotterSettings from "./PlotterSettings";
import MachineMonitor from "./MachineMonitor";
import { penLiftDistance, penLiftTarget } from "../../plotter/penLift";
import "../../styles/plotter-device.css";

function NumberSetting({ label, value, onChange, min, max, disabled = false }: any) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = Number(draft.replace(",", "."));
    if (!draft.trim() || !Number.isFinite(next)) { setDraft(String(value)); return; }
    const bounded = Math.max(min, Math.min(max, next));
    setDraft(String(bounded));
    if (bounded !== value) onChange(bounded);
  };
  return <label className="device-number"><span>{label}</span>
    <input type="text" inputMode="decimal" aria-label={label} value={draft} disabled={disabled}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />
  </label>;
}

export default function PlotterDevicePage({ workspace }: { workspace: any }) {
  const { config, connected, running, calibrationActive, plotter } = workspace;
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [step, setStep] = useState(0.1);
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
      <div><h1>Плоттер</h1><p>Один профиль для документа и мастерской. Настройки сохраняются автоматически.</p></div>
      <button className="button danger" disabled={!connected} onClick={workspace.stop}>Стоп</button>
    </header>
    {workspace.error && <p className="plotter-error" role="alert">{workspace.error}</p>}
    <div className="device-grid">
      <section className="device-pen-card" aria-labelledby="device-pen-title">
        <h2 id="device-pen-title">Перо и прижим</h2>
        <label className="device-number"><span>Механизм подъёма</span>
          <select value={config.penMode} disabled={locked || config.profile === "ebb"} onChange={e => set("penMode", e.target.value)}>
            <option value="stepper">Шаговый двигатель · Z</option><option value="servo">Сервопривод</option>
            {config.profile === "marlin" && <option value="estepper">Шаговый двигатель · E</option>}
            {config.profile === "grbl" && <option value="laser">Лазер / PWM</option>}
          </select>
        </label>
        {!connected && <p className="device-hint">Подключите плоттер в соседнем блоке. Числа можно настроить заранее, кнопки движения станут доступны после подключения.</p>}
        {running && <p className="device-hint">Идёт задание. Для ручной проверки сначала остановите его.</p>}
        {alarm && <p className="device-hint">Контроллер в Alarm. Причина и снятие блокировки — в блоке состояния.</p>}
        {stepper ? <>
          <details className="device-step" open={!workspace.penReferenceConfirmed}><summary><h3>1. Настроить мягкое касание</h3></summary>
            <p>Подведите кончик к бумаге короткими шагами. Он должен касаться листа без сильного продавливания. Для этих шагов ноль пера не нужен.</p>
            <label className="device-number"><span>Шаг подстройки</span><select value={step} disabled={locked} onChange={e => setStep(Number(e.target.value))}>
              <option value={0.1}>0,1 мм</option><option value={0.25}>0,25 мм</option><option value={0.5}>0,5 мм</option>
            </select></label>
            <div className="device-buttons"><button disabled={!canMove} onClick={() => void execute(() => workspace.jogPen(true, step))}>↑ Выше на {step} мм</button>
              <button disabled={!canMove} onClick={() => void execute(() => workspace.jogPen(false, step))}>↓ Ниже на {step} мм</button></div>
            <button className="button primary device-wide" disabled={!canMove} onClick={() => void execute(workspace.setPenContact)}>Здесь нормальное касание — сохранить</button>
            <small>Сохраняет текущую высоту без движения. Ноль листа не меняется.</small>
          </details>
          <section className="device-step"><h3>2. Настройте подъём</h3>
            <NumberSetting label="Поднимать над касанием, мм" value={penLiftDistance(config)} min={0.1} max={10} disabled={locked}
              onChange={(v: number) => set("zUp", penLiftTarget(config, v))} />
            <NumberSetting label="Скорость подъёма и опускания, мм/мин" value={config.zSpeed} min={1} max={3000} disabled={locked} onChange={(v: number) => set("zSpeed", v)} />
            <p>Это расстояние между касанием и поднятым пером. Изменение числа само не двигает механизм.</p>
            <div className="device-buttons"><button disabled={!canMove || !workspace.penReferenceConfirmed} onClick={() => void execute(() => workspace.pen(true))}>↑ Проверить подъём</button>
              <button disabled={!canMove || !workspace.penReferenceConfirmed} onClick={() => void execute(() => workspace.pen(false))}>↓ Проверить касание</button></div>
            {!workspace.penReferenceConfirmed && <small>Сначала сохраните касание в шаге 1.</small>}
          </section>
          <section className="device-step"><h3>3. Подстройте прижим</h3>
            <p>Каждое нажатие меняет положение касания на {step} мм и сразу проверяет его. Величина подъёма сохраняется.</p>
            <div className="device-buttons"><button disabled={!canMove || !workspace.penReferenceConfirmed} onClick={() => void execute(() => workspace.adjustPenContact(false, step))}>Мягче · {step} мм</button>
              <button disabled={!canMove || !workspace.penReferenceConfirmed} onClick={() => void execute(() => workspace.adjustPenContact(true, step))}>Сильнее · {step} мм</button></div>
          </section>
          <details className="device-advanced"><summary>Координаты пера и направление подъёма</summary>
            <NumberSetting label="Координата поднятого пера Z/E" value={config.zUp} min={-50} max={50} disabled={locked} onChange={(v: number) => set("zUp", v)} />
            <NumberSetting label="Координата касания Z/E" value={config.zDown} min={-50} max={50} disabled={locked} onChange={(v: number) => set("zDown", v)} />
            <p>Подъём сейчас идёт в сторону {config.zUp <= config.zDown ? "уменьшения" : "увеличения"} Z/E.</p>
            <button disabled={!canMove || workspace.penReferenceConfirmed} onClick={() => void execute(workspace.setPenReference)}>Текущее положение — поднятое перо</button>
          </details>
        </> : config.penMode === "servo" ? <section className="device-step">
          <NumberSetting label="Положение сервопривода: поднято" value={config.penUp} min={0} max={config.profile === "marlin" ? 180 : 32767} disabled={locked} onChange={(v: number) => set("penUp", v)} />
          <NumberSetting label="Положение сервопривода: опущено" value={config.penDown} min={0} max={config.profile === "marlin" ? 180 : 32767} disabled={locked} onChange={(v: number) => set("penDown", v)} />
          <div className="device-buttons"><button disabled={!canMove} onClick={() => void execute(() => workspace.pen(true))}>↑ Проверить подъём</button><button disabled={!canMove} onClick={() => void execute(() => workspace.pen(false))}>↓ Проверить опускание</button></div>
          {config.profile === "ebb" && <NumberSetting label="Шагов на миллиметр" value={config.mmToSteps} min={1} max={1000} disabled={locked} onChange={(v: number) => set("mmToSteps", v)} />}
        </section> : <section className="device-step"><p>В режиме лазера проверка пера недоступна.</p><NumberSetting label="Мощность S" value={config.laserPower} min={0} max={1000} disabled={locked} onChange={(v: number) => set("laserPower", v)} /></section>}
      </section>
      <aside className="device-configuration settings-panel">
        <MachineMonitor workspace={workspace} compact />
        <PlotterSettings workspace={workspace} />
      </aside>
    </div>
  </main>;
}
