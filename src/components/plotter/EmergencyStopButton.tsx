type Props = { onStop: () => unknown; label?: string };

/** The same always-enabled action in the workspace and device dialogs. */
export default function EmergencyStopButton({ onStop, label = "СТОП — аварийная остановка плоттера" }: Props) {
  return <button type="button" className="emergency-stop" aria-label={label}
    title="Остановить плоттер и отменить очередь · Esc" onClick={() => void onStop()}>
    <span aria-hidden="true">■</span> СТОП <kbd>Esc</kbd>
  </button>;
}
