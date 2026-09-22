import type { FontStroke } from "./penInput";
import { orderedStrokeSamples } from "./strokeSamples";

export type JoinAnchor = { stroke: number; end: "start" | "end" };
export type LetterForm = {
  strokes: FontStroke[];
  entry?: JoinAnchor;
  exit?: JoinAnchor;
  position?: "any" | "initial" | "medial" | "final";
};
export type LetterForms = Record<string, LetterForm[]>;

export function validForms(value: unknown): LetterForm[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 6).flatMap((form): LetterForm[] => {
    if (!form || !Array.isArray(form.strokes) || form.strokes.length > 512)
      return [];
    let count = 0;
    const strokes: FontStroke[] = [];
    for (const stroke of form.strokes) {
      if (
        !Array.isArray(stroke) ||
        stroke.length < 2 ||
        (count += stroke.length) > 100000
      )
        return [];
      if (
        stroke.some(
          (p) =>
            !p ||
            !Number.isFinite(p.x) ||
            !Number.isFinite(p.y) ||
            Math.abs(p.x) > 100000 ||
            Math.abs(p.y) > 100000,
        )
      )
        return [];
      strokes.push(
        orderedStrokeSamples(stroke.map((p) => {
          const point: FontStroke[number] = { x: p.x, y: p.y };
          for (const [key, min, max] of [
            ["pressure", 0, 1],
            ["tiltX", -90, 90],
            ["tiltY", -90, 90],
            ["time", 0, 86400000],
          ] as const) {
            if (Number.isFinite(p[key]) && p[key] >= min && p[key] <= max)
              point[key] = p[key];
          }
          return point;
        })),
      );
    }
    const anchor = (a: JoinAnchor | undefined) =>
      a &&
      Number.isInteger(a.stroke) &&
      a.stroke >= 0 &&
      a.stroke < strokes.length &&
      ["start", "end"].includes(a.end)
        ? a
        : undefined;
    return [
      {
        strokes,
        entry: anchor(form.entry),
        exit: anchor(form.exit),
        position: ["initial", "medial", "final"].includes(form.position)
          ? form.position
          : "any",
      },
    ];
  });
}

export function chooseForm(
  forms: LetterForm[],
  seed: number,
  occurrence: number,
  position: string,
  previous = -1,
) {
  const eligible = forms
    .map((form, index) => ({ form, index }))
    .filter(
      ({ form }) =>
        form.strokes.length &&
        (!form.position ||
          form.position === "any" ||
          form.position === position),
    );
  if (!eligible.length) return 0;
  const pool =
    eligible.length > 1
      ? eligible.filter((item) => item.index !== previous)
      : eligible;
  let hash = Math.imul((Number(seed) || 0) ^ occurrence, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return pool[(hash >>> 0) % pool.length]!.index;
}

export function formGlyph(form: LetterForm, codePoint: number) {
  const points = form.strokes.flat();
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;
  points.forEach((p) => {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  });
  return {
    codePoint,
    points,
    flags: form.strokes.flatMap((s) => s.map((_, i) => (i ? 1 : 0))),
    bounds: points.length
      ? { minX, maxX, minY, maxY }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  };
}

// Translation-invariant fingerprint, retaining stroke order and normalized shape.
export function trajectoryFingerprint(strokes: FontStroke[]) {
  const points = strokes.flat();
  if (!points.length) return "";
  const origin = points[0]!;
  return strokes
    .map((s) =>
      s
        .map(
          (p) =>
            `${Math.round((p.x - origin.x) * 10)},${Math.round((p.y - origin.y) * 10)}`,
        )
        .join(";"),
    )
    .join("|");
}

export function repeatedForms(forms: LetterForms) {
  return Object.entries(forms)
    .flatMap(([character, variants]) => {
      const keys = variants
        .filter((f) => f.strokes.length)
        .map((f) => trajectoryFingerprint(f.strokes));
      const distinct = new Set(keys).size;
      return keys.length ? [{ character, count: keys.length, distinct }] : [];
    })
    .sort((a, b) => a.distinct - b.distinct);
}

export type TrajectoryReport = {
  character: string;
  count: number;
  distinct: number;
  shapes: string[];
};
export function mergeTrajectoryReports(
  reports: TrajectoryReport[],
): TrajectoryReport[] {
  const merged = new Map<string, TrajectoryReport>();
  reports.forEach((r) => {
    const previous = merged.get(r.character);
    const shapes = [...new Set([...(previous?.shapes || []), ...r.shapes])];
    merged.set(r.character, {
      character: r.character,
      count: r.count + (previous?.count || 0),
      shapes,
      distinct: shapes.length,
    });
  });
  return [...merged.values()].sort(
    (a, b) => b.count / b.distinct - a.count / a.distinct,
  );
}
