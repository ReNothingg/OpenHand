/** One explicit, motion-free action for manually placing a new sheet. */
export default function PlotterManualStart({ workspace, workshop = false }: { workspace: any; workshop?: boolean }) {
  if (workspace.running) return null;
  const canSet = workspace.placementReadiness.canStart;
  const needsPenReference = ["stepper", "estepper"].includes(workspace.config.penMode);
  return <div className="plotter-manual-start">
    <p>Вручную поставьте поднятое перо над левым верхним углом листа.
      Нажмите кнопку, затем «{workshop ? "Начать рисунок" : "Начать запись"}».
      {workshop ? " Рисунок расположится как на рабочем поле." : " Поля и отступы берутся из документа."}</p>
    <button className="button ghost compact" type="button" disabled={!canSet}
      title={canSet ? "Запоминает начало листа и положение поднятого пера. Механизм не двигается." : workspace.placementReadiness.blockers[0]}
      onClick={workspace.setManualStart}>
      {workspace.originConfirmed && (!needsPenReference || workspace.penReferenceConfirmed) ? "Начало нового листа здесь" : "Начало листа здесь"}
    </button>
    {!workspace.penPositionsVerified && <button className="text-button" type="button"
      onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
      Один раз настроить подъём пера →
    </button>}
  </div>;
}
