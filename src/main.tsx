import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/index.css";
import { readAppearance } from "./components/AppearanceControl";
import { useDisclosureMotion } from "./hooks/useDisclosureMotion";

const App = lazy(() => import("./App"));
const FontStudio = lazy(() => import("./font-builder/FontStudio"));
const GCodeViewer = lazy(() => import("./gcode/GCodeViewer"));

const path = window.location.pathname.replace(/\/+$/, "") || "/";
const searchParams = new URLSearchParams(window.location.search);
const requestedPlatform = searchParams.get("platform");
const nativePlatform =
  window.__openhandNativePlatform === "macos" ||
  window.__openhandNativePlatform === "windows"
    ? window.__openhandNativePlatform
    : requestedPlatform === "macos" || requestedPlatform === "windows"
      ? requestedPlatform
      : null;
const colorScheme = window.matchMedia("(prefers-color-scheme: dark)");
const view = searchParams.get("view");
let appearance = readAppearance();
let nativeSystemDark: boolean | undefined;

const syncPlatformTheme = () => {
  const root = document.documentElement;
  window.dispatchEvent(new CustomEvent("openhand:menu-appearance", { detail: appearance }));
  root.classList.toggle("platform-macos", nativePlatform === "macos");
  root.classList.toggle("platform-windows", nativePlatform === "windows");
  // Keep the existing selector name limited to the actual macOS shell.
  root.classList.toggle("macos-native", nativePlatform === "macos");
  const dark =
    appearance === "dark" || (appearance === "system" && (nativeSystemDark ?? colorScheme.matches));
  root.classList.toggle("theme-dark", dark);
  root.dataset.platform = nativePlatform || "web";
  root.dataset.theme = dark ? "dark" : "light";
  window.dispatchEvent(
    new CustomEvent("openhand:theme", {
      detail: { dark, system: appearance === "system" },
    }),
  );
};
window.addEventListener("openhand:appearance", (event: Event) => {
  const value = (event as CustomEvent).detail;
  appearance = value === "light" || value === "dark" ? value : "system";
  syncPlatformTheme();
});
window.addEventListener("openhand:system-theme", (event: Event) => {
  const dark = Boolean((event as CustomEvent).detail.dark);
  if (nativeSystemDark !== dark) { nativeSystemDark = dark; syncPlatformTheme(); }
});
window.addEventListener("openhand:menu-command", (event: Event) => {
  const command = (event as CustomEvent).detail;
  if (typeof command === "string" && command.startsWith("appearance:")) {
    const next = command.slice(11);
    if (!["system", "light", "dark"].includes(next)) return;
    try { localStorage.setItem("openhand.appearance", next); } catch { /* Optional preference. */ }
    window.dispatchEvent(new CustomEvent("openhand:appearance", { detail: next }));
  }
});
colorScheme.addEventListener("change", () => { nativeSystemDark = undefined; syncPlatformTheme(); });
window.addEventListener("focus", syncPlatformTheme);
syncPlatformTheme();

window.__openhandReceiveFile = (payload) => {
  window.__openhandPendingFile = payload;
  window.dispatchEvent(
    new CustomEvent("openhand:open-file", { detail: payload }),
  );
};

function Root() {
  useDisclosureMotion();
  const [activeView, setActiveView] = useState(
    path === "/font" || view === "font"
      ? "font"
      : path === "/gcode" || view === "gcode"
        ? "gcode"
        : "document",
  );
  const [filePayload, setFilePayload] = useState(
    () => window.__openhandPendingFile || null,
  );

  useEffect(() => {
    const openFile = (event) => {
      setFilePayload(event.detail);
      setActiveView("gcode");
    };
    window.addEventListener("openhand:open-file", openFile);
    return () => window.removeEventListener("openhand:open-file", openFile);
  }, []);

  useEffect(() => {
    const showWorkspace = (event: Event) => {
      const mode = (event as CustomEvent).detail;
      if (mode !== "workshop" && mode !== "document") return;
      if (activeView === "document") return;
      try {
        sessionStorage.setItem("openhand.workspace", mode);
      } catch {
        /* optional */
      }
      setActiveView("document");
    };
    window.addEventListener("openhand:workspace", showWorkspace);
    return () =>
      window.removeEventListener("openhand:workspace", showWorkspace);
  }, [activeView]);

  useEffect(() => {
    if (activeView !== "document") window.dispatchEvent(new CustomEvent("openhand:menu-state", { detail: {
      workspace: activeView, editor: false, settings: false, locked: false,
    } }));
  }, [activeView]);

  if (activeView === "font")
    return (
      <Suspense
        fallback={
          <div className="view-loading">Загрузка редактора шрифта…</div>
        }
      >
        <FontStudio />
      </Suspense>
    );
  if (activeView === "gcode") {
    return (
      <Suspense
        fallback={
          <div className="view-loading">Загрузка просмотра G-code…</div>
        }
      >
        <GCodeViewer
          payload={filePayload}
          onClose={() => {
            const url = new URL(window.location.href);
            if (url.pathname.replace(/\/+$/, "") === "/gcode")
              url.pathname = "/";
            url.searchParams.delete("view");
            window.history.replaceState(
              null,
              "",
              `${url.pathname}${url.search}${url.hash}`,
            );
            setActiveView("document");
            setFilePayload(null);
            window.__openhandPendingFile = null;
          }}
        />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<div className="view-loading">Загрузка OpenHand…</div>}>
      <App />
    </Suspense>
  );
}

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
