export default function EmergencyStopNotice({ workspace }: { workspace: {
  stopNotice: string;
  emergencyStopped: boolean;
  releaseEmergencyStop: () => Promise<unknown>;
} }) {
  if (!workspace.stopNotice) return null;
  return <div className="emergency-stop-notice" role="alert">
    <span>{workspace.stopNotice}</span>
    {workspace.emergencyStopped && <button type="button" onClick={() => {
      void workspace.releaseEmergencyStop().catch(() => {});
    }}>Разрешить управление</button>}
  </div>;
}
