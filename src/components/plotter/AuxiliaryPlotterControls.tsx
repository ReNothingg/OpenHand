import { useState } from "react";
import { usePlotterSession } from "../../plotter/PlotterSession";
import EmergencyStopButton from "./EmergencyStopButton";

/** Visible in auxiliary editors while the document's session remains mounted. */
export default function AuxiliaryPlotterControls() {
  const plotter = usePlotterSession();
  const [error, setError] = useState("");
  const activeJob = ["running", "paused", "waiting-paper"].includes(plotter.status);
  const label = plotter.status === "running" ? "Идёт запись"
    : plotter.status === "paused" ? "Запись на паузе"
    : plotter.status === "waiting-paper" ? "Смена листа"
    : plotter.status === "connecting" ? "Подключение плоттера…"
    : plotter.operationBusy ? "Выполняется команда"
    : plotter.status === "connected" ? "Плоттер подключён" : "";
  const act = async (action: () => Promise<unknown>) => {
    setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <div className="auxiliary-plotter-controls" aria-label="Текущее задание плоттера">
    {label && <span role="status">{label}{activeJob && plotter.status !== "waiting-paper" ? ` · передано ${plotter.progress.current}/${plotter.progress.total}` : ""}</span>}
    {plotter.status === "running" && <button className="button compact" onClick={() => void act(plotter.pause)}>Пауза</button>}
    {plotter.status === "paused" && <button className="button compact" onClick={() => void act(plotter.resume)}>Продолжить запись</button>}
    <EmergencyStopButton onStop={() => plotter.stop().catch(() => {})} />
    {error && <span role="alert">{error}</span>}
  </div>;
}
