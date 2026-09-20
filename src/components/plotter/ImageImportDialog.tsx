import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { vectorizePlotterImage } from "../../font-builder/photoVectorization";
import type { Stroke } from "../../plotter/workshop";

export default function ImageImportDialog({ file, maxWidth, maxHeight, onClose, onApply }: {
  file: File; maxWidth: number; maxHeight: number; onClose: () => void; onApply: (strokes: Stroke[]) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"contour" | "centerline">("contour");
  const [threshold, setThreshold] = useState(128), [width, setWidth] = useState(Math.min(160, maxWidth));
  const [strokes, setStrokes] = useState<Stroke[]>([]), [busy, setBusy] = useState(true), [error, setError] = useState("");
  const [source, setSource] = useState("");
  useEffect(() => { dialog.current?.showModal(); const url = URL.createObjectURL(file); setSource(url); return () => URL.revokeObjectURL(url); }, [file]);
  useEffect(() => {
    let cancelled = false; setBusy(true); setError("");
    const timer = setTimeout(() => {
      vectorizePlotterImage(file, threshold, width, maxHeight, mode).then(value => { if (!cancelled) setStrokes(value); })
        .catch(reason => { if (!cancelled) { setError(String(reason.message || reason)); setStrokes([]); } })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [file, threshold, width, maxHeight, mode]);
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "white"; ctx.fillRect(0, 0, 600, 420); ctx.strokeStyle = "#111"; ctx.lineWidth = 1;
    let x = 1, y = 1; for (const stroke of strokes) for (const p of stroke) { x=Math.max(x,p.x); y=Math.max(y,p.y); }
    const scale = Math.min(580/x,400/y);
    for (const stroke of strokes) { ctx.beginPath(); stroke.forEach((p,i) => i ? ctx.lineTo(10+p.x*scale,10+p.y*scale) : ctx.moveTo(10+p.x*scale,10+p.y*scale)); ctx.stroke(); }
  }, [strokes]);
  return createPortal(<dialog className="drawing-image-dialog" ref={dialog} onCancel={onClose} aria-labelledby="image-import-title">
    <header><h2 id="image-import-title">Рисунок из изображения</h2><button onClick={onClose} aria-label="Закрыть импорт">×</button></header>
    <div className="drawing-image-previews"><figure><figcaption>Оригинал</figcaption><img src={source} alt={file.name} /></figure><figure><figcaption>Линии для плоттера</figcaption><canvas ref={canvas} width={600} height={420} /></figure></div>
    <div className="drawing-image-fields">
      <label>Обработка<select value={mode} onChange={e=>setMode(e.target.value as "contour" | "centerline")}><option value="contour">Контуры</option><option value="centerline">Осевые линии</option></select></label>
      <label>Порог чёрного · 1–254<input type="number" min="1" max="254" value={threshold} onChange={e=>setThreshold(Math.max(1,Math.min(254,Number(e.target.value)||1)))} /></label>
      <label>Ширина, мм<input type="number" min="1" max={maxWidth} value={width} onChange={e=>setWidth(Math.max(1,Math.min(maxWidth,Number(e.target.value)||1)))} /></label>
    </div>

    <p role="status">{busy ? "Строю линии…" : error || (strokes.length ? `Штрихов: ${strokes.length}` : "Линии не найдены. Увеличьте порог.")}</p>
    <footer><button onClick={onClose}>Отмена</button><button className="primary" disabled={busy || !!error || !strokes.length} onClick={()=>onApply(strokes)}>Добавить в рисунок</button></footer>
  </dialog>, document.body);
}
