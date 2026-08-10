import { lazy, StrictMode, Suspense, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "katex/dist/katex.min.css";
import "./styles/index.css";

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

const syncPlatformTheme = () => {
  const root = document.documentElement;
  root.classList.toggle("platform-macos", nativePlatform === "macos");
  root.classList.toggle("platform-windows", nativePlatform === "windows");
  // Keep the existing selector name limited to the actual macOS shell.
  root.classList.toggle("macos-native", nativePlatform === "macos");
  root.classList.toggle("theme-dark", colorScheme.matches);
  root.dataset.platform = nativePlatform || "web";
  root.dataset.theme = colorScheme.matches ? "dark" : "light";
};
colorScheme.addEventListener("change", syncPlatformTheme);
syncPlatformTheme();

window.__openhandReceiveFile = (payload) => {
  window.__openhandPendingFile = payload;
  window.dispatchEvent(
    new CustomEvent("openhand:open-file", { detail: payload }),
  );
};

function Root() {
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
