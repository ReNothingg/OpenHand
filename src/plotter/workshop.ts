export type Point = { x: number; y: number };
export type Stroke = Point[] & { pressure?: number; feedRate?: number };
export const MAX_POINTS = 100_000;

export function validateStrokes(value: unknown): Stroke[] {
  if (!Array.isArray(value) || value.length > 20_000)
    throw new Error("Слишком много траекторий.");
  let count = 0;
  return value.map((stroke) => {
    if (!Array.isArray(stroke) || stroke.length < 2)
      throw new Error("В траектории нужны хотя бы две точки.");
    count += stroke.length;
    if (count > MAX_POINTS)
      throw new Error("Лимит мастерской — 100 000 точек.");
    const result: Stroke = stroke.map((point) => {
      if (
        !point ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y) ||
        Math.abs(point.x) > 100_000 ||
        Math.abs(point.y) > 100_000
      )
        throw new Error("Некорректные координаты траектории.");
      return { x: point.x, y: point.y };
    });
    for (const key of ["pressure", "feedRate"] as const) {
      const n = (stroke as Stroke)[key];
      if (n !== undefined) {
        if (
          !Number.isFinite(n) ||
          n <= 0 ||
          (key === "feedRate" ? n > 10000 : n > 2)
        )
          throw new Error("Некорректные параметры штриха.");
        result[key] = n;
      }
    }
    return result;
  });
}

export function bounds(strokes: Stroke[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const stroke of strokes)
    for (const p of stroke) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  if (!Number.isFinite(minX))
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0 };
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}

export function transform(
  strokes: Stroke[],
  options: {
    scale?: number;
    angle?: number;
    mirrorX?: boolean;
    mirrorY?: boolean;
    x?: number;
    y?: number;
  },
) {
  const { scale = 1, angle = 0, x = 0, y = 0 } = options;
  if (
    ![scale, angle, x, y].every(Number.isFinite) ||
    scale <= 0 ||
    scale > 1000
  )
    throw new Error("Проверьте масштаб и координаты.");
  const b = bounds(strokes),
    cx = (b.minX + b.maxX) / 2,
    cy = (b.minY + b.maxY) / 2;
  const a = (angle * Math.PI) / 180;
  return validateStrokes(
    strokes.map((stroke) =>
      Object.assign(
        stroke.map((p) => {
          const px = (p.x - cx) * scale * (options.mirrorX ? -1 : 1);
          const py = (p.y - cy) * scale * (options.mirrorY ? -1 : 1);
          return {
            x: cx + px * Math.cos(a) - py * Math.sin(a) + x,
            y: cy + px * Math.sin(a) + py * Math.cos(a) + y,
          };
        }),
        { pressure: stroke.pressure, feedRate: stroke.feedRate },
      ),
    ),
  );
}

export function alignToOrigin(strokes: Stroke[], margin = 10) {
  const b = bounds(strokes);
  return transform(strokes, { x: margin - b.minX, y: margin - b.minY });
}

export function repeat(
  strokes: Stroke[],
  columns: number,
  rows: number,
  gap: number,
) {
  if (
    ![columns, rows].every((n) => Number.isInteger(n) && n >= 1 && n <= 20) ||
    !Number.isFinite(gap) ||
    gap < 0 ||
    gap > 1000
  )
    throw new Error("Повтор: 1–20 строк и столбцов, интервал 0–1000 мм.");
  if (strokes.reduce((n, s) => n + s.length, 0) * columns * rows > MAX_POINTS)
    throw new Error("Повтор превысит 100 000 точек.");
  const b = bounds(strokes),
    result: Stroke[] = [];
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < columns; col++)
      result.push(
        ...transform(strokes, {
          x: col * (b.width + gap),
          y: row * (b.height + gap),
        }),
      );
  return validateStrokes(result);
}

export function shape(kind: string, width: number, height: number): Stroke[] {
  if (![width, height].every((n) => Number.isFinite(n) && n > 0 && n <= 2000))
    throw new Error("Размер фигуры — от 0 до 2000 мм.");
  let points: Point[];
  if (kind === "ellipse")
    points = Array.from({ length: 129 }, (_, i) => ({
      x: width / 2 + (width / 2) * Math.cos((i * Math.PI) / 64),
      y: height / 2 + (height / 2) * Math.sin((i * Math.PI) / 64),
    }));
  else if (kind === "line")
    points = [
      { x: 0, y: 0 },
      { x: width, y: height },
    ];
  else if (kind === "triangle")
    points = [
      { x: width / 2, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: width / 2, y: 0 },
    ];
  else
    points = [
      { x: 0, y: 0 },
      { x: width, y: 0 },
      { x: width, y: height },
      { x: 0, y: height },
      { x: 0, y: 0 },
    ];
  return alignToOrigin([points]);
}

