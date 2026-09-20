import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export default function PaperChangeDialog({ workspace }: { workspace: any }) {
  const change = workspace.plotter.paperChange;
  const [confirmed, setConfirmed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!change) return;
    setConfirmed(false);
    dialog.current?.showModal();
    const oldTitle = document.title;
    document.title = "Переверните страницу — OpenHand";
    return () => {
      dialog.current?.close();
      document.title = oldTitle;
    };
  }, [change]);
  if (!change) return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="paper-change-dialog"
      aria-labelledby="paper-change-title"
      onCancel={(e) => e.preventDefault()}
    >
      <h2 id="paper-change-title">Переверните страницу</h2>
      <p>
        Завершено: {change.completedLabel.toLowerCase()}. Перо поднято, плоттер
        ждёт.
      </p>
      <p>
        Далее: <strong>{change.nextLabel.toLowerCase()}</strong>. Завершено
        листов: {change.completedCount} из {change.totalSheets}.
      </p>
      <label>
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        Бумага закреплена и выровнена по прежней нулевой точке
      </label>
      <div>
        <button className="button" onClick={workspace.stop}>
          Остановить очередь
        </button>
        <button
          className="button primary"
          disabled={!confirmed}
          onClick={() => {
            if (confirmed) workspace.plotter.continuePaper();
          }}
        >
          Продолжить
        </button>
      </div>
    </dialog>,
    document.body,
  );
}
