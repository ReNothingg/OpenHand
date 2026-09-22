import { lazy, Suspense, useEffect, useState } from "react";
import { useDisclosureMotion } from "../hooks/useDisclosureMotion";
import { usePlotterSession } from "../plotter/PlotterSession";
import AuxiliaryPlotterControls from "../components/plotter/AuxiliaryPlotterControls";
import EmergencyStopNotice from "../components/plotter/EmergencyStopNotice";

const App = lazy(() => import("../App"));
const FontStudio = lazy(() => import("../font-builder/FontStudio"));
const GCodeViewer = lazy(() => import("../gcode/GCodeViewer"));
export type ApplicationView = "document" | "font" | "gcode";

export default function ApplicationViews({ initialView = "document" }: { initialView?: ApplicationView }) {
  useDisclosureMotion();
  const plotter = usePlotterSession();
  const [activeView, setActiveView] = useState<ApplicationView>(initialView);
  const [documentVisited, setDocumentVisited] = useState(initialView === "document");
  const [filePayload, setFilePayload] = useState(() => window.__openhandPendingFile || null);
  useEffect(() => { if (activeView === "document") setDocumentVisited(true); }, [activeView]);
  useEffect(() => {
    const openFile = (event: CustomEvent<OpenHandFilePayload>) => { setFilePayload(event.detail); setActiveView("gcode"); };
    const showWorkspace = (event: Event) => {
      const mode = (event as CustomEvent).detail;
      if (!["document", "workshop", "device"].includes(mode)) return;
      if (!documentVisited) {
        try { sessionStorage.setItem("openhand.workspace", mode); } catch { /* optional */ }
      }
      setActiveView("document");
    };
    const showView = (event: Event) => {
      const view = (event as CustomEvent).detail;
      if (["font", "document", "gcode"].includes(view)) setActiveView(view);
    };
    window.addEventListener("openhand:open-file", openFile);
    window.addEventListener("openhand:workspace", showWorkspace);
    window.addEventListener("openhand:view", showView);
    return () => {
      window.removeEventListener("openhand:open-file", openFile);
      window.removeEventListener("openhand:workspace", showWorkspace);
      window.removeEventListener("openhand:view", showView);
    };
  }, [documentVisited]);
  const locked = plotter.operationBusy || ["running", "paused", "waiting-paper"].includes(plotter.status);
  useEffect(() => {
    if (activeView === "document") return;
    const publish = () => window.dispatchEvent(new CustomEvent("openhand:menu-state", { detail: {
      workspace: activeView, editor: false, settings: false, locked,
    } }));
    publish();
    window.addEventListener("focus", publish);
    return () => window.removeEventListener("focus", publish);
  }, [activeView, locked]);
  const returnToDocument = () => {
    const url = new URL(window.location.href);
    if (["/gcode", "/font"].includes(url.pathname.replace(/\/+$/, ""))) url.pathname = "/";
    url.searchParams.delete("view");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    setActiveView("document");
    setFilePayload(null);
    window.__openhandPendingFile = null;
  };
  return <>
    {/* Keep document, pen reference and job preparation alive across auxiliary views. */}
    <div hidden={activeView !== "document"} className="document-view-shell">
      {(documentVisited || activeView === "document") && <Suspense fallback={<div className="view-loading"><AuxiliaryPlotterControls />Загрузка OpenHand…</div>}>
        <App active={activeView === "document"} />
      </Suspense>}
    </div>
    {activeView !== "document" && <div className="auxiliary-view-shell">
      <EmergencyStopNotice workspace={plotter} />
      <Suspense fallback={<div className="view-loading"><AuxiliaryPlotterControls />Загрузка редактора…</div>}>
        {activeView === "font" ? <FontStudio onClose={returnToDocument} deviceControls={<AuxiliaryPlotterControls />} />
          : <GCodeViewer payload={filePayload} onClose={returnToDocument} backLabel={locked ? "← К заданию" : "← Вернуться"}
              deviceControls={<AuxiliaryPlotterControls />} />}
      </Suspense>
    </div>}
  </>;
}
