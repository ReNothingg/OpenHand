import { useEffect, useId, useState } from "react";
import PenTravelInfo from "./PenTravelInfo";

/** XY placement is independent of the pen's vertical reference. */
export default function PlotterManualStart({ workspace, workshop = false }: { workspace: any; workshop?: boolean }) {
  const groupId = useId();
  const [mode, setMode] = useState<"text" | "sheet">(() => workspace.originMode === "sheet" ? "sheet" : "text");
  useEffect(() => {
    if (workspace.originConfirmed && ["text", "sheet"].includes(workspace.originMode)) setMode(workspace.originMode);
  }, [workspace.originConfirmed, workspace.originMode]);
  if (workspace.running) return null;
  const textAvailable = !workshop && ["grbl", "marlin"].includes(workspace.config.profile);
  const selected = textAvailable ? mode : "sheet";
  const locked = workspace.busy || workspace.calibrationActive || workspace.plotter?.operationBusy || workspace.plotter?.status === "connecting";
  const canSet = workspace.placementReadiness.canStart;
  const textUnavailable = !workspace.job?.firstPoint || workspace.job.withinWorkArea === false || Boolean(workspace.config.customStartGcode?.trim());
  const selectMode = (next: "text" | "sheet") => {
    if (locked || next === mode) return;
    workspace.clearSheetOrigin();
    setMode(next);
  };
  const needsPenReference = ["stepper", "estepper"].includes(workspace.config.penMode);
  return <div className="plotter-manual-start">
    {textAvailable && <fieldset className="placement-mode" disabled={locked}>
      <legend>Что находится под пером?</legend>
      <label className={selected === "text" ? "is-selected" : ""}>
        <input type="radio" name={groupId} value="text" checked={selected === "text"} onChange={() => selectMode("text")} />
        <span><strong>Первый штрих текста</strong><small>Начать именно здесь, без дополнительного отступа</small></span>
      </label>
      <label className={selected === "sheet" ? "is-selected" : ""}>
        <input type="radio" name={groupId} value="sheet" checked={selected === "sheet"} onChange={() => selectMode("sheet")} />
        <span><strong>Левый верхний угол бумаги</strong><small>Разместить текст с полями документа</small></span>
      </label>
    </fieldset>}
    <p>Поставьте поднятое перо {selected === "text" ? "в точку первого штриха" : "над левым верхним углом бумаги"} и запомните положение.
      {" Кнопка не двигает механизм и не меняет высоту пера. Затем нажмите «Начать запись»."}</p>
    <button className="button primary compact" type="button"
      disabled={!canSet || locked || (selected === "text" && textUnavailable)}
      title={!canSet ? workspace.placementReadiness.blockers[0] : selected === "text" && workspace.config.customStartGcode?.trim()
        ? "Уберите пользовательские стартовые команды для привязки первого штриха."
        : "Запоминает выбранную привязку по X/Y. Запись запускается отдельно."}
      data-plotter-motion="" onClick={selected === "text" ? workspace.setTextStart : workspace.setManualStart}>
      {workspace.originConfirmed ? "Запомнить новую точку" : "Запомнить эту точку"}
    </button>
    {selected === "text" && workspace.textStartChanged && <p role="status">Начало макета изменилось. Запомните точку текста заново.</p>}
    {!workspace.penPositionsVerified && <button className="text-button" type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
      Один раз настроить подъём пера →
    </button>}
    {workspace.penPositionsVerified && needsPenReference && !workspace.penReferenceConfirmed && <button className="text-button" type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
      Указать фактическое положение пера →
    </button>}
    <PenTravelInfo config={workspace.config} />
  </div>;
}
