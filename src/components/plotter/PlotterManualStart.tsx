import { useEffect, useId, useState } from "react";
import PenTravelInfo from "./PenTravelInfo";
import Icon from "../Icon";

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
    {workspace.notebookSpread && <fieldset className="placement-mode" disabled={locked}>
      <legend>Что пишем на развороте?</legend>
      {([["both", "Обе страницы", "Разворот целиком, если он помещается в рабочую область"],
        ["left", "Левую страницу", "Перо над левым верхним углом левой страницы"],
        ["right", "Правую страницу", "Перо над верхним углом правой страницы у корешка"]] as const).map(([value, title, hint]) =>
        <label key={value} className={workspace.spreadSide === value ? "is-selected" : ""}>
          <input type="radio" name={`${groupId}-spread`} value={value} checked={workspace.spreadSide === value}
            onChange={() => workspace.updateConfig("spreadPages", value)} />
          <span><strong>{title}</strong><small>{hint}</small></span>
        </label>)}
    </fieldset>}
    <p>Поставьте поднятое перо {selected === "text" ? "в точку первого штриха" : workspace.spreadSide === "right" ? "над верхним углом правой страницы у корешка" : "над левым верхним углом бумаги"} и запомните положение.
      {" Кнопка не двигает механизм и не меняет высоту пера. Затем нажмите «Начать запись»."}</p>
    <button className="oh-button" type="button"
      disabled={!canSet || locked || (selected === "text" && textUnavailable)}
      title={!canSet ? workspace.placementReadiness.blockers[0] : selected === "text" && workspace.config.customStartGcode?.trim()
        ? "Уберите пользовательские стартовые команды для привязки первого штриха."
        : "Запоминает выбранную привязку по X/Y. Запись запускается отдельно."}
      data-plotter-motion="" onClick={selected === "text" ? workspace.setTextStart : workspace.setManualStart}>
      <Icon name="crosshair" />
      <span>{workspace.originConfirmed ? "Запомнить новую точку" : "Запомнить эту точку"}</span>
    </button>
    {selected === "text" && workspace.textStartChanged && <p role="status">Начало макета изменилось. Запомните точку текста заново.</p>}
    {selected === "sheet" && workspace.originConfirmed && <PaperAlignmentSteps workspace={workspace} locked={locked} />}
    {!workspace.penPositionsVerified && <button className="oh-link-button" type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
      Один раз настроить подъём пера →
    </button>}
    {workspace.penPositionsVerified && needsPenReference && !workspace.penReferenceConfirmed && <button className="oh-link-button" type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
      Указать фактическое положение пера →
    </button>}
    <PenTravelInfo config={workspace.config} />
  </div>;
}

/** Two points on one rule of the squares turn and shift the page onto the paper. */
function PaperAlignmentSteps({ workspace, locked }: { workspace: any; locked: boolean }) {
  const alignment = workspace.paperAlignment;
  const degrees = alignment ? alignment.angle * 180 / Math.PI : 0;
  const format = (value: number, digits = 1) => value.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return <div className="paper-alignment">
    <strong>Выровнять по клетке</strong>
    <p>{workspace.alignmentStarted
      ? "По той же горизонтальной линии отведите перо вправо, хотя бы на 40 мм, и отметьте вторую точку."
      : "Ручными шагами подведите поднятое перо к пересечению линий клетки у левого края текста и отметьте первую точку."}</p>
    {alignment && <p role="status">Поворот {format(degrees, 2)}°, сдвиг клетки {format(alignment.shiftX)} / {format(alignment.shiftY)} мм.</p>}
    <div className="paper-alignment-actions">
      <button className="oh-button" type="button" disabled={locked || !workspace.alignmentAvailable}
        title={workspace.alignmentAvailable ? undefined : "После угла листа двигайте перо только ручными шагами."}
        onClick={workspace.markAlignmentPoint}>
        <Icon name="crosshair" />
        <span>{workspace.alignmentStarted ? "Отметить вторую точку" : "Отметить первую точку"}</span>
      </button>
      {(alignment || workspace.alignmentStarted) && <button className="oh-link-button" type="button" disabled={locked}
        onClick={workspace.resetAlignment}>Сбросить</button>}
    </div>
  </div>;
}
