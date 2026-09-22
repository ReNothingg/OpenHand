import { createContext, useContext, useEffect, type ReactNode } from "react";
import { usePlotter } from "../hooks/usePlotter";
import PaperChangeDialog from "../components/plotter/PaperChangeDialog";

const SessionContext = createContext<ReturnType<typeof usePlotter> | null>(null);

/** One transport lifetime per application window, independent of the visible editor. */
export function PlotterSessionProvider({ children }: { children: ReactNode }) {
  const plotter = usePlotter();
  useEffect(() => {
    const stop = () => { void plotter.stop().catch(() => {}); };
    const key = (event: KeyboardEvent) => {
      if (event.repeat && ["Enter", " "].includes(event.key) && event.target instanceof Element &&
          event.target.closest("[data-plotter-motion]")) {
        event.preventDefault();
        return;
      }
      if (event.key !== "Escape" || event.repeat) return;
      event.preventDefault();
      stop();
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("openhand:native-stop", stop);
    return () => {
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("openhand:native-stop", stop);
    };
  }, [plotter.stop]);
  return <SessionContext.Provider value={plotter}>
    {children}
    <PaperChangeDialog workspace={{ plotter, stop: () => plotter.stop().catch(() => {}) }} />
  </SessionContext.Provider>;
}

export function usePlotterSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("PlotterSessionProvider is missing.");
  return value;
}
