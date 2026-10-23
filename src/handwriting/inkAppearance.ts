type Point = { x: number; y: number };
type InkStroke = Point[] & { pressure?: number };

export function penWidthMm(settings: { penWidthMm?: unknown }): number {
  const value = Number(settings.penWidthMm ?? .32);
  return Number.isFinite(value) ? Math.max(.1, Math.min(1.2, value)) : .32;
}

/** A filled ribbon gives smooth ballpoint width changes without SVG gradients
 * or extra paths per segment. It only changes appearance, never machine moves.
 * Width modulation is simulated; photographs do not measure pen pressure. */
export function inkRibbonPath(stroke: InkStroke, width: number, variation = 0, seed = 0): string {
  const points = stroke.filter((p, i) => !i || Math.hypot(p.x - stroke[i - 1]!.x, p.y - stroke[i - 1]!.y) > .0001);
  if (points.length < 2) return "";
  const strength = Math.max(0, Math.min(50, Number(variation) || 0)) / 50;
  const pressure = Math.max(.6, Math.min(1.4, Number(stroke.pressure) || 1));
  const phase = ((Math.imul(seed | 0, 0x45d9f3b) >>> 0) / 4294967296) * Math.PI * 2;
  const left: Point[] = [], right: Point[] = [], radii: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  const entry = Math.min(0.3, total * 0.3), exit = Math.min(0.42, total * 0.35);
  const ease = (t: number) => { const v = Math.max(0, Math.min(1, t)); return v * v * (3 - 2 * v); };
  const taper = (at: number) => Math.min(
    entry > 0.02 ? 0.62 + 0.38 * ease(at / entry) : 1,
    exit > 0.02 ? 0.56 + 0.44 * ease((total - at) / exit) : 1);
  let distance = 0;
  const direction = (a: Point, b: Point) => {
    const length = Math.max(.0001, Math.hypot(b.x - a.x, b.y - a.y));
    return { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  };
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    const previous = points[Math.max(0, i - 1)]!, next = points[Math.min(points.length - 1, i + 1)]!;
    const incoming = direction(i ? previous : p, i ? p : next);
    const outgoing = direction(i < points.length - 1 ? p : previous, i < points.length - 1 ? next : p);
    if (i) distance += Math.hypot(p.x - previous.x, p.y - previous.y);
    const turn = Math.max(0, 1 - incoming.x * outgoing.x - incoming.y * outgoing.y);
    const radius = width * pressure / 2 * taper(distance) * (1 + strength * (
      .10 * Math.sin(distance * 1.1 + phase) + .12 * outgoing.y + .04 * turn));
    let tx = incoming.x + outgoing.x, ty = incoming.y + outgoing.y;
    const tangentLength = Math.hypot(tx, ty);
    if (tangentLength < .001) { tx = outgoing.x; ty = outgoing.y; }
    else { tx /= tangentLength; ty /= tangentLength; }
    const miter = Math.min(1.35, 1 / Math.max(.01, tx * outgoing.x + ty * outgoing.y));
    const nx = -ty * radius * miter, ny = tx * radius * miter;
    left.push({ x: p.x + nx, y: p.y + ny });
    right.push({ x: p.x - nx, y: p.y - ny });
    radii.push(radius);
  }
  const xy = (p: Point) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  const firstRadius = radii[0]!.toFixed(3), lastRadius = radii.at(-1)!.toFixed(3);
  return `M${xy(left[0]!)}${left.slice(1).map(p => `L${xy(p)}`).join("")}` +
    `A${lastRadius} ${lastRadius} 0 0 0 ${xy(right.at(-1)!)}` +
    right.slice(0, -1).reverse().map(p => `L${xy(p)}`).join("") +
    `A${firstRadius} ${firstRadius} 0 0 0 ${xy(left[0]!)}Z`;
}

export function inkCorePath(stroke: InkStroke, minimum = 0.5): string {
  const runs: Point[][] = [];
  let run: Point[] = [];
  let length = 0;
  const flush = () => {
    if (run.length > 1 && length >= minimum) runs.push(run);
    run = [];
    length = 0;
  };
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1]!, b = stroke[i]!;
    const step = Math.hypot(b.x - a.x, b.y - a.y);
    if (step < 1e-4) continue;
    if ((b.y - a.y) / step > 0.45) {
      if (!run.length) run.push(a);
      run.push(b);
      length += step;
    } else flush();
  }
  flush();
  const xy = (p: Point) => `${p.x.toFixed(3)} ${p.y.toFixed(3)}`;
  return runs.map(points => `M${xy(points[0]!)}${points.slice(1).map(p => `L${xy(p)}`).join("")}`).join("");
}
