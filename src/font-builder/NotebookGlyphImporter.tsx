import { useEffect, useRef, useState } from "react";
import { vectorizeNotebookGlyph } from "./photoVectorization";
import type { FontStroke } from "./penInput";

type Crop = { x: number; y: number; width: number; height: number };
const FULL: Crop = { x: 0, y: 0, width: 1, height: 1 };

export default function NotebookGlyphImporter({ character, onImport }: {
  character: string; onImport: (strokes: FontStroke[]) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0);
  const [source, setSource] = useState<HTMLCanvasElement | null>(null);
  const [crop, setCrop] = useState(FULL);
  const [baseline, setBaseline] = useState(70);
  const [bodyTop, setBodyTop] = useState(30);
  const [threshold, setThreshold] = useState(125);
  const [blue, setBlue] = useState(true);
  const [message, setMessage] = useState("");
  const [strokes, setStrokes] = useState<FontStroke[]>([]);
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => {
    setStrokes([]);
    if (!source || !canvas.current) return;
    const target = canvas.current;
    target.width = source.width; target.height = source.height;
    const ctx = target.getContext("2d")!;
    ctx.drawImage(source, 0, 0);
    const x = crop.x * target.width, y = crop.y * target.height;
    const w = crop.width * target.width, h = crop.height * target.height;
    ctx.lineWidth = Math.max(2, target.width / 450);
    ctx.strokeStyle = "#de8620"; ctx.strokeRect(x, y, w, h);
    for (const [position, color] of [[bodyTop, "#24866b"], [baseline, "#cf3751"]] as const) {
      ctx.strokeStyle = color; ctx.beginPath();
      ctx.moveTo(x, y + h * position / 100); ctx.lineTo(x + w, y + h * position / 100); ctx.stroke();
    }
  }, [source, crop, baseline, bodyTop, blue, threshold, character]);
  const load = async (file?: File) => {
    if (!file) return;
    const id = ++generation.current;
    setMessage(""); setSource(null); setStrokes([]);
    if (file.size > 32 * 1024 * 1024) { setMessage("Фотография больше 32 МБ."); return; }
    const url = URL.createObjectURL(file);
    try {
      const image = new Image(); image.src = url; await image.decode();
      if (generation.current !== id) return;
      const scale = Math.min(1, 3000 / Math.max(image.naturalWidth, image.naturalHeight));
      const imageCanvas = document.createElement("canvas");
      imageCanvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      imageCanvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const ctx = imageCanvas.getContext("2d")!;
      ctx.fillStyle = "white"; ctx.fillRect(0, 0, imageCanvas.width, imageCanvas.height);
      ctx.drawImage(image, 0, 0, imageCanvas.width, imageCanvas.height);
      setCrop(FULL); setSource(imageCanvas);
    } catch { if (generation.current === id) setMessage("Не удалось открыть изображение. Экспортируйте HEIC в JPEG или PNG."); }
    finally { URL.revokeObjectURL(url); }
  };
  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
  };
  const trace = () => {
    if (!source) return;
    setStrokes([]); setMessage("");
    try {
      const x = Math.floor(crop.x * source.width), y = Math.floor(crop.y * source.height);
      const w = Math.min(source.width - x, Math.round(crop.width * source.width));
      const h = Math.min(source.height - y, Math.round(crop.height * source.height));
      if (w < 8 || h < 16) throw new Error("Выделите букву крупнее.");
      if (w * h > 1000000) throw new Error("Выделите одну букву: область слишком велика для обработки.");
      const data = source.getContext("2d")!.getImageData(x, y, w, h);
      const result = vectorizeNotebookGlyph(data, h * baseline / 100, h * bodyTop / 100, threshold, blue);
      if (!result.length) throw new Error("Чернила не найдены. Поднимите порог или выключите фильтр синей ручки.");
      setStrokes(result);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Ошибка обработки."); }
  };
  let minX = 0, minY = -250, maxX = 330, maxY = 80;
  for (const stroke of strokes) for (const p of stroke) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  const width = maxX - minX + 30, height = maxY - minY + 30;
  return <article className="notebook-glyph-import">
    <b>Буква из конспекта</b>
    <p>Загрузите страницу и выделите одну «{character}» рамкой. Красная линия — основание тела буквы, зелёная — верх строчной. Хвосты и точки оставьте внутри рамки. Соединения с соседями обрежьте.</p>
    <input type="file" accept="image/*" aria-label="Фотография конспекта" onChange={event => { void load(event.target.files?.[0]); event.target.value = ""; }} />
    {source && <>
      <canvas ref={canvas} className="notebook-source" aria-label="Выделите букву на фотографии" style={{touchAction:"none"}}
        onPointerDown={event => { start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={event => { if (!start.current) return; const end = point(event), from = start.current;
          setCrop({ x: Math.min(from.x, end.x), y: Math.min(from.y, end.y), width: Math.abs(end.x - from.x), height: Math.abs(end.y - from.y) }); }}
        onPointerUp={() => { start.current = null; }} onPointerCancel={() => { start.current = null; }} />
      <button type="button" onClick={() => setCrop(FULL)}>Вся фотография</button>
      <label>Верх строчной: {bodyTop}%<input type="range" min="0" max="90" value={bodyTop} onChange={e=>setBodyTop(Number(e.target.value))}/></label>
      <label>Базовая линия: {baseline}%<input type="range" min="10" max="100" value={baseline} onChange={e=>setBaseline(Number(e.target.value))}/></label>
      <label>Порог чернил: {threshold}<input type="range" min="40" max="210" value={threshold} onChange={e=>setThreshold(Number(e.target.value))}/></label>
      <label><input type="checkbox" checked={blue} onChange={e=>setBlue(e.target.checked)}/> Синяя ручка: отсечь бледную разлиновку</label>
      <button type="button" onClick={trace}>Построить траекторию</button>
    </>}
    {strokes.length > 0 && <>
      <svg className="notebook-trace" viewBox={`${minX - 15} ${minY - 15} ${width} ${height}`} role="img" aria-label={`Траектория буквы ${character}`}>
        <path d={`M ${minX - 15} 0 h ${width}`} stroke="#cf3751" fill="none"/>
        {strokes.map((stroke,i)=><polyline key={i} points={stroke.map(p=>`${p.x},${p.y}`).join(" ")} fill="none" stroke="#233266" strokeWidth="2"/>)}
      </svg>
      <p>Проверьте лишние линии и отрывы. Порядок штрихов восстановлен приблизительно; его можно поправить в редакторе.</p>
      <button type="button" onClick={()=>{ onImport(strokes); setStrokes([]); setMessage(`«${character}» добавлена в текущую форму.`); }}>Применить к «{character}»</button>
    </>}
    {message && <p role="status">{message}</p>}
  </article>;
}
