import { useRef, useState } from "react";
import { writingStartLimit, writingStartY } from "../../plotter/writingStart";

export default function WritingStartLine({
  settings,
  metrics,
  sheet,
  disabled,
  onChange,
}: any) {
  const [draft, setDraft] = useState<number | null>(null);
  const dragging = useRef(false);
  const value = writingStartY(settings, metrics.height, sheet);
  const limit = writingStartLimit(settings, metrics.height);
  const scale = Math.max(0.1, settings.zoom / 100);
  const clamp = (y: number) =>
    Math.max(0, Math.min(limit, Math.round(y * 100) / 100));
  const position = (event) => {
    const paper = event.currentTarget.closest(".page-shell").getBoundingClientRect();
    return clamp((event.clientY - paper.top) / (paper.height / metrics.height));
  };
  const y = draft ?? value;
  return (
    <div className="writing-start-guide" style={{ top: y * scale, left: settings.pageSize === "NotebookSpread" && sheet % 2 === 1 ? "100%" : undefined }}>
      <button
        type="button"
        role="slider"
        title="Перетащите линию. Стрелки — 1 мм, Shift — 10 мм. Двойной щелчок — вернуть отступ страницы."
        aria-label={`Начало письма на листе ${sheet + 1}`}
        aria-valuemin={0}
        aria-valuemax={Math.round((limit * 25.4) / 96)}
        aria-valuenow={Math.round((y * 25.4) / 96)}
        aria-valuetext={`${((y * 25.4) / 96).toFixed(1)} мм от верхнего края`}
        disabled={disabled}
        style={{
          top: -14,
          height: 28,
          minHeight: 0,
          fontSize: 18,
          background: "transparent",
        }}
        onPointerDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          event.stopPropagation();
          dragging.current = true;
          event.currentTarget.setPointerCapture(event.pointerId);
          setDraft(position(event));
        }}
        onPointerMove={(event) => {
          if (dragging.current && !disabled) setDraft(position(event));
        }}
        onPointerUp={(event) => {
          if (!dragging.current) return;
          dragging.current = false;
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          if (!disabled) onChange(sheet, position(event));
          setDraft(null);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setDraft(null);
        }}
        onLostPointerCapture={() => {
          if (dragging.current) {
            dragging.current = false;
            setDraft(null);
          }
        }}
        onDoubleClick={() => {
          if (!disabled) onChange(sheet, null);
        }}
        onKeyDown={(event) => {
          const delta = ((event.shiftKey ? 10 : 1) * 96) / 25.4;
          const next =
            event.key === "ArrowUp"
              ? value - delta
              : event.key === "ArrowDown"
                ? value + delta
                : event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? limit
                    : null;
          if (next !== null && !disabled) {
            event.preventDefault();
            event.stopPropagation();
            onChange(sheet, clamp(next));
          }
        }}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" style={{ transform: settings.pageSize === "NotebookSpread" && sheet % 2 === 1 ? "rotate(180deg)" : undefined }}><path d="M3 10h13M11 5l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </button>
    </div>
  );
}