// Even/odd scanline filling preserves holes across all closed contours.
export function hatch(
  strokes: Stroke[],
  spacing: number,
  angle: number,
): Stroke[] {
  if (
    !Number.isFinite(spacing) ||
    spacing < 0.2 ||
    spacing > 100 ||
    !Number.isFinite(angle)
  )
    throw new Error("Шаг штриховки — 0,2–100 мм.");
  const a = (angle * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  const closed = strokes.filter(
    (p) =>
      p.length > 3 &&
      Math.hypot(p[0].x - p.at(-1)!.x, p[0].y - p.at(-1)!.y) < 0.001,
  );
  if (!closed.length) throw new Error("Для штриховки нужен замкнутый контур.");
  const rotated = closed.map((path) =>
    path.map((p) => ({ x: p.x * c + p.y * s, y: -p.x * s + p.y * c })),
  );
  const b = bounds(rotated),
    result: Stroke[] = [];
  const scanCount = Math.ceil(b.height / spacing);
  const edges = rotated.reduce((n, p) => n + p.length - 1, 0);
  if (scanCount * edges > 10_000_000)
    throw new Error("Слишком плотная штриховка. Увеличьте шаг.");
  for (let row = 0; row < scanCount; row++) {
    const y = b.minY + (row + 0.5) * spacing;
    const intersections: number[] = [];
    for (const path of rotated)
      for (let i = 1; i < path.length; i++) {
        const p = path[i - 1],
          q = path[i];
        if ((p.y <= y && q.y > y) || (q.y <= y && p.y > y))
          intersections.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
      }
    intersections.sort((a, b) => a - b);
    for (let i = 0; i + 1 < intersections.length; i += 2) {
      const line = [intersections[i], intersections[i + 1]].map((x) => ({
        x: x * c - y * s,
        y: x * s + y * c,
      }));
      result.push(row % 2 ? line.reverse() : line);
      if (result.length > 20_000)
        throw new Error("Слишком много линий штриховки.");
    }
  }
  return validateStrokes(result);
}

export function parseHPGL(source: string): Stroke[] {
  if (source.length > 4_000_000) throw new Error("HPGL больше 4 МБ.");
  let position = { x: 0, y: 0 },
    down = false,
    absolute = true,
    count = 0;
  let active: Stroke | null = null;
  const paths: Stroke[] = [];
  const flush = () => {
    if (active && active.length > 1) paths.push(active);
    active = null;
  };
  const move = (next: Point) => {
    if (++count > MAX_POINTS)
      throw new Error("HPGL содержит больше 100 000 точек.");
    if (down) {
      active ||= [{ ...position }];
      active.push(next);
    } else flush();
    position = next;
  };
  for (const raw of source.split(";")) {
    const command = raw.trim();
    if (!command) continue;
    const match = /^([A-Z]{2})([\s\S]*)$/i.exec(command);
    if (!match) throw new Error("Некорректная команда HPGL.");
    const op = match[1].toUpperCase(),
      body = match[2].trim();
    if (
      ![
        "IN",
        "PA",
        "PR",
        "PU",
        "PD",
        "SP",
        "VS",
        "PW",
        "AA",
        "AR",
        "CI",
      ].includes(op)
    )
      throw new Error(`HPGL: команда ${op} пока не поддерживается.`);
    const values = body ? body.split(/[\s,]+/).map(Number) : [];
    if (!values.every(Number.isFinite))
      throw new Error(`HPGL: неверные числа в ${op}.`);
    if (op === "IN") {
      flush();
      position = { x: 0, y: 0 };
      down = false;
      absolute = true;
      continue;
    }
    if (["SP", "VS", "PW"].includes(op)) {
      if (op === "SP") flush();
      continue;
    }
    if (op === "PU") {
      flush();
      down = false;
    }
    if (op === "PD") down = true;
    if (op === "PA") absolute = true;
    if (op === "PR") absolute = false;
    if (op === "AA" || op === "AR" || op === "CI") {
      if (
        (op === "CI" && (values.length < 1 || values.length > 2)) ||
        (op !== "CI" && (values.length < 3 || values.length > 4))
      )
        throw new Error(`HPGL: неверная дуга ${op}.`);
      const center =
        op === "CI"
          ? position
          : {
              x: values[0] / 40 + (op === "AR" ? position.x : 0),
              y: values[1] / 40 + (op === "AR" ? position.y : 0),
            };
      const radius =
        op === "CI"
          ? Math.abs(values[0] / 40)
          : Math.hypot(position.x - center.x, position.y - center.y);
      const sweep = op === "CI" ? 360 : values[2];
      if (Math.abs(sweep) > 3600 || radius > 100_000)
        throw new Error("HPGL: слишком большая дуга.");
      const steps = Math.max(8, Math.ceil(Math.abs(sweep) / 3));
      const start =
        op === "CI"
          ? 0
          : Math.atan2(position.y - center.y, position.x - center.x);
      if (op === "CI") {
        flush();
        active = [];
      }
      for (let i = op === "CI" ? 0 : 1; i <= steps; i++) {
        const a = start + (((sweep * Math.PI) / 180) * i) / steps;
        const next = {
          x: center.x + radius * Math.cos(a),
          y: center.y + radius * Math.sin(a),
        };
        if (op === "CI") {
          if (++count > MAX_POINTS) throw new Error("Слишком много точек.");
          active!.push(next);
        } else move(next);
      }
      if (op === "CI") flush();
      continue;
    }
    if (values.length % 2)
      throw new Error(`HPGL: неполная пара координат в ${op}.`);
    for (let i = 0; i < values.length; i += 2)
      move({
        x: values[i] / 40 + (absolute ? 0 : position.x),
        y: values[i + 1] / 40 + (absolute ? 0 : position.y),
      });
  }
  flush();
  if (!paths.length) throw new Error("В HPGL нет линий для рисования.");
  return validateStrokes(paths);
}

export function parseCoordinateCSV(source: string): Stroke[] {
  if (source.length > 4_000_000) throw new Error("CSV больше 4 МБ.");
  const result: Stroke[] = [];
  let active: Stroke = [];
  const flush = () => {
    if (active.length === 1)
      throw new Error("Одиночная точка CSV: добавьте вторую точку.");
    if (active.length) result.push(active);
    active = [];
  };
  for (const [index, line] of source
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .entries()) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (index === 0 && /^\s*x\s*[,;\t]\s*y\s*$/i.test(line)) continue;
    const cells = line.trim().split(/[,;\t]/);
    if (
      cells.length !== 2 ||
      cells.some((s) => !s.trim() || !Number.isFinite(Number(s)))
    )
      throw new Error(
        `CSV: строка ${index + 1} должна содержать X,Y в миллиметрах.`,
      );
    active.push({ x: Number(cells[0]), y: Number(cells[1]) });
  }
  flush();
  if (!result.length) throw new Error("CSV не содержит траекторий.");
  return validateStrokes(result);
}

