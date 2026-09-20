import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../Icon";
import { writingStartLimit, writingStartY } from "../../plotter/writingStart";

type Target = { page: number; y: number; left: number; top: number; width: number; right: boolean };

export default function WritingStartLine({ settings, metrics, sheet, disabled, onChange }: any) {
  const [draft, setDraft] = useState<Target | null>(null);
  const drag = useRef<{ x: number; y: number; viewport: HTMLElement } | null>(null);
  const frame = useRef(0);
  const ghost = useRef<HTMLDivElement | null>(null);
  const value = writingStartY(settings, metrics.height, sheet);
  const limit = writingStartLimit(settings, metrics.height);
  const spread = settings.pageSize === "NotebookSpread";
  const scale = Math.max(0.1, settings.zoom / 100);
  const clamp = (y: number) => Math.max(0, Math.min(limit, Math.round(y * 100) / 100));

  const locate = (x: number, y: number, viewport: HTMLElement): Target => {
    const shells = Array.from(viewport.querySelectorAll<HTMLElement>(".page-shell"));
    let chosen = shells[0];
    let best = Infinity;
    for (const shell of shells) {
      const r = shell.getBoundingClientRect();
      const distance = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (distance < best) { best = distance; chosen = shell; }
    }
    const r = chosen.getBoundingClientRect();
    const right = spread && x >= r.left + r.width / 2;
    let page = Number(chosen.dataset.pageIndex) + (right ? 1 : 0);
    let start = clamp((y - r.top) * metrics.height / r.height);
    // Beyond the last sheet, dropping creates the next page through reflow.
    if (chosen === shells.at(-1) && y > r.bottom + 12 && page < 99) {
      page += 1;
      start = Math.max(0, Number(settings.marginTop) || 0);
    }
    const targetRight = spread && page % 2 === 1;
    return { page: Math.min(99, page), y: clamp(start), left: targetRight ? r.right : r.left - 28,
      top: r.top + clamp(start) * r.height / metrics.height, width: r.width / (spread ? 2 : 1), right: targetRight };
  };
  const update = () => {
    const pointer = drag.current;
    if (!pointer) return;
    const r = pointer.viewport.getBoundingClientRect();
    const dy = pointer.y > r.bottom - 48 ? Math.min(18, (pointer.y-r.bottom+48)/3)
      : pointer.y < r.top+48 ? -Math.min(18, (r.top+48-pointer.y)/3) : 0;
    const dx = pointer.x > r.right - 32 ? 10 : pointer.x < r.left + 32 ? -10 : 0;
    if (dy || dx) pointer.viewport.scrollBy(dx, dy);
    const target = locate(pointer.x, pointer.y, pointer.viewport);
    if (ghost.current) {
      ghost.current.style.transform = `translate3d(${pointer.x - 14}px, ${pointer.y}px, 0)`;
      ghost.current.classList.toggle("points-left", target.right);
      const line = ghost.current.querySelector("i")!;
      line.style.left = `${(target.right ? target.left - target.width : target.left + 28) - pointer.x + 14}px`;
      line.style.top = `${target.top - pointer.y}px`;
      line.style.width = `${target.width}px`;
    }
    frame.current = requestAnimationFrame(update);
  };
  const stop = () => { drag.current = null; cancelAnimationFrame(frame.current); setDraft(null); };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  const movePage = (delta: number) => onChange(Math.max(0, Math.min(99, sheet + delta)), value);
  return <>
    <div className={`writing-start-guide ${spread && sheet % 2 === 1 ? "points-left" : ""}`} style={{ opacity: draft ? 0 : 1, "--guide-width": `${metrics.width * scale / (spread ? 2 : 1)}px`, top: value * scale, left: spread && sheet % 2 === 1 ? "100%" : undefined } as React.CSSProperties}>
      <i aria-hidden="true" />
      <button type="button" role="slider" className={spread && sheet % 2 === 1 ? "points-left" : ""}
        title="Перетащите на нужную страницу. Page Up / Page Down — сменить страницу. Двойной щелчок — начать сначала."
        aria-label={`Начало письма на странице ${sheet + 1}`} aria-valuemin={0} aria-valuemax={Math.round(limit * 25.4 / 96)}
        aria-valuenow={Math.round(value * 25.4 / 96)} disabled={disabled}
        onPointerDown={event => {
          if (disabled) return;
          event.preventDefault(); event.stopPropagation();
          const viewport = event.currentTarget.closest(".pages-viewport") as HTMLElement;
          drag.current = { x: event.clientX, y: event.clientY, viewport };
          setDraft(locate(event.clientX, event.clientY, viewport));
          event.currentTarget.setPointerCapture(event.pointerId); frame.current = requestAnimationFrame(update);
        }}
        onPointerMove={event => { if (drag.current) { event.stopPropagation(); drag.current.x = event.clientX; drag.current.y = event.clientY; } }}
        onPointerUp={event => {
          if (!drag.current) return;
          const target = locate(event.clientX, event.clientY, drag.current.viewport);
          stop();
          if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          if (!disabled) onChange(target.page, target.y);
        }}
        onPointerCancel={stop} onLostPointerCapture={stop}
        onDoubleClick={() => { if (!disabled) onChange(0, null); }}
        onKeyDown={event => {
          if (disabled) return;
          if (["PageDown", "PageUp", "ArrowLeft", "ArrowRight"].includes(event.key)) {
            event.preventDefault(); event.stopPropagation(); movePage(["PageDown", "ArrowRight"].includes(event.key) ? 1 : -1); return;
          }
          const delta = (event.shiftKey ? 10 : 1) * 96 / 25.4;
          const next = event.key === "ArrowUp" ? value-delta : event.key === "ArrowDown" ? value+delta : event.key === "Home" ? 0 : event.key === "End" ? limit : null;
          if (next !== null) { event.preventDefault(); event.stopPropagation(); onChange(sheet, clamp(next)); }
        }}><Icon name="writing-start" /></button>
    </div>
    {draft && createPortal(<div ref={ghost} style={{ transform: `translate3d(${(drag.current?.x ?? draft.left) - 14}px, ${drag.current?.y ?? draft.top}px, 0)` }} className={`writing-start-drop ${draft.right ? "points-left" : ""}`} aria-hidden="true"><Icon name="writing-start" /><i /></div>, document.body)}
  </>;
}
