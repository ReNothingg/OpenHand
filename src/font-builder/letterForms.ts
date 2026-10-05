import type { FontStroke } from "./penInput";
import { orderedStrokeSamples } from "./strokeSamples";

export type JoinAnchor = { stroke: number; end: "start" | "end"; point?: number };
export type LetterForm = {
  strokes: FontStroke[];
  /** Step from originX, or the left ink bound for legacy forms. */
  advance?: number;
  /** Baseline origin in source coordinates; ink may overhang either side. */
  originX?: number;
  /** Forms photographed in the same writing session share a consistent style. */
  style?: string;
  /** Recorded absences are pen lifts; do not invent anchors for these forms. */
  joins?: "recorded";
  context?: { before: string; after: string };
  entry?: JoinAnchor;
  exit?: JoinAnchor;
  position?: "any" | "initial" | "medial" | "final";
  /** Written word and letter index ("word:letter"); neighbours from one word
   * keep their real connection when they meet again. */
  source?: string;
  /** Points of the first stroke that only lead in from the previous letter. */
  leadIn?: number;
};
export type LetterForms = Record<string, LetterForm[]>;

/** Punctuation ends a word too: the е in «море,» needs its final form. */
export function letterPosition(characters: string[], index: number) {
  const isLetter = (value: string | undefined) => Boolean(value && /^\p{L}$/u.test(value));
  if (!isLetter(characters[index])) return "any";
  if (!isLetter(characters[index - 1])) return "initial";
  return isLetter(characters[index + 1]) ? "medial" : "final";
}

/** Photographed fonts keep more real alternatives than hand-drawn studio sets. */
export const MAX_LETTER_FORMS = 128;

