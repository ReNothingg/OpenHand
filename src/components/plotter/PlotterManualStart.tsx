import PenTravelInfo from "./PenTravelInfo";

/** XY placement is independent of the pen's vertical reference. */
export default function PlotterManualStart({ workspace, workshop = false }: { workspace: any; workshop?: boolean }) {
  if (workspace.running) return null;
  const canSet = workspace.placementReadiness.canStart;
  const needsPenReference = ["stepper", "estepper"].includes(workspace.config.penMode);
  return <div className="plotter-manual-start">
    <p>{workshop ? "Поставьте поднятое перо над левым верхним углом листа. Рисунок расположится как на рабочем поле."
      : "Поставьте поднятое перо туда, где должен начаться первый штрих, и нажмите «Начало текста здесь». Поля дополнительно не добавляются."}
      {" Кнопка только задаёт X/Y: механизм остаётся на месте, высота пера не меняется."}</p>
    {!workshop && workspace.config.profile !== "ebb" && <button className="button primary compact" type="button"
      disabled={!canSet || workspace.busy || !workspace.job.firstPoint || workspace.job.withinWorkArea === false || Boolean(workspace.config.customStartGcode?.trim())}
      title={!canSet ? workspace.placementReadiness.blockers[0] : workspace.config.customStartGcode?.trim()
        ? "Уберите пользовательские стартовые команды для привязки первого штриха."
        : "Привязывает первый штрих текущего листа к фактическому положению пера. Запись запускается отдельно."}
      data-plotter-motion="" onClick={workspace.setTextStart}>Начало текста здесь</button>}
    {!workshop && <p className="device-hint">Если выставляете перо по углу бумаги, выберите «Угол листа здесь» — тогда поля документа учитываются.</p>}
    <button className="button ghost compact" type="button" disabled={!canSet}
      title={canSet ? "Задаёт начало листа по X/Y. Перо остаётся на месте; его поднятое положение эта кнопка не задаёт." : workspace.placementReadiness.blockers[0]}
      data-plotter-motion="" onClick={workspace.setManualStart}>
      Угол листа здесь
    </button>
    {!workshop && workspace.textStartChanged && <p role="status">Начало макета изменилось. Задайте точку текста заново.</p>}
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
