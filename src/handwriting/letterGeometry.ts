type Point = { x: number; y: number };
type Glyph = {
  codePoint: number;
  points: Point[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
};

function noise(seed: number, key: string): number {
  let value = 2166136261;
  for (const char of `${seed}:${key}`) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  value ^= value >>> 16;
  value = Math.imul(value, 0x45d9f3b);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296 * 2 - 1;
}

/** A shared, smooth shape model for the font studio and the plotted document. */
export function varyLetterGlyph<T extends Glyph>(
  glyph: T,
  seed: number,
  occurrence: number,
  amount: number,
  position = "medial",
): T {
  const strength = Math.max(0, Math.min(100, Number(amount) || 0)) / 100;
  if (!strength || !/^\p{L}$/u.test(String.fromCodePoint(glyph.codePoint))) return glyph;
  const { minX, maxX, minY, maxY } = glyph.bounds;
  const width = maxX - minX, height = maxY - minY;
  if (![minX, maxX, minY, maxY].every(Number.isFinite) || width < 0 || height < 0) return glyph;
  const key = `${glyph.codePoint}:${occurrence}:${position}`;
  const coefficients = (axis: string) => {
    const curve = noise(seed, `${key}:${axis}:curve`);
    return [0.10 * noise(seed, `${key}:${axis}:balance`),
      0.20 * noise(seed, `${key}:${axis}:taper`),
      Math.sign(curve || 1) * (0.40 + 0.15 * Math.abs(curve))];
  };
  const x = coefficients("x"), y = coefficients("y");
  // The entire glyph shares one field, including all its strokes and crossings.
  // Opposite sides, upper/lower arcs and stems can change independently. No point
  // noise, new pen lifts or stroke reordering. Apply two bounded axis warps in
  // sequence, not simultaneously: each derivative along its own axis is >= .15,
  // so their composition cannot fold or invert the continuous source geometry.
  const points = glyph.points.map(point => {
    const u = width ? (point.x - minX) / width : 0.5;
    const v = height ? (point.y - minY) / height : 0.5;
    const dx = strength * u * (1 - u) * (x[0]! + x[1]! * (2 * v - 1) + x[2]! * Math.sin(2 * Math.PI * v));
    const warpedU = u + dx;
    const dy = strength * v * (1 - v) * (y[0]! + y[1]! * (2 * warpedU - 1) + y[2]! * Math.sin(2 * Math.PI * warpedU));
    return { ...point, x: point.x + width * dx, y: point.y + height * dy };
  });
  // The field maps the original bounding rectangle onto itself. Keeping these
  // layout bounds avoids shifting the text each time a different shape is chosen.
  return { ...glyph, points };
}
