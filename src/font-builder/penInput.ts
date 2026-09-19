export type FontPoint = {
  x: number;
  y: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  time?: number;
};
export type FontStroke = FontPoint[];
export type PenSettings = {
  inputMode: "auto" | "pen" | "all";
  pressureEnabled: boolean;
  pressureResponse: number;
  smoothing: number;
  tiltEnabled: boolean;
};
export const DEFAULT_PEN_SETTINGS: PenSettings = {
  inputMode: "auto",
  pressureEnabled: true,
  pressureResponse: 1,
  smoothing: 25,
  tiltEnabled: false,
};

export function finiteClamp(
  value: unknown,
  min: number,
  max: number,
  fallback: number,
) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
}

export function normalizePenSettings(
  value: Partial<PenSettings> = {},
): PenSettings {
  if (!value || typeof value !== "object") value = {};
  return {
    inputMode:
      value.inputMode === "pen" || value.inputMode === "all"
        ? value.inputMode
        : "auto",
    pressureEnabled: value.pressureEnabled !== false,
    pressureResponse: finiteClamp(value.pressureResponse, 0.4, 2, 1),
    smoothing: finiteClamp(value.smoothing, 0, 70, 25),
    tiltEnabled: value.tiltEnabled === true,
  };
}

// Only pen devices provide meaningful force; mouse/touch are constant-width.
export function penPoint(
  sample: Pick<PointerEvent, "pressure" | "tiltX" | "tiltY" | "timeStamp">,
  position: { x: number; y: number },
  pointerType: string,
  startTime: number,
): FontPoint {
  if (pointerType !== "pen") return position;
  return {
    ...position,
    pressure: finiteClamp(sample.pressure, 0, 1, 0.5),
    tiltX: finiteClamp(sample.tiltX, -90, 90, 0),
    tiltY: finiteClamp(sample.tiltY, -90, 90, 0),
    time: Math.max(0, sample.timeStamp - startTime),
  };
}

export function appendSample(
  stroke: FontStroke,
  point: FontPoint,
  smoothing: number,
  final = false,
) {
  const previous = stroke.at(-1);
  if (!previous) {
    stroke.push(point);
    return;
  }
  const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
  if (
    distance < 0.12 &&
    Math.abs((point.pressure ?? 0.5) - (previous.pressure ?? 0.5)) < 0.015
  )
    return;
  // Reduce filtering at speed; preserve the actual lift-off endpoint.
  const alpha = final
    ? 1
    : 1 - (finiteClamp(smoothing, 0, 70, 25) / 100) * Math.exp(-distance / 8);
  stroke.push({
    ...point,
    x: previous.x + (point.x - previous.x) * alpha,
    y: previous.y + (point.y - previous.y) * alpha,
  });
}

export function completeStroke(stroke: FontStroke): FontStroke {
  const points = stroke.map((point) => ({
    ...point,
    x: Math.round(point.x * 100) / 100,
    y: Math.round(point.y * 100) / 100,
    ...(point.pressure === undefined
      ? {}
      : { pressure: Math.round(point.pressure * 10000) / 10000 }),
    ...(point.time === undefined ? {} : { time: Math.round(point.time) }),
  }));
  if (points.length !== 1) return points;
  // A tiny segment survives the GFont centerline format and renders as a dot.
  return [points[0]!, { ...points[0]!, x: points[0]!.x + 0.1 }];
}

export function nibWidth(point: FontPoint, settings: PenSettings): number {
  const pressure =
    settings.pressureEnabled && point.pressure !== undefined
      ? Math.pow(
          finiteClamp(point.pressure, 0, 1, 0.5),
          settings.pressureResponse,
        )
      : 0.5;
  const tilt =
    settings.tiltEnabled && point.tiltX !== undefined
      ? Math.min(1, Math.hypot(point.tiltX, point.tiltY || 0) / 90)
      : 0;
  return (1.2 + pressure * 5.6) * (1 + tilt * 0.65);
}

export function acceptsPointer(
  inputMode: PenSettings["inputMode"],
  event: Pick<
    PointerEvent,
    "pointerType" | "button" | "isPrimary" | "width" | "height"
  >,
  penSeen: boolean,
) {
  if (event.pointerType === "pen")
    return event.button === 0 || event.button === 5;
  if (inputMode === "pen" || event.button !== 0 || !event.isPrimary)
    return false;
  return (
    event.pointerType !== "touch" ||
    inputMode === "all" ||
    (!penSeen && Math.max(event.width, event.height) <= 28)
  );
}

export function strokeHit(
  stroke: FontStroke,
  point: FontPoint,
  radius: number,
) {
  return stroke.some((end, index) => {
    const start = stroke[Math.max(0, index - 1)]!;
    const dx = end.x - start.x,
      dy = end.y - start.y;
    const length = dx * dx + dy * dy;
    const t = length
      ? Math.max(
          0,
          Math.min(
            1,
            ((point.x - start.x) * dx + (point.y - start.y) * dy) / length,
          ),
        )
      : 0;
    return (
      Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t) <=
      radius
    );
  });
}
