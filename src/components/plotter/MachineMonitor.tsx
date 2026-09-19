import { useEffect, useState } from "react";
import type { GRBL_REALTIME } from "../../plotter/grbl";

export default function MachineMonitor({ workspace }: { workspace: any }) {
  const { plotter, config, connected } = workspace;
  const status = plotter.machineStatus;
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState("");
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (config.profile !== "grbl") return null;
  const fresh = connected && status && now - status.receivedAt < 3000;
  const position = fresh ? status.work || status.machine : null;
  const send = async (action: keyof typeof GRBL_REALTIME) => {
    try {
      setError("");
      await plotter.realtime(action);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };
  return (
    <section className="machine-monitor" aria-label="Состояние GRBL">
      <div className="machine-heading">
        <strong>GRBL</strong>
        <span>
          {fresh
            ? status.state
            : connected
              ? "Ожидание телеметрии"
              : "Не подключён"}
        </span>
      </div>
      <small>
        {fresh && status.work
          ? "Рабочие координаты · мм"
          : "Машинные координаты · мм"}
      </small>
      <div className="machine-dro">
        {["X", "Y", "Z"].map((axis, i) => (
          <div key={axis}>
            <span>{axis}</span>
            <output>{position?.[i]?.toFixed(2) ?? "—"}</output>
          </div>
        ))}
      </div>
      <div className="machine-heading">
        <span>Подача</span>
        <output>
          {fresh && status.overrides ? `${status.overrides[0]}%` : "—"}
        </output>
      </div>
      <div className="workshop-buttons">
        {(
          [
            ["−10%", "feedMinus10"],
            ["100%", "feedReset"],
            ["+10%", "feedPlus10"],
          ] as const
        ).map(([label, action]) => (
          <button
            type="button"
            key={action}
            disabled={!fresh || !status.overrides}
            onClick={() => void send(action)}
          >
            {label}
          </button>
        ))}
      </div>
      <small>Холостой ход</small>
      <div className="workshop-buttons">
        {(
          [
            ["25%", "rapid25"],
            ["50%", "rapid50"],
            ["100%", "rapid100"],
          ] as const
        ).map(([label, action]) => (
          <button
            type="button"
            key={action}
            disabled={!fresh || !status.overrides}
            onClick={() => void send(action)}
          >
            {label}
          </button>
        ))}
      </div>
      {fresh && status.pins && <small>Активные входы: {status.pins}</small>}
      {error && (
        <p className="plotter-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