export type SceneObject = { id: string; name: string; strokes: Stroke[] };
export function sceneObject(strokes: Stroke[], name = "Рисунок"): SceneObject {
  return { id: crypto.randomUUID(), name: name.slice(0,120), strokes: validateStrokes(strokes) };
}
export function serializeWorkshop(strokes: Stroke[], name: string, objects?: SceneObject[], paperRotated = false) {
  const items = objects || (strokes.length ? [sceneObject(strokes, name)] : []);
  validateStrokes(items.flatMap(item => item.strokes));
  return JSON.stringify({ format: "openhand-workshop", version: 2, name: name.slice(0,120), paperRotated,
    objects: items.map(item => ({ ...item, strokeSettings: item.strokes.map(s=>({pressure:s.pressure,feedRate:s.feedRate})) })) });
}
export function parseWorkshop(source: string) {
  if (source.length > 8_000_000) throw new Error("Проект больше 8 МБ.");
  const value = JSON.parse(source);
  if (value?.format !== "openhand-workshop" || ![1,2].includes(value.version)) throw new Error("Неизвестный формат проекта.");
  const readStrokes = (item: any) => {
    const strokes = validateStrokes(item.strokes);
    if (Array.isArray(item.strokeSettings)) strokes.forEach((s,i)=>{ const settings = item.strokeSettings[i]; if(settings) { s.pressure=settings.pressure; s.feedRate=settings.feedRate; } });
    return validateStrokes(strokes);
  };
  if (value.version === 2 && (!Array.isArray(value.objects) || value.objects.length > 1000)) throw new Error("Некорректный список объектов.");
  const objects: SceneObject[] = value.version === 1 ? [sceneObject(readStrokes(value), value.name)] : value.objects.map((item:any)=>({
    id: crypto.randomUUID(), name: String(item.name || "Рисунок").slice(0,120), strokes: readStrokes(item),
  }));
  const nonempty = objects.filter(item=>item.strokes.length);
  const strokes = validateStrokes(nonempty.flatMap(item=>item.strokes));
  return { name: String(value.name || "Без названия").slice(0,120), objects: nonempty, strokes, paperRotated: value.paperRotated === true };
}
