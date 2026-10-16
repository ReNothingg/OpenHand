import type { ReactNode } from "react";
import AppearanceControl from "../AppearanceControl";
import EmergencyStopButton from "../plotter/EmergencyStopButton";

const WORKSPACES = [
  ["document", "Документ"],
  ["workshop", "Мастерская"],
  ["device", "Плоттер"],
] as const;

const STATUS_LABELS: Record<string, string> = {
  disconnected: "Плоттер не подключён",
  connecting: "Подключение…",
  connected: "Плоттер подключён",
  running: "Идёт запись",
  paused: "Запись на паузе",
  "waiting-paper": "Смените лист",
};

/** The one place that shows the workspace, the plotter state and the main action. */
export default function AppHeader({
  workspaceMode,
  locked,
  plotterStatus,
  onStop,
  setToolbarHost,
  actions,
}: {
  workspaceMode: string;
  locked: boolean;
  plotterStatus: string;
  onStop: () => unknown;
  setToolbarHost: (element: HTMLDivElement | null) => void;
  actions?: ReactNode;
}) {
  const statusLabel = STATUS_LABELS[plotterStatus] || STATUS_LABELS.disconnected;
  const statusClass = `oh-status is-${plotterStatus || "disconnected"}`;
  const openDevice = () =>
    window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }));
  return (
    <header className="oh-header">
      <strong className="oh-brand">OpenHand</strong>
      <nav className="oh-segmented" aria-label="Рабочее пространство">
        {WORKSPACES.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            aria-pressed={workspaceMode === mode}
            disabled={locked && workspaceMode !== mode}
            onClick={() =>
              window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: mode }))
            }
          >
            {label}
          </button>
        ))}
      </nav>
      <div ref={setToolbarHost} className="oh-header-host" />
      {workspaceMode === "device" || locked ? (
        <span className={statusClass} role="status">
          <i aria-hidden="true" />
          {statusLabel}
        </span>
      ) : (
        <button type="button" className={statusClass} onClick={openDevice} title="Открыть настройки плоттера">
          <i aria-hidden="true" />
          <span role="status">{statusLabel}</span>
        </button>
      )}
      <AppearanceControl />
      {actions}
      {plotterStatus && plotterStatus !== "disconnected" && <EmergencyStopButton onStop={onStop} />}
    </header>
  );
}
