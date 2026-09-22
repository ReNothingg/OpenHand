import PenTravelInfo from "./PenTravelInfo";

/** XY placement is independent of the pen's vertical reference. */
export default function PlotterManualStart({ workspace, workshop = false }: { workspace: any; workshop?: boolean }) {
  if (workspace.running) return null;
  const canSet = workspace.placementReadiness.canStart;
  const needsPenReference = ["stepper", "estepper"].includes(workspace.config.penMode);
  return <div className="plotter-manual-start">
    <p>Вручную поставьте поднятое перо над левым верхним углом листа.
      «Начало листа здесь» задаёт только положение на листе и не меняет высоту пера.
      {workshop ? " Рисунок расположится как на рабочем поле." : " Поля и отступы берутся из документа."}</p>
    <button className="button ghost compact" type="button" disabled={!canSet}
      title={canSet ? "Задаёт начало листа по X/Y. Перо остаётся на месте; его поднятое положение эта кнопка не задаёт." : workspace.placementReadiness.blockers[0]}
      onClick={workspace.setManualStart}>
      {workspace.originConfirmed ? "Начало нового листа здесь" : "Начало листа здесь"}
    </button>
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
