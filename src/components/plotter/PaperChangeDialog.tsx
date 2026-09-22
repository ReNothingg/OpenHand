import { useEffect, useRef, useState } from "react";
import EmergencyStopButton from "./EmergencyStopButton";
import { createPortal } from "react-dom";
import type { PaperChange } from "../../plotter/sheetQueue";

export default function PaperChangeDialog({ workspace }: { workspace: any }) {
  const change = workspace.plotter.paperChange as PaperChange | null;
  const [confirmedFor, setConfirmedFor] = useState<PaperChange | null>(null);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (!change) return;
    setConfirmedFor(null);
    setError("");
    dialog.current?.showModal();
    heading.current?.focus();
    const oldTitle = document.title;
    document.title = "Смените лист — OpenHand";
    return () => {
      dialog.current?.close();
      document.title = oldTitle;
    };
  }, [change]);
  if (!change) return null;
  const confirmed = confirmedFor === change;
  return createPortal(
    <dialog ref={dialog} className="paper-change-dialog" aria-labelledby="paper-change-title"
      onCancel={e => e.preventDefault()}>
      <header>
        <h2 ref={heading} tabIndex={-1} id="paper-change-title">Смените лист</h2>
        <EmergencyStopButton onStop={workspace.stop} />
      </header>
      <p>Завершено: {change.completedLabel.toLowerCase()}. Команда подъёма пера выполнена; очередь ждёт.</p>
      <p>Далее: <strong>{change.nextLabel.toLowerCase()}</strong>. Завершено листов: {change.completedCount} из {change.totalSheets}.</p>
      <p>Меняйте только бумагу. Если сдвинули механизм или высоту пера, остановите очередь и восстановите его положение перед продолжением.</p>
      <label>
        <input type="checkbox" checked={confirmed} disabled={workspace.plotter.paperContinuing}
          onChange={e => setConfirmedFor(e.target.checked ? change : null)} />
        Бумага закреплена по прежнему началу листа, механизм не сдвигался
      </label>
      {!workspace.plotter.canContinuePaper && !workspace.plotter.paperContinuing &&
        <p role="status">Ждём подтверждения готовности контроллера.</p>}
      {error && <p role="alert" className="plotter-error">{error}</p>}
      <div>
        <button className="button primary" data-plotter-motion=""
          disabled={!confirmed || !workspace.plotter.canContinuePaper || workspace.plotter.paperContinuing}
          onClick={async () => {
            if (!confirmed) return;
            try {
              if (!await workspace.plotter.continuePaper(change)) setError("Продолжение пока недоступно. Дождитесь готовности контроллера.");
            } catch (reason) { setError(reason instanceof Error ? reason.message : "Не удалось продолжить очередь."); }
          }}>
          {workspace.plotter.paperContinuing ? "Продолжаю…" : "Продолжить"}
        </button>
      </div>
    </dialog>, document.body,
  );
}
