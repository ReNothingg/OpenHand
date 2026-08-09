type FontPoint = { x: number; y: number };
type FontStroke = FontPoint[];

function glyphWidth(strokes: FontStroke[]) {
  const points = strokes.flat();
  if (!points.length) return { minX: 0, width: 150 };
  const xs = points.map((point) => point.x);
  const minX = Math.min(...xs);
  return { minX, width: Math.max(90, Math.max(...xs) - minX + 32) };
}

function strokePath(
  stroke: FontStroke,
  offsetX: number,
  minX: number,
  scale: number,
  baseline: number,
) {
  return stroke
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"} ${offsetX + (point.x - minX) * scale} ${baseline + point.y * scale}`,
    )
    .join(" ");
}

export default function FontPreview({
  text,
  glyphs,
  size = 32,
}: {
  text: string;
  glyphs: Record<string, FontStroke[]>;
  size?: number;
}) {
  const scale = size / 168;
  const baseline = 118;
  let cursor = 18;
  const paths: React.ReactNode[] = [];

  Array.from(text).forEach((character, characterIndex) => {
    if (/\s/u.test(character)) {
      cursor += size * 0.86;
      return;
    }
    const strokes = glyphs[character] || [];
    const metrics = glyphWidth(strokes);
    strokes.forEach((stroke, strokeIndex) => {
      paths.push(
        <path
          d={strokePath(stroke, cursor, metrics.minX, scale, baseline)}
          key={`${characterIndex}-${strokeIndex}`}
        />,
      );
    });
    cursor += metrics.width * scale;
  });

  const width = Math.max(720, cursor + 18);

  return (
    <div className="font-preview-canvas">
      <svg
        className="font-preview-svg"
        style={{ width }}
        viewBox={`0 0 ${width} 156`}
        role="img"
        aria-label="Предпросмотр шрифта"
      >
        <line x1="18" x2={width - 18} y1={baseline} y2={baseline} />
        <g>{paths}</g>
      </svg>
    </div>
  );
}