export function validForms(value: unknown): LetterForm[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_LETTER_FORMS).flatMap((form): LetterForm[] => {
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
        ? { ...a, point: Number.isInteger(a.point) && a.point! >= 0 && a.point! < strokes[a.stroke]!.length ? a.point : undefined }
        : undefined;
    return [
      {
        strokes,
        ...(form.joins === "recorded" ? { joins: "recorded" as const } : {}),
        ...(typeof form.style === "string" && /^[a-z0-9-]{1,32}$/.test(form.style)
          ? { style: form.style } : {}),
        ...(form.context && typeof form.context.before === "string" &&
          typeof form.context.after === "string" &&
          /^[\p{L}\p{N}]?$/u.test(form.context.before) && /^[\p{L}\p{N}]?$/u.test(form.context.after)
          ? { context: { before: form.context.before, after: form.context.after } } : {}),
        ...(typeof form.advance === "number" && Number.isFinite(form.advance) &&
          form.advance > 0 && form.advance <= 100000 ? { advance: form.advance } : {}),
        ...(typeof form.originX === "number" && Number.isFinite(form.originX) &&
          Math.abs(form.originX) <= 100000 ? { originX: form.originX } : {}),
        ...(typeof form.source === "string" && /^[\w.:-]{1,48}$/.test(form.source)
          ? { source: form.source } : {}),
        ...(Number.isInteger(form.leadIn) && form.leadIn > 0 && form.leadIn < strokes[0]!.length - 1
          ? { leadIn: form.leadIn } : {}),
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
  coherence = 0,
  context?: { before: string; after: string },
) {
  let eligible = forms
    .map((form, index) => ({ form, index }))
    .filter(
      ({ form }) =>
        form.strokes.length &&
        (!form.position ||
          form.position === "any" ||
          form.position === position),
    );
  if (!eligible.length) return 0;
  let hash = Math.imul((Number(seed) || 0) ^ occurrence, 0x45d9f3b);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  const style = forms[0]?.style;
  const consistent = style ? eligible.filter(item => item.form.style === style) : [];
  if (consistent.length && ((hash >>> 0) % 100) < Math.max(0, Math.min(100, coherence)))
    eligible = consistent;
  if (context) {
    const score = (form: LetterForm) => form.context
      ? Number(form.context.before === context.before) + Number(form.context.after === context.after) : 0;
    const best = Math.max(...eligible.map(item => score(item.form)));
    // Prefer an observed connection, while leaving occasional alternatives.
    if (best && (style?.startsWith("raster-") || ((hash >>> 8) % 10) < 8))
      eligible = eligible.filter(item => score(item.form) === best);
  }
  // Handwriting can repeat a shape. Prefer a different form, but avoid a rigid
  // A-B-A-B alternation when only two forms are available.
  const alternatives = eligible.filter((item) => item.index !== previous);
  const pool = alternatives.length && (hash & 3) < 2 ? alternatives : eligible;
  return pool[(hash >>> 3) % pool.length]!.index;
}

function anchorPoint(form: LetterForm, anchor: JoinAnchor | undefined) {
  const stroke = anchor && form.strokes[anchor.stroke];
  if (!stroke?.length) return null;
  return stroke[anchor!.point ?? (anchor!.end === "start" ? 0 : stroke.length - 1)] ?? null;
}

function sourceKey(form: LetterForm, offset = 0) {
  const parts = form.source?.split(":");
  return parts?.length === 2 ? `${parts[0]}:${Number(parts[1]) + offset}` : undefined;
}

function unit(seed: number, ...keys: number[]) {
  let hash = Math.imul((Number(seed) || 0) ^ 0x9e3779b9, 0x45d9f3b);
  for (const key of keys) {
    hash = Math.imul(hash ^ Math.imul(key + 1, 0x27d4eb2d), 0x45d9f3b);
    hash ^= hash >>> 15;
  }
  return (hash >>> 0) / 4294967296;
}

function direction(form: LetterForm, anchor: JoinAnchor, outward: boolean) {
  const stroke = form.strokes[anchor.stroke];
  if (!stroke || stroke.length < 2) return null;
  const i = anchor.point ?? (anchor.end === "start" ? 0 : stroke.length - 1);
  const j = Math.max(0, Math.min(stroke.length - 1, i + (anchor.end === "start" ? 3 : -3)));
  const a = stroke[i]!, b = stroke[j]!;
  const dx = outward ? a.x - b.x : b.x - a.x, dy = outward ? a.y - b.y : b.y - a.y;
  const length = Math.hypot(dx, dy);
  return length ? { x: dx / length, y: dy / length } : null;
}

export type PlannedLetter = {
  char: string;
  forms: LetterForm[];
  /** initial | medial | final | any (letterPosition). */
  position: string;
  /** Form used the last time this character was written. */
  previous?: number;
};

/**
 * Chooses the written forms of one word together (Viterbi over the letters).
 * Letters that followed each other in a photographed word are kept together,
 * so common words and syllables reuse real joins; other neighbours need
 * joins at the same height and direction. A seeded preference per letter
 * keeps every occurrence of a word different. Units: body height 200.
 */
export function planConnectedForms(letters: PlannedLetter[], seed: number, occurrence: number, maxCandidates = 40) {
  const candidates = letters.map((letter, i) => {
    const usable = letter.forms.map((form, index) => ({ form, index })).filter(({ form }) => form.strokes.length);
    const placed = usable.filter(({ form }) => !form.position || form.position === "any" || form.position === letter.position);
    const pool = placed.length ? placed : usable;
    if (pool.length <= maxCandidates) return pool;
    return [...pool].sort((a, b) => unit(seed, occurrence, i, a.index) - unit(seed, occurrence, i, b.index)).slice(0, maxCandidates);
  });
  // Real continuations of the previous letter's candidates are always offered.
  for (let i = 1; i < letters.length; i++) {
    const offered = new Set(candidates[i]!.map(c => c.index));
    const bySource = new Map(letters[i]!.forms.map((form, index) => [form.source, index]));
    for (const { form } of candidates[i - 1]!) {
      const next = bySource.get(sourceKey(form, 1));
      if (next !== undefined && !offered.has(next) && letters[i]!.forms[next]!.strokes.length) {
        offered.add(next);
        candidates[i]!.push({ form: letters[i]!.forms[next]!, index: next });
      }
    }
  }
  const unary = (i: number, form: LetterForm, index: number) => {
    const letter = letters[i]!;
    let cost = unit(seed, occurrence, i, index, 7) * 1.1;
    if (index === letter.previous) cost += 0.8;
    // A word starts without a join and ends without one, as it was written.
    if (letter.position === "initial" && form.entry) cost += form.leadIn ? 0.35 : 0.9;
    if (letter.position === "final" && form.exit) cost += 0.3;
    if (letter.position === "medial" && !(form.entry && form.exit)) cost += 0.45;
    return cost;
  };
  const pair = (a: LetterForm, aChar: string, b: LetterForm, bChar: string) => {
    if (a.source && sourceKey(a, 1) === b.source) return -2.2;
    let cost = 0;
    if (a.exit && b.entry) {
      const pa = anchorPoint(a, a.exit), pb = anchorPoint(b, b.entry);
      const dy = pa && pb ? Math.abs(pa.y - pb.y) / 200 : 1;
      cost += 3 * dy * dy + 1.2 * dy;
      const da = direction(a, a.exit, true), db = direction(b, b.entry, false);
      if (da && db) cost += 0.6 * (1 - (da.x * db.x + da.y * db.y)) / 2;
    } else if (a.exit || b.entry) cost += 0.9;
    else cost += 0.5;
    if (b.context?.before === aChar) cost -= 0.35;
    if (a.context?.after === bChar) cost -= 0.35;
    return cost;
  };
  const best: number[][] = [], back: number[][] = [];
  candidates.forEach((list, i) => {
    best[i] = [];
    back[i] = [];
    list.forEach(({ form, index }, c) => {
      const own = unary(i, form, index);
      if (!i || !candidates[i - 1]!.length) {
        best[i]![c] = own;
        back[i]![c] = -1;
        return;
      }
      let value = Infinity, from = 0;
      candidates[i - 1]!.forEach((previous, p) => {
        const total = best[i - 1]![p]! + pair(previous.form, letters[i - 1]!.char, form, letters[i]!.char);
        if (total < value) { value = total; from = p; }
      });
      best[i]![c] = own + value;
      back[i]![c] = from;
    });
  });
  const plan = letters.map(() => -1);
  let last = letters.length - 1;
  while (last >= 0 && !candidates[last]!.length) last--;
  if (last < 0) return plan;
  let c = best[last]!.indexOf(Math.min(...best[last]!));
  for (let i = last; i >= 0; i--) {
    if (!candidates[i]!.length) { c = -1; continue; }
    if (c < 0) c = best[i]!.indexOf(Math.min(...best[i]!));
    plan[i] = candidates[i]![c]!.index;
    c = back[i]![c]!;
  }
  return plan;
}

/** The same letter without its lead-in ligature, for the start of a word. */
export function withoutLeadIn(form: LetterForm): LetterForm {
  const first = form.strokes[0];
  if (!form.entry || !form.leadIn || !first || form.leadIn >= first.length - 1) return form;
  const strokes = [first.slice(form.leadIn), ...form.strokes.slice(1)];
  const left = Math.min(...strokes.flat().map(p => p.x));
  const shift = form.exit && form.exit.stroke === 0 && form.exit.point !== undefined
    ? { ...form.exit, point: form.exit.point - form.leadIn } : form.exit;
  const { entry: _entry, leadIn: _leadIn, ...rest } = form;
  return { ...rest, strokes, exit: shift, originX: left,
    ...(form.advance !== undefined ? { advance: Math.max(20, form.advance - left) } : {}) };
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
    ...(form.originX !== undefined ? { originX: form.originX } : {}),
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
