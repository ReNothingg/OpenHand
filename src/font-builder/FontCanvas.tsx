import { useEffect, useRef } from "react";

const WIDTH = 640;
const HEIGHT = 520;
const LEFT = 72;
const RIGHT = 568;
const BASELINE = 408;
const SCALE = 1.14;

function canvasPoint(event, canvas) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: ((event.clientX - bounds.left) * WIDTH) / bounds.width,
    y: ((event.clientY - bounds.top) * HEIGHT) / bounds.height,
  };
}

function toFontPoint(point) {
  return {
    x: Math.round(((point.x - LEFT) / SCALE) * 10) / 10,
    y: Math.round(((point.y - BASELINE) / SCALE) * 10) / 10,
  };
}

function toCanvasPoint(point) {
  return {
    x: LEFT + point.x * SCALE,
    y: BASELINE + point.y * SCALE,
  };
}

export default function FontCanvas({ character, strokes, onChange }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(null);
  const baseStrokesRef = useRef([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
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

  const begin = (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const canvas = canvasRef.current;
    canvas.setPointerCapture(event.pointerId);
    const point = toFontPoint(canvasPoint(event, canvas));
    baseStrokesRef.current = strokes;
    drawingRef.current = [point];
    onChange([...baseStrokesRef.current, drawingRef.current], {
      transient: true,
    });
  };

  const move = (event) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const point = toFontPoint(canvasPoint(event, canvas));
    const previous = drawingRef.current.at(-1);
    if (Math.hypot(point.x - previous.x, point.y - previous.y) < 1.8) return;
    drawingRef.current = [...drawingRef.current, point];
    onChange([...baseStrokesRef.current, drawingRef.current], {
      transient: true,
    });
  };

  const end = () => {
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
    />
  );
}
