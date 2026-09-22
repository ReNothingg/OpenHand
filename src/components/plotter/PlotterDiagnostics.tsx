import { useState } from "react";
import { downloadFile } from "../../lib/files";

const build = typeof __OPENHAND_BUILD__ === "undefined"
  ? { revision: "development", modified: true, builtAt: "" } : __OPENHAND_BUILD__;

export default function PlotterDiagnostics({ workspace }: { workspace: any }) {
  const [error, setError] = useState("");
  const native = window.__openhandNativePlatform;
  const bridgeVersion = window.__openhandBridgeVersion ?? 0;
  const exportReport = async () => {
    setError("");
    try {
      const report = {
        schema: 1, exportedAt: new Date().toISOString(), build,
        platform: native ?? "browser", bridgeVersion: native ? bridgeVersion : null,
        connection: { status: workspace.plotter.status, transport: workspace.config.connectionType,
          profile: workspace.config.profile, baudRate: workspace.config.baudRate },
        readiness: workspace.deviceReadiness,
        emergencyStopped: workspace.emergencyStopped, stopNotice: workspace.stopNotice,
        recovery: workspace.plotter.recovery, recoveryWarning: workspace.plotter.recoveryWarning,
        reference: { origin: workspace.originConfirmed, pen: workspace.penReferenceConfirmed, setupPosition: workspace.penSetupPosition },
        deviceProfile: workspace.activeProfile,
        controllerCompatibility: { settingsComplete: workspace.plotter.controllerSettingsComplete, axes: workspace.controllerAxisKey, pen: workspace.controllerPenKey, workAreaConfirmed: workspace.workAreaConfirmed },
        controllerSettings: workspace.plotter.controllerSettings,
        controllerState: workspace.plotter.machineStatus,
        log: workspace.plotter.logs,
      };
      await downloadFile(`openhand-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(report, null, 2), "application/json");
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <details className="device-advanced device-diagnostics">
    <summary>Диагностика и версия приложения</summary>
    <div className="device-diagnostics-info">
      <span>Сборка <strong>{build.revision}{build.modified ? " · с изменениями" : ""}</strong></span>
      {build.builtAt && <time dateTime={build.builtAt}>{new Date(build.builtAt).toLocaleString("ru-RU")}</time>}
      <span>{native ? `${native} · USB-мост ${bridgeVersion || "старой версии"}` : "Браузерная версия"}</span>
    </div>
    {native && bridgeVersion < 7 && <p className="plotter-warning">Открыта старая нативная оболочка. Для управления устройством запустите новую сборку OpenHand.</p>}
    <button className="button" type="button" onClick={() => void exportReport()}>Сохранить диагностику</button>
    <p className="device-hint">Локальный файл с параметрами устройства и последними ответами контроллера. Текст документа не включается.</p>
    {error && <p role="alert" className="plotter-error">{error}</p>}
    <details><summary>Журнал команд</summary><pre className="device-command-log">{workspace.plotter.logs.length
      ? workspace.plotter.logs.map((entry: any) => `${entry.time} ${entry.direction === "out" ? "→" : entry.direction === "in" ? "←" : "·"} ${entry.message}`).join("\n")
      : "В этой сессии команды ещё не отправлялись."}</pre></details>
  </details>;
}
