type TimedPoint = { time?: number };

/** Repair overlapping recorded event batches, not intentional geometric reversals. */
export function orderedStrokeSamples<T extends TimedPoint>(stroke: T[]): T[] {
  if (stroke.length < 3 || stroke.some(point => !Number.isFinite(point.time))) return stroke;
  const seen = new Set<number>();
  let latest = -Infinity;
  let overlap = false;
  for (const point of stroke) {
    const time = point.time!;
    if (time < latest && seen.has(time)) overlap = true;
    seen.add(time);
    latest = Math.max(latest, time);
  }
  // Untimed, constant-time and ordinary monotonic strokes retain every point.
  if (!overlap) return stroke;
  latest = -Infinity;
  const ordered = stroke.filter(point => {
    if (point.time! <= latest) return false;
    latest = point.time!;
    return true;
  });
  const endpoint = stroke.at(-1)!;
  if (ordered.at(-1)?.time === endpoint.time) ordered[ordered.length - 1] = endpoint;
  return ordered;
}
