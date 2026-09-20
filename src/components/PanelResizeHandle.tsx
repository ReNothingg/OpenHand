import { useRef } from "react";

export default function PanelResizeHandle({ width, onChange, side = "right", className = "" }: {
  width: number; onChange: (width: number) => void; side?: "left" | "right"; className?: string;
}) {
  const drag = useRef<{ x: number; width: number } | null>(null);
  const clamp = (value: number) => Math.round(Math.max(260, Math.min(Math.min(600, window.innerWidth * 0.65), value)));
  return <div className={`panel-resize-handle ${className}`} role="separator" tabIndex={0}
    aria-label="Ширина панели настроек" aria-orientation="vertical" aria-valuemin={260} aria-valuemax={600} aria-valuenow={width}
    title="Потяните для изменения ширины. Двойной щелчок — сброс."
    onPointerDown={event => { event.preventDefault(); drag.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (drag.current) onChange(clamp(drag.current.width + (event.clientX - drag.current.x) * (side === "right" ? -1 : 1))); }}
    onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
    onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }}
    onDoubleClick={() => onChange(320)}
    onKeyDown={event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); onChange(clamp(width + (event.key === "ArrowRight" ? 20 : -20) * (side === "right" ? -1 : 1))); } }} />;
}
