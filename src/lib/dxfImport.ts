const MAX_DXF_BYTES = 8 * 1024 * 1024;

interface DxfPair {
  code: number;
  value: string;
}

interface DxfEntity {
  type: string;
  pairs: DxfPair[];
}

interface Point {
  x: number;
  y: number;
}

function number(entity: DxfEntity, code: number, fallback = 0) {
  const pair = entity.pairs.find((item) => item.code === code);
  const value = Number(pair?.value);
  return Number.isFinite(value) ? value : fallback;
}

function repeated(entity: DxfEntity, code: number) {
  return entity.pairs
    .filter((item) => item.code === code)
    .map((item) => Number(item.value));
}

function sampleArc(
  center: Point,
  radiusX: number,
  radiusY: number,
  startDegrees: number,
  endDegrees: number,
) {
  let sweep = endDegrees - startDegrees;
  while (sweep <= 0) sweep += 360;
  const steps = Math.max(12, Math.ceil(sweep / 6));
  return Array.from({ length: steps + 1 }, (_, index) => {
    const angle = ((startDegrees + (sweep * index) / steps) * Math.PI) / 180;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  });
}

function entityStrokes(entity: DxfEntity): Point[][] {
  switch (entity.type) {
    case "LINE":
      return [
        [
          { x: number(entity, 10), y: number(entity, 20) },
          { x: number(entity, 11), y: number(entity, 21) },
        ],
      ];
    case "LWPOLYLINE":
    case "SPLINE": {
      const xs = repeated(entity, 10);
      const ys = repeated(entity, 20);
      const points = xs
        .map((x, index) => ({ x, y: ys[index] }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));
      if ((number(entity, 70) & 1) === 1 && points.length > 2)
        points.push({ ...points[0] });
      return points.length > 1 ? [points] : [];
    }
    case "CIRCLE": {
      const radius = Math.abs(number(entity, 40));
      if (!radius) return [];
      return [
        sampleArc(
          { x: number(entity, 10), y: number(entity, 20) },
          radius,
          radius,
          0,
          360,
        ),
      ];
    }
    case "ARC": {
      const radius = Math.abs(number(entity, 40));
      if (!radius) return [];
      return [
        sampleArc(
          { x: number(entity, 10), y: number(entity, 20) },
          radius,
          radius,
          number(entity, 50),
          number(entity, 51),
        ),
      ];
    }
    case "ELLIPSE": {
      const majorX = number(entity, 11);
      const majorY = number(entity, 21);
      const majorRadius = Math.hypot(majorX, majorY);
      const ratio = Math.max(0.0001, Math.abs(number(entity, 40, 1)));
      if (!majorRadius) return [];
      const rotation = Math.atan2(majorY, majorX);
      const center = { x: number(entity, 10), y: number(entity, 20) };
      const start = number(entity, 41, 0);
      let end = number(entity, 42, Math.PI * 2);
      while (end <= start) end += Math.PI * 2;
      const steps = Math.max(24, Math.ceil(((end - start) * 180) / Math.PI / 6));
      return [
        Array.from({ length: steps + 1 }, (_, index) => {
          const angle = start + ((end - start) * index) / steps;
          const localX = Math.cos(angle) * majorRadius;
          const localY = Math.sin(angle) * majorRadius * ratio;
          return {
            x: center.x + localX * Math.cos(rotation) - localY * Math.sin(rotation),
            y: center.y + localX * Math.sin(rotation) + localY * Math.cos(rotation),
          };
        }),
      ];
    }
    default:
      return [];
  }
}

function parseEntities(source: string) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const pairs: DxfPair[] = [];
  for (let index = 0; index + 1 < lines.length; index += 2) {
    const code = Number(lines[index].trim());
    if (!Number.isInteger(code)) continue;
    pairs.push({ code, value: lines[index + 1].trim() });
  }
  const entities: DxfEntity[] = [];
  let current: DxfEntity | null = null;
  for (const pair of pairs) {
    if (pair.code === 0) {
      if (current) entities.push(current);
      current = { type: pair.value.toUpperCase(), pairs: [] };
    } else if (current) {
      current.pairs.push(pair);
    }
  }
  if (current) entities.push(current);
  return entities;
}

export function dxfToSvg(source: string) {
  const byteLength = new TextEncoder().encode(source).byteLength;
  if (byteLength > MAX_DXF_BYTES) throw new Error("DXF больше 8 МБ.");
  if (/\u0000/.test(source))
    throw new Error("Поддерживается только текстовый ASCII DXF.");

  const strokes: Point[][] = [];
  let polyline: Point[] | null = null;
  let polylineClosed = false;
  for (const entity of parseEntities(source)) {
    if (entity.type === "POLYLINE") {
      if (polyline?.length > 1) strokes.push(polyline);
      polyline = [];
      polylineClosed = (number(entity, 70) & 1) === 1;
    } else if (entity.type === "VERTEX" && polyline) {
      polyline.push({ x: number(entity, 10), y: number(entity, 20) });
    } else if (entity.type === "SEQEND" && polyline) {
      if (polylineClosed && polyline.length > 2)
        polyline.push({ ...polyline[0] });
      if (polyline.length > 1) strokes.push(polyline);
      polyline = null;
    } else {
      strokes.push(...entityStrokes(entity));
    }
  }
  if (polyline?.length > 1) strokes.push(polyline);

  const points = strokes.flat();
  if (!points.length)
    throw new Error(
      "В DXF не найдено поддерживаемых LINE, POLYLINE, ARC, CIRCLE, ELLIPSE или SPLINE.",
    );
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const width = Math.max(0.01, maxX - minX);
  const height = Math.max(0.01, maxY - minY);
  const physicalWidth = 160;
  const physicalHeight = Math.max(
    10,
    Math.round((physicalWidth * height * 10) / width) / 10,
  );
  const paths = strokes
    .filter((stroke) => stroke.length > 1)
    .map((stroke) => {
      const [first, ...rest] = stroke;
      const transform = (point: Point) => ({
        x: Math.round((point.x - minX) * 1000) / 1000,
        y: Math.round((maxY - point.y) * 1000) / 1000,
      });
      const start = transform(first);
      const data = [
        `M${start.x} ${start.y}`,
        ...rest.map((point) => {
          const next = transform(point);
          return `L${next.x} ${next.y}`;
        }),
      ].join(" ");
      return `<path d="${data}"/>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${physicalWidth}mm" height="${physicalHeight}mm" viewBox="0 0 ${width} ${height}" fill="none" stroke="currentColor" stroke-width="0.3" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}
