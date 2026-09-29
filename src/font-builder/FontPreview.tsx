import {
  nibWidth,
  DEFAULT_PEN_SETTINGS,
  type FontStroke,
  type PenSettings,
} from "./penInput";
import { chooseForm, formGlyph, letterPosition, type LetterForms } from "./letterForms";
import { varyLetterGlyph } from "../handwriting/letterGeometry";
import { createCursiveConnector } from "../plotter/job";

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
  penSettings = DEFAULT_PEN_SETTINGS,
  forms = {},
  variation = 58,
}: {
  text: string;
  glyphs: Record<string, FontStroke[]>;
  size?: number;
  penSettings?: PenSettings;
  forms?: LetterForms;
  variation?: number;
}) {
  const scale = size / 168;
  const baseline = 118;
  let cursor = 18;
  let inkRight = cursor;
  let inkLeft = cursor, inkTop = baseline, inkBottom = baseline;
  const paths: React.ReactNode[] = [];
  const previous = new Map<string, number>();
  let previousExit: { x: number; y: number } | null = null;

  const characters = Array.from(text);
  characters.forEach((character, characterIndex) => {
    if (/\s/u.test(character)) {
      cursor += size * 0.86;
      previousExit = null;
      return;
    }
    const variants = forms[character] || [];
    const position = letterPosition(characters, characterIndex);
    const index = chooseForm(
      variants,
      31847,
      characterIndex,
      position,
      previous.get(character),
      100,
      { before: characters[characterIndex - 1]?.match(/^[\p{L}\p{N}]$/u)?.[0] || "",
        after: characters[characterIndex + 1]?.match(/^[\p{L}\p{N}]$/u)?.[0] || "" },
    );
    previous.set(character, index);
    const sourceStrokes = variants[index]?.strokes.length
      ? variants[index].strokes
      : glyphs[character] || [];
    const varied = varyLetterGlyph(formGlyph({ strokes: sourceStrokes }, character.codePointAt(0)!), 31847, characterIndex, variation, position);
    let offset = 0;
    const strokes = sourceStrokes.map(stroke => {
      const points = varied.points.slice(offset, offset + stroke.length);
      offset += stroke.length;
      return points;
    });
    const metrics = glyphWidth(strokes);
    const form = variants[index];
    if (form?.originX !== undefined) {
      metrics.width += metrics.minX - form.originX;
      metrics.minX = form.originX;
    }
    inkRight = Math.max(inkRight, cursor + metrics.width * scale);
    for (const stroke of strokes) for (const point of stroke) {
      inkLeft = Math.min(inkLeft, cursor + (point.x - metrics.minX) * scale);
      inkTop = Math.min(inkTop, baseline + point.y * scale);
      inkBottom = Math.max(inkBottom, baseline + point.y * scale);
    }
    const anchorPoint = (kind: "entry" | "exit") => {
      const anchor = form?.[kind],
        stroke = anchor && strokes[anchor.stroke];
      const p = stroke && (anchor.point !== undefined ? stroke[anchor.point] : anchor.end === "start" ? stroke[0] : stroke.at(-1));
      return p
        ? {
            x: cursor + (p.x - metrics.minX) * scale,
            y: baseline + p.y * scale,
          }
        : null;
    };
    const entry = anchorPoint("entry");
    if (previousExit && entry) {
      const join = createCursiveConnector(previousExit, entry, size);
      if (join)
        paths.push(
          <path
            key={`join-${characterIndex}`}
            d={join.map((p, i) => `${i ? "L" : "M"}${p.x},${p.y}`).join(" ")}
          />,
        );
    }
    previousExit = /\p{L}/u.test(character) ? anchorPoint("exit") : null;
    strokes.forEach((stroke, strokeIndex) => {
      if (stroke.some((point) => point.pressure !== undefined)) {
        stroke.slice(1).forEach((point, index) => {
          const previous = stroke[index];
          paths.push(
            <path
              key={`${characterIndex}-${strokeIndex}-${index}`}
              d={strokePath(
                [previous, point],
                cursor,
                metrics.minX,
                scale,
                baseline,
              )}
              style={{
                strokeWidth:
                  (((nibWidth(previous, penSettings) +
                    nibWidth(point, penSettings)) /
                    2) *
                    scale) /
                  1.14,
              }}
            />,
          );
        });
        return;
      }
      paths.push(
        <path
          d={strokePath(stroke, cursor, metrics.minX, scale, baseline)}
          key={`${characterIndex}-${strokeIndex}`}
        />,
      );
    });
    cursor += (form?.advance ?? metrics.width) * scale;
  });

  const width = Math.max(720, cursor + 18, inkRight + 18);
  const left = Math.min(0, inkLeft - 12), top = Math.min(0, inkTop - 12);
  const height = Math.max(156, inkBottom + 12) - top;

  return (
    <div className="font-preview-canvas" style={{ height: Math.min(260, height) }}>
      <svg
        className="font-preview-svg"
        style={{ width: width - left, height }}
        viewBox={`${left} ${top} ${width - left} ${height}`}
        role="img"
        aria-label="Предпросмотр шрифта"
      >
        <line x1="18" x2={width - 18} y1={baseline} y2={baseline} />
        <g>{paths}</g>
      </svg>
    </div>
  );
}
