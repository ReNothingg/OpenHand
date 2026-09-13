import { strokeHit, type FontPoint, type FontStroke } from './penInput';

export function erasePart(stroke: FontStroke, center: FontPoint, radius: number): FontStroke[] {
  if (!strokeHit(stroke, center, radius)) return [stroke];
  const result: FontStroke[] = [];
  for (let i = 1; i < stroke.length; i++) {
    const a = stroke[i - 1]!, b = stroke[i]!;
    const dx = b.x - a.x, dy = b.y - a.y, ox = a.x - center.x, oy = a.y - center.y;
    const A = dx * dx + dy * dy, B = 2 * (ox * dx + oy * dy), C = ox * ox + oy * oy - radius * radius;
    const discriminant = B * B - 4 * A * C;
    const cuts = [0, 1];
    if (A && discriminant >= 0) for (const sign of [-1, 1]) { const t = (-B + sign * Math.sqrt(discriminant)) / (2 * A); if (t > 0 && t < 1) cuts.push(t); }
    cuts.sort((x, y) => x - y);
    const at = (t: number): FontPoint => {
      const p: FontPoint = { x: a.x + dx * t, y: a.y + dy * t };
      for (const key of ['pressure', 'tiltX', 'tiltY', 'time'] as const) { const av = a[key], bv = b[key]; if (av !== undefined && bv !== undefined) p[key] = av + (bv - av) * t; }
      return p;
    };
    for (let j = 1; j < cuts.length; j++) {
      const from = cuts[j - 1]!, to = cuts[j]!, mid = at((from + to) / 2);
      if (Math.hypot(mid.x - center.x, mid.y - center.y) <= radius) continue;
      const start = at(from), end = at(to), previous = result.at(-1), last = previous?.at(-1);
      if (last && Math.hypot(last.x - start.x, last.y - start.y) < .00001) previous!.push(end);
      else result.push([start, end]);
    }
  }
  return result;
}
