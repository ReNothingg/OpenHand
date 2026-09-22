import {
  nibWidth,
  DEFAULT_PEN_SETTINGS,
  type FontStroke,
  type PenSettings,
} from "./penInput";
import { chooseForm, formGlyph, type LetterForms } from "./letterForms";
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
  const paths: React.ReactNode[] = [];
  const previous = new Map<string, number>();
  let previousExit: { x: number; y: number } | null = null;

  Array.from(text).forEach((character, characterIndex) => {
    if (/\s/u.test(character)) {
      cursor += size * 0.86;
      previousExit = null;
      return;
    }
    const variants = forms[character] || [];
    const position =
      !characterIndex || /\s/.test(text[characterIndex - 1])
        ? "initial"
        : characterIndex === text.length - 1 ||
            /\s/.test(text[characterIndex + 1])
          ? "final"
          : "medial";
    const index = chooseForm(
      variants,
      31847,
      characterIndex,
      position,
      previous.get(character),
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
    const anchorPoint = (kind: "entry" | "exit") => {
      const anchor = form?.[kind],
        stroke = anchor && strokes[anchor.stroke];
      const p = stroke && (anchor.end === "start" ? stroke[0] : stroke.at(-1));
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
