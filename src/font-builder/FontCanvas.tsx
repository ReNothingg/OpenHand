import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import {
  acceptsPointer, appendSample, completeStroke, nibWidth, penPoint, strokeHit,
  type FontPoint, type FontStroke, type PenSettings,
} from "./penInput";

const WIDTH = 640;
const HEIGHT = 520;
const LEFT = 72;
const RIGHT = 568;
const BASELINE = 408;
const SCALE = 1.14;

type ActivePointer = { id: number; type: string; startTime: number; erasing: boolean };

export default function FontCanvas({ character, strokes, onChange, settings, tool, penSeenRef }: {
  character: string;
  strokes: FontStroke[];
  onChange: (strokes: FontStroke[], options?: { previous?: FontStroke[] }) => void;
  settings: PenSettings;
  tool: "pen" | "eraser";
  penSeenRef: { current: boolean };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<FontStroke>([]);
  const baseRef = useRef<FontStroke[]>(strokes);
  const erasedRef = useRef<FontStroke[]>(strokes);
  const activeRef = useRef<ActivePointer | null>(null);
  const predictedRef = useRef<FontStroke>([]);
  const hoverRef = useRef<FontPoint | null>(null);
  const frameRef = useRef(0);
  const paintRef = useRef<() => void>(() => {});

  const schedule = () => {
    if (!frameRef.current) frameRef.current = requestAnimationFrame(() => {
      frameRef.current = 0;
      paintRef.current();
    });
  };

  const cancel = () => {
    const active = activeRef.current;
    activeRef.current = null;
    drawingRef.current = [];
    predictedRef.current = [];
    hoverRef.current = null;
    if (active && canvasRef.current?.hasPointerCapture(active.id))
      canvasRef.current.releasePointerCapture(active.id);
    schedule();
  };

  const position = (sample: Pick<PointerEvent, "clientX" | "clientY">) => {
    const bounds = canvasRef.current.getBoundingClientRect();
    return {
      x: ((Math.max(0, Math.min(WIDTH, (sample.clientX - bounds.left) * WIDTH / Math.max(1, bounds.width)))) - LEFT) / SCALE,
      y: ((Math.max(0, Math.min(HEIGHT, (sample.clientY - bounds.top) * HEIGHT / Math.max(1, bounds.height)))) - BASELINE) / SCALE,
    };
  };

  paintRef.current = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(3, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(bounds.width * ratio));
    const height = Math.max(1, Math.round(bounds.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(width / WIDTH, 0, 0, height / HEIGHT, 0, 0);
    context.clearRect(0, 0, WIDTH, HEIGHT);
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, WIDTH, HEIGHT);
    context.strokeStyle = "#e2e6e3";
    context.lineWidth = 1;
    context.setLineDash([5, 7]);
    [
      { y: 66, label: "верхняя линия" },
      { y: 186, label: "строчная" },
      { y: BASELINE, label: "базовая" },
      { y: 492, label: "нижняя линия" },
    ].forEach(({ y, label }) => {
      context.beginPath();
      context.moveTo(LEFT, y);
      context.lineTo(RIGHT, y);
      context.stroke();
      context.fillStyle = "#9aa39e";
      context.font = "9px Inter, system-ui, sans-serif";
      context.textAlign = "right";
      context.fillText(label, LEFT - 12, y + 4);
    });
    context.setLineDash([]);

    context.strokeStyle = "#eef0ee";
    context.beginPath();
    context.moveTo(LEFT, 42);
    context.lineTo(LEFT, 492);
    context.moveTo(RIGHT, 42);
    context.lineTo(RIGHT, 492);
    context.stroke();

    if (!strokes.length) {
      context.fillStyle = "#f2f4f2";
      context.font = "390px Georgia, serif";
      context.textAlign = "center";
      context.textBaseline = "alphabetic";
      context.fillText(character, (LEFT + RIGHT) / 2, BASELINE);
    }
    const drawStroke = (stroke: FontStroke, alpha = 1) => {
      context.globalAlpha = alpha;
      context.strokeStyle = "#17211c";
      context.fillStyle = "#17211c";
      context.lineCap = "round";
      stroke.forEach((point, index) => {
        const previous = stroke[Math.max(0, index - 1)];
        const x = LEFT + point.x * SCALE, y = BASELINE + point.y * SCALE;
        if (!index || (point.x === previous.x && point.y === previous.y)) {
          context.beginPath();
          context.arc(x, y, nibWidth(point, settings) / 2, 0, Math.PI * 2);
          context.fill();
        } else {
          context.lineWidth = (nibWidth(previous, settings) + nibWidth(point, settings)) / 2;
          context.beginPath();
          context.moveTo(LEFT + previous.x * SCALE, BASELINE + previous.y * SCALE);
          context.lineTo(x, y);
          context.stroke();
        }
      });
      context.globalAlpha = 1;
    };
    const active = activeRef.current;
    (active?.erasing ? erasedRef.current : strokes).forEach((stroke) => drawStroke(stroke));
    if (active && !active.erasing) {
      drawStroke(drawingRef.current);
      if (predictedRef.current.length && drawingRef.current.length)
        drawStroke([drawingRef.current.at(-1), ...predictedRef.current], 0.35);
    }
    const hover = hoverRef.current;
    if (hover && (!active || active.erasing)) {
      context.beginPath();
      context.strokeStyle = "#64748b";
      context.lineWidth = 1;
      context.arc(LEFT + hover.x * SCALE, BASELINE + hover.y * SCALE,
        tool === "eraser" || active?.erasing ? 12 : nibWidth(hover, settings) / 2 + 2, 0, Math.PI * 2);
      context.stroke();
    }
  };

  useEffect(() => {
    cancel();
    baseRef.current = strokes;
    erasedRef.current = strokes;
    schedule();
  }, [character, strokes, settings, tool]);

  useEffect(() => {
    const observer = new ResizeObserver(schedule);
    observer.observe(canvasRef.current);
    const hide = () => { if (document.hidden) cancel(); };
    window.addEventListener("blur", cancel);
    window.addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", hide);
    return () => {
      observer.disconnect();
      window.removeEventListener("blur", cancel);
      window.removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", hide);
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      frameRef.current = 0;
      activeRef.current = null;
    };
  }, []);

  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!acceptsPointer(settings.inputMode, event.nativeEvent, penSeenRef.current)) return;
    if (activeRef.current) {
      if (event.pointerType !== "pen" || activeRef.current.type === "pen") return;
      cancel(); // Pencil takes priority over an uncommitted finger/palm stroke.
    }
    event.preventDefault();
    if (event.pointerType === "pen") penSeenRef.current = true;
    const active = { id: event.pointerId, type: event.pointerType, startTime: event.timeStamp,
      erasing: tool === "eraser" || event.button === 5 || Boolean(event.buttons & 32) };
    activeRef.current = active;
    baseRef.current = strokes;
    erasedRef.current = strokes;
    const point = penPoint(event.nativeEvent, position(event), active.type, active.startTime);
    drawingRef.current = [point];
    predictedRef.current = [];
    hoverRef.current = point;
    if (active.erasing) erasedRef.current = strokes.filter((stroke) => !strokeHit(stroke, point, 12 / SCALE));
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Capture may be unavailable in older WebKit. */ }
    schedule();
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (!active) {
      if (event.pointerType === "pen" || event.pointerType === "mouse") {
        if (event.pointerType === "pen") penSeenRef.current = true;
        hoverRef.current = penPoint(event.nativeEvent, position(event), event.pointerType, event.timeStamp);
        schedule();
      }
      return;
    }
    if (active.id !== event.pointerId) return;
    event.preventDefault();
    const native = event.nativeEvent;
    let samples: PointerEvent[] = [];
    try { samples = native.getCoalescedEvents?.() || []; } catch { /* Fall back to the delivered sample. */ }
    if (!samples.length) samples = [native];
    for (const sample of samples) {
      const point = penPoint(sample, position(sample), active.type, active.startTime);
      if (active.erasing) erasedRef.current = erasedRef.current.filter((stroke) => !strokeHit(stroke, point, 12 / SCALE));
      else appendSample(drawingRef.current, point, settings.smoothing);
      hoverRef.current = point;
    }
    predictedRef.current = [];
    if (!active.erasing && active.type === "pen") {
      try {
        predictedRef.current = (native.getPredictedEvents?.() || [])
          .filter((sample) => sample.timeStamp > native.timeStamp && sample.timeStamp - native.timeStamp <= 30)
          .slice(0, 6).map((sample) => penPoint(sample, position(sample), active.type, active.startTime));
      } catch { /* Prediction is optional and never becomes saved geometry. */ }
    }
    schedule();
  };

  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const active = activeRef.current;
    if (!active || active.id !== event.pointerId) return;
    event.preventDefault();
    if (!active.erasing) {
      const last = drawingRef.current.at(-1);
      // pointerup often reports zero force: keep contact pressure at the endpoint.
      appendSample(drawingRef.current, { ...last, ...position(event), ...(active.type === "pen" ? { time: Math.max(0, event.timeStamp - active.startTime) } : {}) }, 0, true);
    }
    const result = active.erasing ? erasedRef.current : [...baseRef.current, completeStroke(drawingRef.current)];
    const previous = baseRef.current;
    activeRef.current = null;
    predictedRef.current = [];
    drawingRef.current = [];
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!active.erasing || result.length !== previous.length) onChange(result, { previous });
    schedule();
  };

  return (
    <canvas ref={canvasRef} className="font-drawing-canvas" width={WIDTH} height={HEIGHT}
      aria-label={`Поле рисования символа ${character}`}
      onPointerDown={begin} onPointerMove={move} onPointerUp={end}
      onPointerCancel={(event) => { if (activeRef.current?.id === event.pointerId) cancel(); }}
      onLostPointerCapture={(event) => { if (activeRef.current?.id === event.pointerId) cancel(); }}
      onPointerLeave={(event) => {
        if (activeRef.current && !event.currentTarget.hasPointerCapture(activeRef.current.id)) cancel();
        if (!activeRef.current) { hoverRef.current = null; schedule(); }
      }}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
