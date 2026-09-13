import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";

const WIDTH = 640;
const HEIGHT = 520;
const LEFT = 72;
const RIGHT = 568;
const BASELINE = 408;
const SCALE = 1.14;

type FontPoint = { x: number; y: number };
type FontStroke = FontPoint[];
type PointerSample = Pick<PointerEvent, "clientX" | "clientY">;

function canvasPoint(event: PointerSample, canvas: HTMLCanvasElement) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) * WIDTH) / bounds.width,
    y: ((event.clientY - bounds.top) * HEIGHT) / bounds.height,
  };
}

function toFontPoint(point: FontPoint) {
  return {
    x: Math.round(((point.x - LEFT) / SCALE) * 10) / 10,
    y: Math.round(((point.y - BASELINE) / SCALE) * 10) / 10,
  };
}

function toCanvasPoint(point: FontPoint) {
  return {
    x: LEFT + point.x * SCALE,
    y: BASELINE + point.y * SCALE,
  };
}

function coalescedSamples(event: ReactPointerEvent<HTMLCanvasElement>) {
  const nativeEvent = event.nativeEvent;
  if (typeof nativeEvent.getCoalescedEvents !== "function") return [nativeEvent];
  const samples = nativeEvent.getCoalescedEvents();
  return samples.length ? samples : [nativeEvent];
}

export default function FontCanvas({
  character,
  strokes,
  onChange,
}: {
  character: string;
  strokes: FontStroke[];
  onChange: (
    strokes: FontStroke[],
    options?: { transient?: boolean; previous?: FontStroke[] },
  ) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<FontStroke | null>(null);
  const baseStrokesRef = useRef<FontStroke[]>([]);
  const activePointerRef = useRef<{ id: number; type: string } | null>(null);
  const penSeenRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
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
      context.font = "11px Inter, system-ui, sans-serif";
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

    context.strokeStyle = "#17211c";
    context.lineWidth = 4;
    context.lineCap = "round";
    context.lineJoin = "round";
    strokes.forEach((stroke) => {
      if (stroke.length < 1) return;
      context.beginPath();
      stroke.forEach((point, index) => {
        const canvasPosition = toCanvasPoint(point);
        if (index === 0) context.moveTo(canvasPosition.x, canvasPosition.y);
        else context.lineTo(canvasPosition.x, canvasPosition.y);
      });
      context.stroke();
    });
  }, [character, strokes]);

  const begin = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.button !== undefined && event.button !== 0) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pointerType = event.pointerType || "mouse";
    if (!event.isPrimary && pointerType !== "pen") return;
    if (pointerType === "pen") penSeenRef.current = true;
    if (
      pointerType === "touch" &&
      (penSeenRef.current || Math.max(event.width, event.height) > 28)
    )
      return;
    if (activePointerRef.current) {
      if (
        pointerType !== "pen" ||
        activePointerRef.current.type === "pen"
      )
        return;
      drawingRef.current = null;
      onChange(baseStrokesRef.current, { transient: true });
      activePointerRef.current = null;
    }
    event.preventDefault();
    activePointerRef.current = { id: event.pointerId, type: pointerType };
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Older iPadOS WebKit can reject capture while the Pencil is settling. */
    }
    const point = toFontPoint(canvasPoint(event, canvas));
    baseStrokesRef.current = strokes;
    drawingRef.current = [point];
    onChange([...baseStrokesRef.current, drawingRef.current], {
      transient: true,
    });
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (
      !drawingRef.current ||
      activePointerRef.current?.id !== event.pointerId
    )
      return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    event.preventDefault();
    const nextStroke = [...drawingRef.current];
    for (const sample of coalescedSamples(event)) {
      const point = toFontPoint(canvasPoint(sample, canvas));
      const previous = nextStroke.at(-1);
      if (
        previous &&
        Math.hypot(point.x - previous.x, point.y - previous.y) < 0.8
      )
        continue;
      nextStroke.push(point);
    }
    if (nextStroke.length === drawingRef.current.length) return;
    drawingRef.current = nextStroke;
    onChange([...baseStrokesRef.current, drawingRef.current], {
      transient: true,
    });
  };

  const end = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activePointerRef.current?.id !== event.pointerId) return;
    event.preventDefault();
    activePointerRef.current = null;
    if (!drawingRef.current) return;
    const stroke = drawingRef.current;
    drawingRef.current = null;
    if (stroke.length > 1)
      onChange([...baseStrokesRef.current, stroke], {
        previous: baseStrokesRef.current,
      });
    else onChange(baseStrokesRef.current, { transient: true });
  };

  return (
    <canvas
      ref={canvasRef}
      className="font-drawing-canvas"
      width={WIDTH}
      height={HEIGHT}
      aria-label={`Поле рисования символа ${character}`}
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
