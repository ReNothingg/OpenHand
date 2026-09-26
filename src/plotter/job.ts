import { coordinateFrameCommands } from "./coordinateFrame";
import { HEADING_SCALES } from "../handwriting/headings";
import { varyLetterGlyph } from "../handwriting/letterGeometry";
import { wordMotion, spaceFactor, shapeVertical, structureValue, pageEvolution } from "../handwriting/structure";
import { DEFAULT_AUTOMATIC_PEN_LIFT_MM, MAX_PEN_JOG_MM, PEN_TEST_STEP_MM, automaticPenSpeed, automaticPenUpPosition, penTravelSeconds } from "./penLift";
import { chooseForm, formGlyph, trajectoryFingerprint, mergeTrajectoryReports, type LetterForm, type JoinAnchor } from '../font-builder/letterForms';
import { layoutFormula } from "./mathLayout";
import {
  PLOTTER_ALIGN_MARKS,
  PLOTTER_PARAGRAPH_MARKS,
  PLOTTER_CALLOUT_MARKS,
  PLOTTER_CONTROL_MARKS,
  PLOTTER_FORMULA_END,
  PLOTTER_FORMULA_START,
  PLOTTER_HEADING_MARKS,
  PLOTTER_MARKS,
  PLOTTER_QUOTE_MARKS,
  PLOTTER_SVG_END,
  PLOTTER_SVG_START,
} from "./richText";

const PX_TO_MM = 25.4 / 96;
const FONT_EM = 400;

type PlotPoint = { x: number; y: number };
type PlotStroke = PlotPoint[] & { pressure?: number; feedRate?: number };

function seededRandom(seed, key) {
  let value = 2166136261;
  const source = `${seed}:${key}`;
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  value += 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

export const DEFAULT_PLOTTER_CONFIG = {
  fontId: "ifdream-original",
  profile: "grbl",
  connectionType: "serial",
  networkHost: "",
  networkPort: 0,
  baudRate: 115200,
  dataBits: 8,
  stopBits: 1,
  parity: "none",
  flowControl: "none",
  connectionTimeoutMs: 12000,
  feedRate: 1500,
  jogSpeed: 2500,
  jogDistance: 10,
  penJogStep: PEN_TEST_STEP_MM,
  penMode: "servo",
  penUp: 12000,
  penDown: 18000,
  zUp: 0,
  zDown: 2,
  maxAutomaticPenLift: DEFAULT_AUTOMATIC_PEN_LIFT_MM,
  zSpeed: 3000,
  laserPower: 1000,
  mmToSteps: 100,
  penDelay: 0.2,
  penUpDelay: 0.2,
  penDownDelay: 0.2,
  letterSpacing: 0.5,
  optimizePath: false,
  compactPaths: true,
  startPosition: "left-bottom",
  swapAxes: false,
  invertX: false,
  invertY: false,
  autoSetOrigin: false,
  returnToOrigin: false,
  customStartGcode: "",
  customEndGcode: "",
};

export function pageSettingsToMillimeters(
  settings,
  metrics,
  evenPage = false,
  spreadSide = null,
) {
  const pageMargin = evenPage ? settings.marginLeftEven : settings.marginLeft;
  const leftPixels =
    spreadSide === "right" ? metrics.width / 2 + pageMargin : pageMargin;
  return {
    pageWidth: metrics.width * PX_TO_MM,
    pageHeight: metrics.height * PX_TO_MM,
    left: leftPixels * PX_TO_MM,
    top: settings.marginTop * PX_TO_MM,
    right: (metrics.width - leftPixels - metrics.contentWidth) * PX_TO_MM,
    bottom: settings.marginBottom * PX_TO_MM,
    fontSize: settings.fontSize * PX_TO_MM,
    lineHeight: settings.fontSize * settings.lineHeight * PX_TO_MM,
  };
}

function splitGlyphStrokes(
  glyph,
  cursorX,
  baseline,
  scale,
  handwriting = null,
): PlotStroke[] {
  const strokes: PlotStroke[] = [];
  let stroke: PlotStroke | null = null;
  const variation = handwriting?.enabled
    ? Math.max(0, Math.min(100, Number(handwriting.variation) || 0))
    : 0;
  const rhythm = handwriting?.enabled
    ? Math.max(0, Math.min(100, Number(handwriting.rhythm) || 0))
    : 0;
  const fatigueProgress = Math.max(
    0,
    Math.min(1, Number(handwriting?.progress) || 0),
  );
  const evolution = pageEvolution(fatigueProgress, Boolean(handwriting?.enabled && handwriting?.fatigueEnabled), handwriting?.fatigueStrength);
  const fatigue = evolution.amount;
  const authorSlant = Math.max(
    -18,
    Math.min(22, Number(handwriting?.authorSlant) || 0),
  );
  const randomSlant =
    (seededRandom(handwriting?.seed, `${handwriting?.key}:slant`) - 0.5) *
    (variation * 0.0017 + rhythm * 0.0008);
  const slant =
    Math.tan(((authorSlant + fatigue * 3.2) * Math.PI) / 180) + randomSlant;
  const authorWidth = Math.max(
    0.78,
    Math.min(1.22, Number(handwriting?.authorWidth || 100) / 100),
  );
  const motion = handwriting?.motion || { coherence: 0, width: 1, height: 1, slant: 0, baseline: 0 };
  const scaleX =
    motion.width * authorWidth * evolution.width *
    (1 + (seededRandom(handwriting?.seed, `${handwriting?.key}:width`) - 0.5) * variation * 0.0012);
  const scaleY =
    1 +
    (seededRandom(handwriting?.seed, `${handwriting?.key}:height`) - 0.5) *
      variation * (1 - motion.coherence * 0.85) *
      0.0022;
  const pressure =
    1 +
    (seededRandom(handwriting?.seed, `${handwriting?.key}:pressure`) - 0.5) *
      Number(handwriting?.pressure || 0) *
      0.012 -
    fatigue * 0.035;
  const baselineDrift =
    fatigue *
    Math.max(0, Math.min(100, Number(handwriting?.authorBaseline) || 0)) *
    scale *
    0.75;
  const rhythmDrift =
    (seededRandom(handwriting?.seed, `${handwriting?.key}:rhythm-y`) - 0.5) *
    rhythm *
    scale *
    0.22;
  for (let index = 0; index < glyph.points.length; index += 1) {
    const source = glyph.points[index];
    const shapedY = handwriting?.isLetter ? shapeVertical(source.y, handwriting.bodyTop, handwriting.structure) : source.y;
    const localY = shapedY * scale * scaleY * motion.height;
    const localX =
      (source.x - glyph.bounds.minX) * scale * scaleX - localY * (slant - randomSlant * motion.coherence * 0.85 + Math.tan(motion.slant * Math.PI / 180));
    const point = {
      x: cursorX + localX,
      y: baseline + localY + baselineDrift + rhythmDrift * (1 - motion.coherence * 0.85) + motion.baseline * scale * FONT_EM,
    };
    if (glyph.flags[index] === 0 || !stroke) {
      stroke = [point];
      stroke.pressure = pressure;
      strokes.push(stroke);
    } else {
      stroke.push(point);
    }
  }
  return strokes.filter((item) => item.length > 1);
}

const LETTER_PATTERN = /^\p{L}$/u;

function glyphStrokeBounds(strokes) {
  const points = strokes.flat();
  if (!points.length) return null;
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  };
}

export function findCursiveAnchor(strokes, side, baseline, fontSize) {
  const bounds = glyphStrokeBounds(strokes);
  if (!bounds) return null;

  const endpoints = strokes.flatMap((stroke, strokeIndex) => {
    if (stroke.length < 2) return [];
    return [
      { point: stroke[0], neighbor: stroke[1], strokeIndex, atStart: true },
      {
        point: stroke.at(-1),
        neighbor: stroke.at(-2),
        strokeIndex,
        atStart: false,
      },
    ];
  });
  if (!endpoints.length) return null;

  const width = Math.max(fontSize * 0.12, bounds.maxX - bounds.minX);
  const edgeX = side === "entry" ? bounds.minX : bounds.maxX;
  const maximumInset = Math.max(fontSize * 0.055, width * 0.18);
  const targetY = baseline + fontSize * 0.015;
  const candidates = endpoints
    .map((candidate) => {
      const edgeInset = Math.abs(candidate.point.x - edgeX);
      const baselineDistance = Math.abs(candidate.point.y - targetY);
      const tangentX =
        side === "entry"
          ? candidate.neighbor.x - candidate.point.x
          : candidate.point.x - candidate.neighbor.x;
      const tangentY =
        side === "entry"
          ? candidate.neighbor.y - candidate.point.y
          : candidate.point.y - candidate.neighbor.y;
      const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY));
      const outwardness = tangentX / tangentLength;
      const verticality = Math.abs(tangentY) / tangentLength;
      const directionPenalty =
        Math.max(0, 0.22 - outwardness) * fontSize * 0.52;
      return {
        ...candidate,
        edgeInset,
        baselineDistance,
        outwardness,
        verticality,
        score:
          edgeInset * 4.8 +
          baselineDistance * 0.78 +
          directionPenalty +
          verticality * fontSize * 0.07,
      };
    })
    .filter(
      (candidate) =>
        candidate.edgeInset <= maximumInset &&
        candidate.baselineDistance <= fontSize * 0.4 &&
        candidate.outwardness >= -0.18,
    )
    .sort((left, right) => left.score - right.score);

  let anchor = candidates[0];
  if (!anchor) {
    const fallbackInset = Math.max(fontSize * 0.018, width * 0.045);
    anchor = strokes
      .flatMap((stroke, strokeIndex) =>
        stroke.map((point, pointIndex) => ({
          point,
          strokeIndex,
          pointIndex,
          edgeInset: Math.abs(point.x - edgeX),
          baselineDistance: Math.abs(point.y - targetY),
        })),
      )
      .filter(
        (candidate) =>
          candidate.edgeInset <= fallbackInset &&
          candidate.baselineDistance <= fontSize * 0.36,
      )
      .sort(
        (left, right) =>
          left.edgeInset * 5.5 +
          left.baselineDistance -
          (right.edgeInset * 5.5 + right.baselineDistance),
      )[0];
    if (!anchor) return null;
    return {
      ...anchor,
      outwardness: 0,
      verticality: 1,
      synthetic: true,
      quality: Math.max(
        0.24,
        0.68 -
          ((anchor.edgeInset / fallbackInset) * 0.22 +
            (anchor.baselineDistance / (fontSize * 0.36)) * 0.3),
      ),
    };
  }
  return {
    ...anchor,
    quality: Math.max(
      0,
      1 -
        ((anchor.edgeInset / maximumInset) * 0.5 +
          (anchor.baselineDistance / (fontSize * 0.4)) * 0.32 +
          Math.max(0, 0.22 - anchor.outwardness) * 0.18),
    ),
  };
}

export function createCursiveConnector(start, end, fontSize, strength = 100) {
  if (!start || !end) return null;
  const gap = end.x - start.x;
  const verticalDistance = Math.abs(end.y - start.y);
  if (
    gap < fontSize * 0.018 ||
    gap > fontSize * 0.48 ||
    verticalDistance > fontSize * 0.3
  )
    return null;

  const normalizedStrength =
    Math.max(0, Math.min(100, Number(strength) || 0)) / 100;
  const handle = Math.min(gap * 0.32, fontSize * 0.11);
  const bow = Math.min(
    gap * 0.09,
    fontSize * (0.008 + normalizedStrength * 0.018),
  );
  const control1 = { x: start.x + handle, y: start.y + bow };
  const control2 = { x: end.x - handle, y: end.y + bow };
  const followTangent = (point, sign, fallback) => {
    const t = point.tangent;
    if (!t || t.x <= 0) return fallback;
    const length = Math.hypot(t.x, t.y);
    return length ? { x: point.x + sign * handle * t.x / length, y: point.y + sign * handle * t.y / length } : fallback;
  };
  Object.assign(control1, followTangent(start, 1, control1));
  Object.assign(control2, followTangent(end, -1, control2));
  const connector: PlotStroke = [];
  const steps = Math.max(5, Math.ceil(gap / Math.max(fontSize * 0.055, 0.15)));

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    const inverse = 1 - t;
    connector.push({
      x:
        inverse ** 3 * start.x +
        3 * inverse ** 2 * t * control1.x +
        3 * inverse * t ** 2 * control2.x +
        t ** 3 * end.x,
      y:
        inverse ** 3 * start.y +
        3 * inverse ** 2 * t * control1.y +
        3 * inverse * t ** 2 * control2.y +
        t ** 3 * end.y,
    });
  }
  connector.pressure = 0.82 + normalizedStrength * 0.08;
  return connector;
}

export async function layoutText(
  text: string,
  font: any,
  page: any,
  config: any,
) {
  const scale = page.fontSize / FONT_EM;
  const spaceWidth = page.fontSize * 0.46;
  const letterSpacing = Number(config.letterSpacing || 0);
  const glyphs = new Map<string, any>();
  const forms = new Map<string, LetterForm[]>();
  const formGlyphs = new Map<string, ReturnType<typeof formGlyph>[]>();
  const maximumWidths = new Map<string, number>();
  const previousForms = new Map<string, number>();
  const repetition = new Map<string, { character: string; count: number; shapes: Set<string> }>();
  const missing = new Set<string>();

  const formulaPattern = new RegExp(
    `${PLOTTER_FORMULA_START}([\\s\\S]*?)${PLOTTER_FORMULA_END}`,
    "g",
  );
  const formulaSources = [...text.matchAll(formulaPattern)].map(
    (match) => match[1],
  );
  const svgPattern = new RegExp(
    `${PLOTTER_SVG_START}([\\s\\S]*?)${PLOTTER_SVG_END}`,
    "g",
  );
  const svgSources = [...text.matchAll(svgPattern)].map((match) => match[1]);
  const plainText = text.replace(formulaPattern, "").replace(svgPattern, "");
  const plainCharacterCount = Math.max(
    1,
    Array.from(plainText).filter(
      (char) => !/\s/u.test(char) && !PLOTTER_CONTROL_MARKS.has(char),
    ).length,
  );

  const getGlyph = async (char, recordMissing = true) => {
    if (glyphs.has(char)) return glyphs.get(char);
    const glyph = await font.getGlyph(char.codePointAt(0));
    if (glyph) {
      glyphs.set(char, glyph);
      if (font.getForms) {
        const variants = await font.getForms(char.codePointAt(0));
        forms.set(char, variants);
        const prepared = variants.map(form => formGlyph(form, char.codePointAt(0)));
        formGlyphs.set(char, prepared);
        maximumWidths.set(char, Math.max(glyph.bounds.maxX - glyph.bounds.minX, ...prepared.map(g => g.bounds.maxX - g.bounds.minX)));
      }
    }
    else if (recordMissing) missing.add(char);
    return glyph || null;
  };

  for (const char of new Set(Array.from(plainText))) {
    if (/\s/u.test(char) || PLOTTER_CONTROL_MARKS.has(char)) continue;
    await getGlyph(char);
  }

  const bodyHeights = [];
  for (const char of "аеиносуэх") {
    const glyph = await getGlyph(char, false);
    if (glyph?.bounds.minY < 0) bodyHeights.push(-glyph.bounds.minY);
  }
  bodyHeights.sort((a, b) => a - b);
  const bodyTop = -(bodyHeights[Math.floor(bodyHeights.length / 2)] || FONT_EM * 0.55);
  const capHeights = [];
  for (const char of "НПАHNA") {
    const glyph = await getGlyph(char, false);
    const height = glyph ? glyph.bounds.maxY - glyph.bounds.minY : 0;
    if (height > 0) capHeights.push(height);
  }
  capHeights.sort((a, b) => a - b);
  const headingReferenceHeight = capHeights[Math.floor(capHeights.length / 2)] || FONT_EM * 0.7;

  const formulaLayouts = new Map<string, any>();
  for (const source of formulaSources) {
    if (formulaLayouts.has(source)) continue;
    const layout = await layoutFormula(source, {
      fontSize: page.fontSize,
      letterSpacing,
      getGlyph: (char) => getGlyph(char, false),
      handwriting: {
        enabled: Boolean(config.trueHandwriting),
        variation: config.glyphVariation,
        pressure: config.pressureVariation,
        seed: config.seed,
        authorSlant: config.authorSlant,
        authorWidth: config.authorWidth,
        rhythm: config.authorRhythm,
      },
    });
    layout.missing.forEach((char) => missing.add(char));
    formulaLayouts.set(source, layout);
  }
  const svgDrawings = new Map<string, any>();
  svgSources.forEach((source) => {
    if (svgDrawings.has(source)) return;
    try {
      const drawing = JSON.parse(decodeURIComponent(source));
      if (
        drawing?.width > 0 &&
        drawing?.height > 0 &&
        Array.isArray(drawing.strokes)
      ) {
        svgDrawings.set(source, drawing);
      }
    } catch {
      // Повреждённый встроенный SVG просто не попадёт в траекторию.
    }
  });
  for (const drawing of svgDrawings.values()) {
    for (const label of drawing.texts || []) {
      for (const char of new Set(Array.from(String(label.value)))) {
        if (!/\s/u.test(char) && !PLOTTER_CONTROL_MARKS.has(char))
          await getGlyph(char);
      }
    }
  }

  const advanceFor = (char, textScale = 1, motionWidth = 1) => {
    if (char === " " || char === "\t")
      return spaceWidth * (char === "\t" ? 4 : 1) * textScale * spaceFactor(config, "base");
    const glyph = glyphs.get(char);
    const widthScale = Math.max(
      0.78,
      Math.min(1.22, Number(config.authorWidth || 100) / 100),
    );
    return glyph
      ? Math.max(
          (maximumWidths.get(char) ?? glyph.bounds.maxX - glyph.bounds.minX) *
            scale *
            widthScale * motionWidth *
            textScale +
            letterSpacing,
          page.fontSize * 0.24 * textScale,
        )
      : spaceWidth * textScale;
  };

  const strokes: PlotStroke[] = [];
  const activeDecorations = new Set<string>();
  const decorationStarts = new Map<string, number>();
  const activeTextStyles = new Set<string>();
  let x = page.left;
  let baseline = page.top + page.fontSize;
  let lineStrokeStart = 0;
  let lineFormulaDescent = 0;
  const formulaLineGap = Math.max(0.2, page.lineHeight - page.fontSize);
  let previousLineBottom = page.top - formulaLineGap;
  const maxX = page.pageWidth - Math.max(0, page.right);
  const maxY = page.pageHeight - page.bottom;
  let clipped = false;
  let overflowText = "";
  let activeCallout = null;
  let activeQuote = null;
  let activeHeadingLevel = 0;
  let pendingHeadingGap = 0;
  let glyphOccurrence = 0;
  const quoteIndent = page.fontSize * 0.58;
  const headingScales = HEADING_SCALES;
  let headingInkScale = 1;
  let headingInkAscent = FONT_EM;
  const scaleForHeading = (level) => (headingScales[level] || 1) * (level ? headingInkScale : 1);
  const headingScale = () => scaleForHeading(activeHeadingLevel);

  const markCalloutContent = () => {
    if (!activeCallout) return;
    activeCallout.lastBaseline = baseline;
    activeCallout.maxX = Math.max(activeCallout.maxX, x);
  };

  const closeCallout = () => {
    if (!activeCallout) return;
    const left = Math.max(0, page.left - 1.5);
    const right = Math.min(
      maxX,
      Math.max(activeCallout.maxX + 1.8, page.left + page.fontSize * 3),
    );
    const top = Math.max(0, activeCallout.top);
    const bottom = Math.min(
      maxY,
      activeCallout.lastBaseline + page.fontSize * 0.3,
    );
    if (bottom > top && right > left) {
      strokes.push(
        [
          { x: left, y: top },
          { x: right, y: top },
        ],
        [
          { x: right, y: top },
          { x: right, y: bottom },
        ],
        [
          { x: right, y: bottom },
          { x: left, y: bottom },
        ],
        [
          { x: left, y: bottom },
          { x: left, y: top },
        ],
      );
    }
    activeCallout = null;
  };

  const markQuoteContent = () => {
    if (!activeQuote) return;
    activeQuote.lastBaseline = baseline;
  };

  const closeQuote = () => {
    if (!activeQuote) return;
    const railX = page.left + page.fontSize * 0.09;
    const top = activeQuote.top;
    const bottom = Math.min(
      maxY,
      activeQuote.lastBaseline + page.fontSize * 0.16,
    );
    const middle = (top + bottom) / 2;
    const quoteX = railX + page.fontSize * 0.15;
    const quoteY = top + page.fontSize * 0.16;
    strokes.push(
      [
        { x: railX, y: top },
        { x: railX - page.fontSize * 0.025, y: middle },
        { x: railX + page.fontSize * 0.018, y: bottom },
      ],
      [
        { x: quoteX, y: quoteY },
        { x: quoteX - page.fontSize * 0.035, y: quoteY + page.fontSize * 0.13 },
        { x: quoteX + page.fontSize * 0.025, y: quoteY + page.fontSize * 0.19 },
      ],
      [
        { x: quoteX + page.fontSize * 0.16, y: quoteY },
        { x: quoteX + page.fontSize * 0.125, y: quoteY + page.fontSize * 0.13 },
        { x: quoteX + page.fontSize * 0.185, y: quoteY + page.fontSize * 0.19 },
      ],
    );
    activeQuote = null;
  };

  const decorationStroke = (style, startX, endX) => {
    if (endX - startX < 0.15) return;
    if (style === "strike") {
      strokes.push([
        { x: startX, y: baseline - page.fontSize * 0.34 },
        { x: endX, y: baseline - page.fontSize * 0.34 },
      ]);
      return;
    }
    if (style === "double") {
      strokes.push(
        [
          { x: startX, y: baseline + page.fontSize * 0.1 },
          { x: endX, y: baseline + page.fontSize * 0.1 },
        ],
        [
          { x: startX, y: baseline + page.fontSize * 0.19 },
          { x: endX, y: baseline + page.fontSize * 0.19 },
        ],
      );
      return;
    }
    if (style === "wavy") {
      const width = endX - startX;
      const steps = Math.max(
        4,
        Math.ceil(width / Math.max(0.7, page.fontSize * 0.16)),
      );
      const y = baseline + page.fontSize * 0.14;
      const amplitude = Math.max(0.28, page.fontSize * 0.055);
      strokes.push(
        Array.from({ length: steps + 1 }, (_, index) => ({
          x: startX + (width * index) / steps,
          y: y + Math.sin((index * Math.PI) / 2) * amplitude,
        })),
      );
      return;
    }
    if (style === "code") {
      const inset = page.fontSize * 0.08;
      const top = baseline - page.fontSize * 0.82;
      const bottom = baseline + page.fontSize * 0.16;
      strokes.push([
        { x: startX - inset, y: bottom },
        { x: startX - inset, y: top },
        { x: endX + inset, y: top },
        { x: endX + inset, y: bottom },
      ]);
      return;
    }
    if (style === "highlight") {
      const top = baseline - page.fontSize * 0.76;
      const bottom = baseline + page.fontSize * 0.13;
      strokes.push(
        [
          { x: startX, y: top },
          { x: endX, y: top },
        ],
        [
          { x: startX, y: bottom },
          { x: endX, y: bottom },
        ],
      );
      return;
    }
    strokes.push([
      { x: startX, y: baseline + page.fontSize * 0.14 },
      { x: endX, y: baseline + page.fontSize * 0.14 },
    ]);
  };

  const applyTextStyles = (sourceStrokes, originBaseline = baseline) => {
    const italic = activeTextStyles.has("italic");
    const bold = activeTextStyles.has("bold");
    const primary = sourceStrokes.map((stroke) => {
      const styled = stroke.map((point) => ({
        x: point.x + (italic ? (originBaseline - point.y) * 0.29 : 0),
        y: point.y,
      }));
      styled.pressure = (stroke.pressure || 1) * (bold ? 1.18 : 1);
      return styled;
    });
    if (!bold) return primary;

    const offset = Math.max(0.09, Math.min(0.18, page.fontSize * 0.024));
    const reinforcement = primary.map((stroke) => {
      const reinforced = stroke.map((point) => ({
        x: point.x + offset,
        y: point.y + offset * 0.12,
      }));
      reinforced.pressure = (stroke.pressure || 1) * 1.08;
      return reinforced;
    });
    return [...primary, ...reinforcement];
  };

  const closeLineDecorations = () => {
    activeDecorations.forEach((style) =>
      decorationStroke(style, decorationStarts.get(style) ?? page.left, x),
    );
  };

  const nextLine = () => {
    closeLineDecorations();
    for (let i = lineStrokeStart; i < strokes.length; i++)
      for (const point of strokes[i]) previousLineBottom = Math.max(previousLineBottom, point.y);
    x = page.left + (activeQuote ? quoteIndent : 0);
    baseline += page.lineHeight + pendingHeadingGap + lineFormulaDescent;
    lineFormulaDescent = 0;
    lineStrokeStart = strokes.length;
    pendingHeadingGap = 0;
    activeDecorations.forEach((style) => decorationStarts.set(style, x));
    if (baseline > maxY) clipped = true;
  };

  const startMarks = new Map<string, string>([
    [PLOTTER_MARKS.underlineStart, "underline"],
    [PLOTTER_MARKS.doubleStart, "double"],
    [PLOTTER_MARKS.wavyStart, "wavy"],
    [PLOTTER_MARKS.strikeStart, "strike"],
    [PLOTTER_MARKS.codeStart, "code"],
    [PLOTTER_MARKS.highlightStart, "highlight"],
  ]);
  const endMarks = new Map<string, string>([
    [PLOTTER_MARKS.underlineEnd, "underline"],
    [PLOTTER_MARKS.doubleEnd, "double"],
    [PLOTTER_MARKS.wavyEnd, "wavy"],
    [PLOTTER_MARKS.strikeEnd, "strike"],
    [PLOTTER_MARKS.codeEnd, "code"],
    [PLOTTER_MARKS.highlightEnd, "highlight"],
  ]);
  const textStyleStarts = new Map<string, string>([
    [PLOTTER_MARKS.boldStart, "bold"],
    [PLOTTER_MARKS.italicStart, "italic"],
  ]);
  const textStyleEnds = new Map<string, string>([
    [PLOTTER_MARKS.boldEnd, "bold"],
    [PLOTTER_MARKS.italicEnd, "italic"],
  ]);
  const headingStarts = new Map<string, number>([
    [PLOTTER_HEADING_MARKS.h1Start, 1],
    [PLOTTER_HEADING_MARKS.h2Start, 2],
    [PLOTTER_HEADING_MARKS.h3Start, 3],
    [PLOTTER_HEADING_MARKS.h4Start, 4],
    [PLOTTER_HEADING_MARKS.h5Start, 5],
    [PLOTTER_HEADING_MARKS.h6Start, 6],
  ]);
  const headingEnds = new Map<string, number>([
    [PLOTTER_HEADING_MARKS.h1End, 1],
    [PLOTTER_HEADING_MARKS.h2End, 2],
    [PLOTTER_HEADING_MARKS.h3End, 3],
    [PLOTTER_HEADING_MARKS.h4End, 4],
    [PLOTTER_HEADING_MARKS.h5End, 5],
    [PLOTTER_HEADING_MARKS.h6End, 6],
  ]);
  const alignmentStarts = new Map<string, string>([
    [PLOTTER_ALIGN_MARKS.leftStart, "left"],
    [PLOTTER_ALIGN_MARKS.centerStart, "center"],
    [PLOTTER_ALIGN_MARKS.rightStart, "right"],
  ]);
  const alignmentEnds = new Set<string>([
    PLOTTER_ALIGN_MARKS.leftEnd,
    PLOTTER_ALIGN_MARKS.centerEnd,
    PLOTTER_ALIGN_MARKS.rightEnd,
  ]);
  const widthForLine = (line) => {
    let measuredHeadingLevel = activeHeadingLevel;
    return line
      .split(
        new RegExp(
          `(${PLOTTER_FORMULA_START}.*?${PLOTTER_FORMULA_END}|${PLOTTER_SVG_START}.*?${PLOTTER_SVG_END})`,
          "u",
        ),
      )
      .filter(Boolean)
      .reduce((width, token) => {
        const measuredScale = scaleForHeading(measuredHeadingLevel);
        if (
          token.startsWith(PLOTTER_FORMULA_START) &&
          token.endsWith(PLOTTER_FORMULA_END)
        ) {
          const source = token.slice(
            PLOTTER_FORMULA_START.length,
            -PLOTTER_FORMULA_END.length,
          );
          return (
            width + (formulaLayouts.get(source)?.width || 0) * measuredScale
          );
        }
        if (
          token.startsWith(PLOTTER_SVG_START) &&
          token.endsWith(PLOTTER_SVG_END)
        ) {
          return width + (maxX - page.left) * 0.84;
        }
        return (
          width +
          String(token).split(/(\s+)/u).reduce((subtotal, part, index, parts) => {
            if (/^\s+$/u.test(part)) return subtotal + Array.from(part).reduce((sum, char) => sum + spaceWidth * (char === "\t" ? 4 : 1) * scaleForHeading(measuredHeadingLevel) * spaceFactor(config, parts[index - 1] || ""), 0);
            const visible = Array.from(part).filter((char) => !PLOTTER_CONTROL_MARKS.has(char));
            let position = 0;
            return subtotal + Array.from(part).reduce((total, char) => {
              if (headingStarts.has(char)) { measuredHeadingLevel = headingStarts.get(char); return total; }
              if (headingEnds.has(char)) { measuredHeadingLevel = 0; return total; }
              if (PLOTTER_CONTROL_MARKS.has(char)) return total;
              return total + advanceFor(char, scaleForHeading(measuredHeadingLevel), wordMotion(config, part, position++, visible.length).width);
            }, 0);
          }, 0)
        );
      }, 0);
  };
  let activeAlignment = "left";

  const rawLines = text.replace(/\r/g, "").split("\n");
  for (
    let rawLineIndex = 0;
    rawLineIndex < rawLines.length;
    rawLineIndex += 1
  ) {
    const rawLine = rawLines[rawLineIndex];
    if (Array.from(rawLine).some(char => headingStarts.has(char))) {
      let inkHeight = 0, inkAscent = 0;
      for (const char of rawLine) {
        const glyph = glyphs.get(char);
        if (!glyph) continue;
        inkHeight = Math.max(inkHeight, glyph.bounds.maxY - glyph.bounds.minY);
        inkAscent = Math.max(inkAscent, -glyph.bounds.minY);
      }
      headingInkScale = inkHeight && !rawLine.includes(PLOTTER_FORMULA_START)
        ? Math.max(1, Math.min(2.5, headingReferenceHeight / inkHeight)) : 1;
      headingInkAscent = inkAscent || FONT_EM;
    }
    Array.from(rawLine).forEach((char) => {
      if (alignmentStarts.has(char))
        activeAlignment = alignmentStarts.get(char);
    });
    const endsAlignment = Array.from(rawLine).some((char) =>
      alignmentEnds.has(char),
    );
    const line = Array.from(rawLine)
      .filter((char) => !alignmentStarts.has(char) && !alignmentEnds.has(char))
      .join("");
    const lineWidth = widthForLine(line);
    if (activeAlignment === "center" && lineWidth < maxX - page.left) {
      x = page.left + (maxX - page.left - lineWidth) / 2;
    } else if (activeAlignment === "right" && lineWidth < maxX - page.left) {
      x = maxX - lineWidth;
    } else {
      x = page.left;
    }
    if (activeQuote) x += quoteIndent;
    activeDecorations.forEach((style) => decorationStarts.set(style, x));
    const tokens = line
      .split(
        new RegExp(
          `(${PLOTTER_FORMULA_START}.*?${PLOTTER_FORMULA_END}|${PLOTTER_SVG_START}.*?${PLOTTER_SVG_END}|\\s+)`,
          "u",
        ),
      )
      .filter(Boolean);
    const preserveOverflow = (tokenIndex, charIndex = 0) => {
      if (overflowText) return;
      const tokenChars = Array.from(tokens[tokenIndex] || "");
      const currentLine = [
        tokenChars.slice(charIndex).join(""),
        ...tokens.slice(tokenIndex + 1),
      ].join("");
      overflowText = [currentLine, ...rawLines.slice(rawLineIndex + 1)].join(
        "\n",
      );
    };
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex];
      if (clipped) break;
      if (
        token.startsWith(PLOTTER_FORMULA_START) &&
        token.endsWith(PLOTTER_FORMULA_END)
      ) {
        const source = token.slice(
          PLOTTER_FORMULA_START.length,
          -PLOTTER_FORMULA_END.length,
        );
        const formula = formulaLayouts.get(source);
        if (!formula) continue;
        if (x > page.left && x + formula.width * headingScale() > maxX) {
          nextLine();
          if (clipped) {
            preserveOverflow(tokenIndex);
            break;
          }
        }
        const formulaAscent = formula.ascent * headingScale();
        const formulaDescent = formula.descent * headingScale();
        const formulaBaseline = Math.max(baseline, page.top + formulaAscent,
          previousLineBottom + formulaLineGap + formulaAscent);
        if (formulaBaseline + formulaDescent > maxY) {
          clipped = true;
          preserveOverflow(tokenIndex);
          break;
        }
        // Fractions and roots can be taller than an ordinary text line. Move
        // the already drawn inline prefix with its baseline, and reserve the
        // denominator's depth before placing the next line.
        const baselineShift = formulaBaseline - baseline;
        if (baselineShift > 0) {
          for (let i = lineStrokeStart; i < strokes.length; i++)
            for (const point of strokes[i]) point.y += baselineShift;
          baseline = formulaBaseline;
        }
        lineFormulaDescent = Math.max(lineFormulaDescent, formulaDescent);
        const formulaStrokes = formula.strokes.map((stroke) => {
          const currentScale = headingScale();
          const placed = stroke.map((point) => ({
            x: x + point.x * currentScale,
            y: baseline + point.y * currentScale,
          }));
          if (stroke.pressure) placed.pressure = stroke.pressure;
          return placed;
        });
        strokes.push(...applyTextStyles(formulaStrokes));
        x += formula.width * headingScale();
        markCalloutContent();
        continue;
      }
      if (
        token.startsWith(PLOTTER_SVG_START) &&
        token.endsWith(PLOTTER_SVG_END)
      ) {
        const source = token.slice(
          PLOTTER_SVG_START.length,
          -PLOTTER_SVG_END.length,
        );
        const drawing = svgDrawings.get(source);
        if (!drawing) continue;
        if (x > page.left) nextLine();
        const top = baseline - page.fontSize * 0.78;
        const availableHeight =
          drawing.kind === "table"
            ? maxY - top - page.lineHeight
            : Math.min(70, maxY - top - page.lineHeight);
        const availableWidth = (maxX - page.left) * 0.86;
        const preferredScale =
          drawing.kind === "table" ? (page.fontSize * 0.8) / 22 : Infinity;
        const drawingScale = Math.min(
          availableWidth / drawing.width,
          availableHeight / drawing.height,
          preferredScale,
        );
        if (!Number.isFinite(drawingScale) || drawingScale <= 0) {
          clipped = true;
          break;
        }
        const drawingWidth = drawing.width * drawingScale;
        const drawingHeight = drawing.height * drawingScale;
        const drawingX = page.left + (maxX - page.left - drawingWidth) / 2;
        strokes.push(
          ...drawing.strokes.map((stroke) =>
            stroke.map((point) => ({
              x: drawingX + point.x * drawingScale,
              y: top + point.y * drawingScale,
            })),
          ),
        );
        for (const label of drawing.texts || []) {
          const labelScale = (label.size * drawingScale) / FONT_EM;
          const labelSpace = label.size * drawingScale * 0.46;
          const labelAdvances = Array.from(String(label.value)).map((char) => {
            if (/\s/u.test(char)) return labelSpace;
            const glyph = glyphs.get(char);
            return glyph
              ? Math.max(
                  (glyph.bounds.maxX - glyph.bounds.minX) * labelScale +
                    letterSpacing,
                  label.size * drawingScale * 0.24,
                )
              : labelSpace;
          });
          const labelWidth = labelAdvances.reduce(
            (total, advance) => total + advance,
            0,
          );
          let labelCursor =
            label.anchor === "middle"
              ? -labelWidth / 2
              : label.anchor === "end"
                ? -labelWidth
                : 0;
          const originX = drawingX + label.x * drawingScale;
          const originY = top + label.y * drawingScale;
          const cosine = Math.cos(label.angle);
          const sine = Math.sin(label.angle);
          Array.from(String(label.value)).forEach((char, index) => {
            const glyph = glyphs.get(char);
            if (glyph) {
              strokes.push(
                ...glyph.flags
                  .reduce((glyphStrokes, flag, pointIndex) => {
                    const sourcePoint = glyph.points[pointIndex];
                    const localX =
                      labelCursor +
                      (sourcePoint.x - glyph.bounds.minX) * labelScale;
                    const localY = sourcePoint.y * labelScale;
                    const point = {
                      x: originX + localX * cosine - localY * sine,
                      y: originY + localX * sine + localY * cosine,
                    };
                    if (flag === 0 || !glyphStrokes.length)
                      glyphStrokes.push([point]);
                    else glyphStrokes[glyphStrokes.length - 1].push(point);
                    return glyphStrokes;
                  }, [])
                  .filter((stroke) => stroke.length > 1),
              );
            }
            labelCursor += labelAdvances[index];
          });
        }
        x = drawingX + drawingWidth;
        baseline = top + drawingHeight;
        markCalloutContent();
        continue;
      }
      if (/^\s+$/u.test(token)) {
        for (const char of token) {
          if (char === "\n") nextLine();
          else x += spaceWidth * (char === "\t" ? 4 : 1) * headingScale() * spaceFactor(config, tokens[tokenIndex - 1] || "");
        }
        continue;
      }
      const visibleChars = Array.from(token).filter((char) => !PLOTTER_CONTROL_MARKS.has(char));
      const tokenWidth = widthForLine(token);
      if (x > page.left && x + tokenWidth > maxX) {
        nextLine();
        if (clipped) {
          preserveOverflow(tokenIndex);
          break;
        }
      }
      const tokenChars = Array.from(token);
      const tokenStartX = x;
      let previousJoin = null;
      let visibleIndex = 0;
      for (let charIndex = 0; charIndex < tokenChars.length; charIndex += 1) {
        const char = tokenChars[charIndex];
        if (char === PLOTTER_PARAGRAPH_MARKS.start) {
          if (activeAlignment === "left") x += Math.min((maxX - page.left) * 0.4, page.fontSize * structureValue(config, "paragraphIndent") / 100);
          continue;
        }
        if (char === PLOTTER_PARAGRAPH_MARKS.end) {
          pendingHeadingGap += page.lineHeight * structureValue(config, "paragraphGap") / 100;
          continue;
        }
        if (char === PLOTTER_CALLOUT_MARKS.start) {
          closeCallout();
          activeCallout = {
            top: baseline - page.fontSize * 0.82,
            lastBaseline: baseline,
            maxX: page.left,
          };
          continue;
        }
        if (char === PLOTTER_CALLOUT_MARKS.end) {
          closeCallout();
          continue;
        }
        if (char === PLOTTER_QUOTE_MARKS.start) {
          closeQuote();
          activeQuote = {
            top: baseline - page.fontSize * 0.79,
            lastBaseline: baseline,
          };
          x += quoteIndent;
          continue;
        }
        if (char === PLOTTER_QUOTE_MARKS.end) {
          closeQuote();
          continue;
        }
        if (headingStarts.has(char)) {
          activeHeadingLevel = headingStarts.get(char);
          baseline = Math.max(baseline, previousLineBottom + formulaLineGap + page.fontSize * headingScale() * headingInkAscent / FONT_EM);
          if (baseline > maxY) { clipped = true; preserveOverflow(tokenIndex, charIndex); break; }
          continue;
        }
        if (headingEnds.has(char)) {
          const level = headingEnds.get(char);
          pendingHeadingGap =
            page.lineHeight * (level === 1 ? 0.18 : level === 2 ? 0.1 : 0.05);
          activeHeadingLevel = 0;
          continue;
        }
        if (startMarks.has(char)) {
          const style = startMarks.get(char);
          activeDecorations.add(style);
          decorationStarts.set(style, x);
          continue;
        }
        if (textStyleStarts.has(char)) {
          activeTextStyles.add(textStyleStarts.get(char));
          continue;
        }
        if (endMarks.has(char)) {
          const style = endMarks.get(char);
          decorationStroke(style, decorationStarts.get(style) ?? x, x);
          activeDecorations.delete(style);
          decorationStarts.delete(style);
          continue;
        }
        if (textStyleEnds.has(char)) {
          activeTextStyles.delete(textStyleEnds.get(char));
          continue;
        }
        const currentHeadingScale = headingScale();
        const motion = wordMotion(config, `${rawLineIndex}:${tokenIndex}:${token}`, visibleIndex, visibleChars.length);
        visibleIndex += 1;
        const advance = advanceFor(char, currentHeadingScale, motion.width);
        if (x > page.left && x + advance > maxX) {
          nextLine();
          previousJoin = null;
          if (clipped) {
            preserveOverflow(tokenIndex, charIndex);
            break;
          }
        }
        if (clipped) break;
        const variants = forms.get(char) || [];
        const letterPosition = visibleIndex === 1 ? 'initial' : visibleIndex === visibleChars.length ? 'final' : 'medial';
        const selected = config.trueHandwriting ? chooseForm(variants, config.seed, glyphOccurrence, letterPosition, previousForms.get(char)) : 0;
        const selectedForm = variants[selected];
        previousForms.set(char, selected);
        const baseGlyph = selectedForm?.strokes.length ? formGlyphs.get(char)[selected] : glyphs.get(char);
        const glyph = baseGlyph && config.trueHandwriting
          ? varyLetterGlyph(baseGlyph, config.seed, glyphOccurrence, config.glyphVariation, letterPosition)
          : baseGlyph;
        if (glyph) {
          const sourceGlyphStrokes = splitGlyphStrokes(
            glyph,
            x,
            baseline + (config.trueHandwriting ? Math.sin((x - page.left) / Math.max(1, page.fontSize * 7) + seededRandom(config.seed, `line:${rawLineIndex}`) * Math.PI * 2) * page.fontSize * Math.max(0, Math.min(100, Number(config.authorBaseline) || 0)) * 0.0006 : 0),
            scale * currentHeadingScale,
            {
              motion, bodyTop, structure: config, isLetter: LETTER_PATTERN.test(char),
              enabled: Boolean(config.trueHandwriting),
              variation: config.glyphVariation,
              pressure: config.pressureVariation,
              seed: config.seed,
              key: `${glyphOccurrence}:${char}`,
              authorSlant: config.authorSlant,
              authorWidth: config.authorWidth,
              rhythm: config.authorRhythm,
              authorBaseline: config.authorBaseline,
              fatigueEnabled: config.fatigueEnabled,
              fatigueStrength: config.fatigueStrength,
              progress: (baseline - (config.evolutionPageTop ?? page.top)) / Math.max(page.lineHeight, (config.evolutionPageBottom ?? page.pageHeight - (page.bottom || 0)) - (config.evolutionPageTop ?? page.top)),
            },
          );
          const glyphStrokes = applyTextStyles(sourceGlyphStrokes);
          const primaryGlyphStrokes = glyphStrokes.slice(
            0,
            sourceGlyphStrokes.length,
          );
          const isLetter = LETTER_PATTERN.test(char);
          if (isLetter) {
            const record = repetition.get(char) || { character: char, count: 0, shapes: new Set<string>() };
            record.count++;
            record.shapes.add(selectedForm ? trajectoryFingerprint(selectedForm.strokes) : String(char));
            repetition.set(char, record);
          }
          const explicitAnchor = (anchor: JoinAnchor | undefined) => {
            if (!anchor) return null;
            const stroke = primaryGlyphStrokes[anchor.stroke];
            if (!stroke?.length) return null;
            const point = anchor.end === 'start' ? stroke[0] : stroke.at(-1);
            const neighbor = anchor.end === 'start' ? stroke[1] : stroke.at(-2);
            const dx = anchor.end === 'start' ? neighbor.x - point.x : point.x - neighbor.x;
            const dy = anchor.end === 'start' ? neighbor.y - point.y : point.y - neighbor.y;
            return { point: { ...point, tangent: { x: dx, y: dy } }, quality: 1, strokeIndex: anchor.stroke, atStart: anchor.end === 'start' };
          };
          const entryAnchor = isLetter
            ? explicitAnchor(selectedForm?.entry) || findCursiveAnchor(
                primaryGlyphStrokes,
                "entry",
                baseline,
                page.fontSize * currentHeadingScale,
              )
            : null;
          const exitAnchor = isLetter
            ? explicitAnchor(selectedForm?.exit) || findCursiveAnchor(
                primaryGlyphStrokes,
                "exit",
                baseline,
                page.fontSize * currentHeadingScale,
              )
            : null;
          const connectionChance = Math.max(
            0,
            Math.min(100, Number(config.connectionStrength) || 0),
          );
          if (
            config.trueHandwriting &&
            previousJoin &&
            entryAnchor &&
            seededRandom(config.seed, `join:${glyphOccurrence}`) * 100 <
              connectionChance &&
            previousJoin.charIsLetter &&
            isLetter &&
            Math.min(previousJoin.anchor.quality, entryAnchor.quality) >= 0.22
          ) {
            const connector = createCursiveConnector(
              previousJoin.anchor.point,
              entryAnchor.point,
              page.fontSize * currentHeadingScale,
              connectionChance,
            );
            if (connector) {
              const previousStroke = previousJoin.stroke;
              const enteringStroke = primaryGlyphStrokes[entryAnchor.strokeIndex];
              if (previousStroke && strokes.at(-1) === previousStroke && !previousJoin.anchor.atStart && entryAnchor.atStart && entryAnchor.strokeIndex === 0 && !activeTextStyles.size) {
                previousStroke.push(...connector.slice(1), ...enteringStroke.slice(1));
                glyphStrokes.shift();
                primaryGlyphStrokes[0] = previousStroke;
              } else strokes.push(...applyTextStyles([connector]));
            }
          }
          if (
            config.trueHandwriting &&
            charIndex === 0 &&
            entryAnchor?.quality >= 0.35 &&
            seededRandom(config.seed, `lead:${glyphOccurrence}`) < 0.34
          ) {
            const start = entryAnchor.point;
            const lead: PlotStroke = [
              {
                x:
                  start.x -
                  page.fontSize *
                    (0.08 +
                      seededRandom(
                        config.seed,
                        `lead-width:${glyphOccurrence}`,
                      ) *
                        0.08),
                y: start.y + page.fontSize * 0.05,
              },
              start,
            ];
            lead.pressure = 0.78;
            strokes.push(lead);
          }
          strokes.push(...glyphStrokes);
          previousJoin = exitAnchor
            ? { anchor: exitAnchor, charIsLetter: isLetter, stroke: primaryGlyphStrokes[exitAnchor.strokeIndex] }
            : null;
          glyphOccurrence += 1;
        } else {
          previousJoin = null;
        }
        x += advance;
        if (glyph || !/\s/u.test(char)) {
          markCalloutContent();
          markQuoteContent();
        }
      }
      if (
        config.trueHandwriting &&
        previousJoin &&
        previousJoin.anchor.quality >= 0.35 &&
        seededRandom(config.seed, `tail:${glyphOccurrence}`) < 0.3
      ) {
        const tailStart = previousJoin.anchor.point;
        const tail: PlotStroke = [
          tailStart,
          {
            x: tailStart.x + page.fontSize * 0.13,
            y: tailStart.y - page.fontSize * 0.025,
          },
        ];
        tail.pressure = 0.76;
        strokes.push(tail);
      }
      if (
        config.trueHandwriting &&
        x > tokenStartX &&
        seededRandom(config.seed, `correction:${glyphOccurrence}:${token}`) *
          100 <
          Number(config.correctionChance || 0)
      ) {
        const correction: PlotStroke = [
          {
            x: tokenStartX - page.fontSize * 0.04,
            y: baseline - page.fontSize * 0.38,
          },
          { x: x + page.fontSize * 0.05, y: baseline - page.fontSize * 0.31 },
        ];
        correction.pressure = 1.08;
        strokes.push(correction);
      }
    }
    if (rawLineIndex < rawLines.length - 1) {
      nextLine();
      if (clipped && !overflowText) {
        overflowText = rawLines.slice(rawLineIndex + 1).join("\n");
      }
    } else closeLineDecorations();
    if (endsAlignment) activeAlignment = "left";
    if (clipped) break;
  }
  closeCallout();
  closeQuote();

  return { strokes, missing: [...missing], clipped, overflowText, endBaseline: baseline, trajectoryReport: [...repetition.values()].map(r => ({ character: r.character, count: r.count, distinct: r.shapes.size, shapes: [...r.shapes] })).sort((a, b) => b.count / b.distinct - a.count / a.distinct) };
}

export async function layoutBlocks(
  blocks: any[],
  font: any,
  page: any,
  config: any,
) {
  const strokes: PlotStroke[] = [];
  const missing = new Set<string>();
  const clippedItems = [];
  const reports = [];
  let clipped = false;

  for (const [index, block] of blocks.entries()) {
    const layout = block.layout || {
      x: 0,
      y: ((index * page.lineHeight) / PX_TO_MM) * 1.4,
      width: (page.pageWidth - page.left - page.right) / PX_TO_MM,
      height: (page.lineHeight / PX_TO_MM) * 1.5,
      rotation: 0,
      align: "left",
      noWrap: false,
    };
    const left = page.left + Number(layout.x || 0) * PX_TO_MM;
    const top = page.top + Number(layout.y || 0) * PX_TO_MM;
    const width = Math.max(8, Number(layout.width || 240) * PX_TO_MM);
    const height = Math.max(
      page.lineHeight,
      Number(layout.height || 40) * PX_TO_MM,
    );
    const alignment = ["left", "center", "right"].includes(layout.align)
      ? layout.align
      : "left";
    const markedText =
      alignment === "left"
        ? block.text
        : `${PLOTTER_ALIGN_MARKS[`${alignment}Start`]}${block.text}${PLOTTER_ALIGN_MARKS[`${alignment}End`]}`;
    const blockPage = {
      ...page,
      left,
      top,
      right: layout.noWrap
        ? -page.pageWidth * 3
        : page.pageWidth - left - width,
      bottom: Math.max(0, page.pageHeight - top - height),
    };
    const result = await layoutText(markedText, font, blockPage, {
      ...config,
      seed: Number(config.seed) + index * 1009,
      evolutionPageTop: page.top,
      evolutionPageBottom: page.pageHeight - (page.bottom || 0),
      noWrap: layout.noWrap,
    });
    result.missing.forEach((char) => missing.add(char));
    reports.push(...result.trajectoryReport);

    const angle = (Number(layout.rotation || 0) * Math.PI) / 180;
    const cosine = Math.cos(angle);
    const sine = Math.sin(angle);
    const transformed = result.strokes.map((stroke) => {
      const next = stroke.map((point) => {
        const x = point.x - left;
        const y = point.y - top;
        return {
          x: left + x * cosine - y * sine,
          y: top + x * sine + y * cosine,
        };
      }) as PlotStroke;
      next.pressure = stroke.pressure;
      return next;
    });
    const points = transformed.flat();
    const outsidePage = points.some(
      (point) =>
        point.x < 0 ||
        point.y < 0 ||
        point.x > page.pageWidth ||
        point.y > page.pageHeight,
    );
    const tolerance = page.fontSize * 0.28;
    const outsideBlock =
      !layout.noWrap &&
      points.some(
        (point) =>
          point.x < left - tolerance ||
          point.x > left + width + tolerance ||
          point.y < top - tolerance ||
          point.y > top + height + tolerance,
      );
    if (result.clipped || outsidePage || outsideBlock) {
      clipped = true;
      clippedItems.push(block.label || `Блок ${index + 1}`);
    }
    strokes.push(
      ...transformed.filter((stroke) =>
        stroke.every(
          (point) =>
            point.x >= 0 &&
            point.y >= 0 &&
            point.x <= page.pageWidth &&
            point.y <= page.pageHeight,
        ),
      ),
    );
  }

  return { strokes, missing: [...missing], clipped, clippedItems, trajectoryReport: mergeTrajectoryReports(reports) };
}

function number(value, digits = 3) {
  return Number(value.toFixed(digits)).toString();
}

function penDelay(up, config) {
  const explicit = up ? config.penUpDelay : config.penDownDelay;
  const fallback = config.penDelay;
  const value = Number(explicit ?? fallback ?? 0);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

/**
 * Maps page coordinates to the controller coordinate system. Page geometry is
 * always authored with X moving right and Y moving down. The selected physical
 * origin, axis swap and motor inversions are applied only at the output edge so
 * previews and document layout stay stable.
 */
export function transformPointForMachine(point, config) {
  const position = config.startPosition || "left-bottom";
  return transformVectorForMachine(
    Number(point.x) - (position.startsWith("right") ? Number(config.workAreaWidth) : 0),
    Number(point.y) - (position.endsWith("bottom") ? Number(config.workAreaHeight) : 0),
    config,
  );
}

export function transformVectorForMachine(dx, dy, config) {
  // Directions are physical page directions: right/down. Moving the origin
  // translates points; it must never reverse the manual arrows or mirror text.
  let x = Number(dx);
  let y = -Number(dy);
  if (config.swapAxes) [x, y] = [y, x];
  if (config.invertX) x *= -1;
  if (config.invertY) y *= -1;
  return { x, y };
}

function transformStrokeForMachine(stroke: PlotStroke, config): PlotStroke {
  const transformed = stroke.map((point) =>
    transformPointForMachine(point, config),
  ) as PlotStroke;
  if (stroke.pressure) transformed.pressure = stroke.pressure;
  if (stroke.feedRate) transformed.feedRate = stroke.feedRate;
  return transformed;
}

export function parseCustomGcode(value) {
  const source = String(value || "").replace(/\r\n?/g, "\n");
  if (source.length > 8192)
    throw new Error("Пользовательский G-code длиннее 8 КБ.");
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith(";") && !line.startsWith("("))
    .map((line) => {
      if (
        line.length > 256 ||
        /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(line)
      )
        throw new Error("В пользовательском G-code есть недопустимая строка.");
      return line;
    });
}

function penCommand(up, config, pressure = 1) {
  const stepperPosition = up ? automaticPenUpPosition(config) : config.zDown;
  const servoMax = config.profile === "marlin" ? 180 : 32767;
  const pressuredPenDown = Math.max(
    Math.min(Number(config.penUp), Number(config.penDown)),
    Math.min(
      Math.min(servoMax, Math.max(Number(config.penUp), Number(config.penDown))),
      Number(config.penUp) +
        (Number(config.penDown) - Number(config.penUp)) *
          Math.max(0.72, Math.min(1.28, pressure)),
    ),
  );
  if (config.profile === "ebb")
    return `SP,${up ? 1 : 0},${Math.round(penDelay(up, config) * 1000)}`;
  if (config.profile === "marlin") {
    if (config.penMode === "stepper")
      return `G1G90Z${number(stepperPosition)}F${config.zSpeed}`;
    if (config.penMode === "estepper")
      return `G1G90E${number(stepperPosition)}F${config.zSpeed}`;
    return `M280P0S${Math.round(up ? config.penUp : pressuredPenDown)}`;
  }
  if (config.penMode === "stepper")
    return `G1G90G94Z${number(stepperPosition)}F${automaticPenSpeed(config)}`;
  if (config.penMode === "laser") return up ? "M5" : `M3S${config.laserPower}`;
  return `M3S${Math.round(up ? config.penUp : pressuredPenDown)}`;
}

function buildEbbMove(from, to, speedMmMin, config, residue) {
  const scale = Number(config.mmToSteps);
  const exactX = (to.x - from.x) * scale + residue.x;
  const exactY = (to.y - from.y) * scale + residue.y;
  const stepsX = Math.trunc(exactX);
  const stepsY = Math.trunc(exactY);
  residue.x = exactX - stepsX;
  residue.y = exactY - stepsY;
  const speed = Math.min((Number(speedMmMin) / 60) * scale, 25000);
  const duration = Math.max(
    1,
    Math.round(
      (Math.max(Math.abs(stepsX), Math.abs(stepsY)) / Math.max(1, speed)) *
        1000,
    ),
  );
  return `XM,${duration},${stepsX},${stepsY}`;
}

function strokeTravelDistance(strokes) {
  let current = { x: 0, y: 0 };
  let distance = 0;
  for (const stroke of strokes) {
    if (stroke.length < 2) continue;
    distance += Math.hypot(stroke[0].x - current.x, stroke[0].y - current.y);
    current = stroke.at(-1);
  }
  return distance;
}

function reversedStroke(stroke: PlotStroke): PlotStroke {
  const reversed = [...stroke].reverse() as PlotStroke;
  if (stroke.pressure) reversed.pressure = stroke.pressure;
  if (stroke.feedRate) reversed.feedRate = stroke.feedRate;
  return reversed;
}

export function optimizeStrokeOrder(
  strokes,
  { lookahead = 36, lineTolerance = 8 } = {},
) {
  const pending = strokes.filter((stroke) => stroke.length > 1);
  if (pending.length < 3) return pending;
  const output = [];
  let current = { x: 0, y: 0 };
  while (pending.length) {
    const limit = Math.min(lookahead, pending.length);
    let selectedIndex = 0;
    let reverse = false;
    let bestScore = Infinity;
    const referenceY =
      pending[0].reduce((sum, point) => sum + point.y, 0) / pending[0].length;
    for (let index = 0; index < limit; index += 1) {
      const stroke = pending[index];
      const centerY =
        stroke.reduce((sum, point) => sum + point.y, 0) / stroke.length;
      const linePenalty =
        Math.max(0, Math.abs(centerY - referenceY) - lineTolerance) * 12;
      const orderPenalty = index * 0.055;
      const forward =
        Math.hypot(stroke[0].x - current.x, stroke[0].y - current.y) +
        linePenalty +
        orderPenalty;
      const backward =
        Math.hypot(stroke.at(-1).x - current.x, stroke.at(-1).y - current.y) +
        linePenalty +
        orderPenalty +
        0.08;
      if (forward < bestScore) {
        bestScore = forward;
        selectedIndex = index;
        reverse = false;
      }
      if (backward < bestScore) {
        bestScore = backward;
        selectedIndex = index;
        reverse = true;
      }
    }
    const [selected] = pending.splice(selectedIndex, 1);
    const prepared = reverse ? reversedStroke(selected) : selected;
    output.push(prepared);
    current = prepared.at(-1);
  }
  return output;
}

function fingerprintCommands(commands) {
  let hash = 2166136261;
  for (const command of commands) {
    for (let index = 0; index < command.length; index += 1) {
      hash ^= command.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${commands.length}-${(hash >>> 0).toString(36)}`;
}

// Iterative RDP in machine millimetres: bounded deviation, exact endpoints,
// no joining strokes or changing their pressure, speed or drawing order.
export function compactStroke(stroke: PlotStroke, tolerance = 0.02): PlotStroke {
  if (stroke.length < 3) return stroke;
  const keep = new Uint8Array(stroke.length);
  keep[0] = keep[stroke.length - 1] = 1;
  const stack = [[0, stroke.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const a = stroke[first], b = stroke[last];
    const dx = b.x - a.x, dy = b.y - a.y, length2 = dx * dx + dy * dy;
    let farthest = -1, maximum = tolerance * tolerance;
    for (let i = first + 1; i < last; i++) {
      const point = stroke[i];
      const t = length2 ? Math.max(0, Math.min(1, ((point.x-a.x)*dx + (point.y-a.y)*dy)/length2)) : 0;
      const distance2 = (point.x-a.x-t*dx)**2 + (point.y-a.y-t*dy)**2;
      if (distance2 > maximum) { maximum = distance2; farthest = i; }
    }
    if (farthest >= 0) { keep[farthest] = 1; stack.push([first, farthest], [farthest, last]); }
  }
  const result = stroke.filter((_, index) => keep[index]) as PlotStroke;
  if (stroke.pressure !== undefined) result.pressure = stroke.pressure;
  if (stroke.feedRate !== undefined) result.feedRate = stroke.feedRate;
  return result;
}

export function compilePlotJob(strokes, config) {
  // EBB jobs are emitted as relative step deltas. After a controller reset we
  // cannot safely infer the physical origin, so resuming in the middle of such
  // a stream would be unsafe. GRBL/Marlin use absolute millimetre coordinates.
  const recoverable = config.profile !== "ebb";
  const sourceStrokes = strokes.filter((stroke) => stroke.length > 1);
  const originalTravelDistance = strokeTravelDistance(sourceStrokes);
  const preparedStrokes = config.optimizePath
    ? optimizeStrokeOrder(sourceStrokes)
    : sourceStrokes;
  const machineStrokes = preparedStrokes.map((stroke) =>
    config.compactPaths !== false
      ? compactStroke(transformStrokeForMachine(stroke, config))
      : transformStrokeForMachine(stroke, config),
  );
  const commands = [];
  const resumePoints = [];
  const strokeCommandRanges = [];
  const addPen = (up, pressure = 1) => {
    commands.push(penCommand(up, config, pressure));
    const delay = penDelay(up, config);
    if (config.profile !== "ebb" && delay > 0)
      commands.push(`G4P${number(config.profile === "marlin" ? delay * 1000 : delay)}`);
  };
  let current = { x: 0, y: 0 };
  const residue = { x: 0, y: 0 };
  let distance = 0;
  let drawDistance = 0;
  let drawSeconds = 0;
  let travelDistance = 0;
  let penChanges = 0;
  let penLifts = 0;

  if (config.profile !== "ebb") commands.push(...coordinateFrameCommands(config));
  addPen(true);
  penChanges += 1;

  const startCommands = parseCustomGcode(config.customStartGcode);
  commands.push(...startCommands);
  if (startCommands.length && config.profile !== "ebb") {
    // User macros must not leak units, relative mode or a lowered pen into
    // the generated document trajectory.
    commands.push(...coordinateFrameCommands(config));
    addPen(true);
    penChanges += 1;
    penLifts += 1;
  }
  for (const stroke of machineStrokes) {
    if (stroke.length < 2) continue;
    if (recoverable) resumePoints.push(commands.length);
    const start = stroke[0];
    const travel = Math.hypot(start.x - current.x, start.y - current.y);
    distance += travel;
    travelDistance += travel;
    if (config.profile === "ebb")
      commands.push(
        buildEbbMove(current, start, config.jogSpeed, config, residue),
      );
    else
      commands.push(
        `G1X${number(start.x)}Y${number(start.y)}F${config.jogSpeed}`,
      );
    current = start;
    addPen(false, stroke.pressure || 1);
    const drawStart = commands.length;
    penChanges += 1;
    for (const point of stroke.slice(1)) {
      const drawn = Math.hypot(point.x - current.x, point.y - current.y);
      distance += drawn;
      drawDistance += drawn;
      const feedRate = Number.isFinite(stroke.feedRate) && stroke.feedRate > 0 ? stroke.feedRate : config.feedRate;
      drawSeconds += drawn / Math.max(1, feedRate) * 60;
      if (config.profile === "ebb")
        commands.push(
          buildEbbMove(current, point, feedRate, config, residue),
        );
      else
        commands.push(
          `G1X${number(point.x)}Y${number(point.y)}F${feedRate}`,
        );
      current = point;
    }
    const drawEnd = commands.length;
    addPen(true);
    strokeCommandRanges.push({ start: drawStart, end: drawEnd });
    penChanges += 1;
    penLifts += 1;
  }

  if (
    config.returnToOrigin &&
    config.profile !== "ebb" &&
    machineStrokes.length
  ) {
    const travel = Math.hypot(current.x, current.y);
    distance += travel;
    travelDistance += travel;
    commands.push(`G1X0Y0F${config.jogSpeed}`);
  }
  const endCommands = parseCustomGcode(config.customEndGcode);
  commands.push(...endCommands);
  if (endCommands.length && config.profile !== "ebb") {
    commands.push(...coordinateFrameCommands(config));
    addPen(true);
    penChanges += 1;
    penLifts += 1;
  }

  const estimatedSeconds =
    drawSeconds +
    penLifts * 2 * penTravelSeconds(config) +
    (travelDistance / Math.max(1, Number(config.jogSpeed))) * 60 +
    (penLifts + 1) * penDelay(true, config) +
    Math.max(0, penChanges - penLifts - 1) * penDelay(false, config);
  const resumePrefix =
    config.profile === "ebb"
      ? [penCommand(true, config)]
      : [...coordinateFrameCommands(config), penCommand(true, config)];
  return {
    id: fingerprintCommands(commands),
    commands,
    firstPoint: machineStrokes.length ? {
      x: Number(number(machineStrokes[0][0].x)),
      y: Number(number(machineStrokes[0][0].y)),
    } : null,
    strokes: preparedStrokes,
    strokeCommandRanges,
    resumePoints,
    resumePrefix,
    recoverable,
    distance,
    drawDistance,
    travelDistance,
    originalTravelDistance,
    optimizationSaved: Math.max(0, originalTravelDistance - travelDistance),
    penLifts,
    penChanges,
    estimatedSeconds,
    machineBounds: plotBounds(machineStrokes),
    withinWorkArea: isWithinWorkArea(machineStrokes, config),
  };
}

export function plotBounds(strokes) {
  const points = strokes
    .flat()
    .filter((point) => Number.isFinite(point?.x) && Number.isFinite(point?.y));
  if (!points.length) return null;
  return points.reduce(
    (bounds, point) => ({
      minX: Math.min(bounds.minX, point.x),
      minY: Math.min(bounds.minY, point.y),
      maxX: Math.max(bounds.maxX, point.x),
      maxY: Math.max(bounds.maxY, point.y),
    }),
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}

export function isWithinWorkArea(machineStrokes, config) {
  const bounds = plotBounds(machineStrokes);
  if (!bounds) return true;
  const epsilon = 0.01;
  const corners = plotBounds([[
    transformPointForMachine({ x: 0, y: 0 }, config),
    transformPointForMachine({ x: Number(config.workAreaWidth), y: Number(config.workAreaHeight) }, config),
  ]]);
  return bounds.minX >= corners.minX - epsilon && bounds.maxX <= corners.maxX + epsilon
    && bounds.minY >= corners.minY - epsilon && bounds.maxY <= corners.maxY + epsilon;
}

export function createDryRunCommands(strokes, config) {
  const sourceBounds = plotBounds(strokes);
  if (!sourceBounds) throw new Error("Нет штрихов для проверки рамки.");
  const sourceCorners = [
    { x: sourceBounds.minX, y: sourceBounds.minY },
    { x: sourceBounds.maxX, y: sourceBounds.minY },
    { x: sourceBounds.maxX, y: sourceBounds.maxY },
    { x: sourceBounds.minX, y: sourceBounds.maxY },
    { x: sourceBounds.minX, y: sourceBounds.minY },
  ];
  const machineCorners = sourceCorners.map((point) =>
    transformPointForMachine(point, config),
  );
  if (!isWithinWorkArea([machineCorners], config)) {
    throw new Error(
      "Траектория выходит за настроенную рабочую область. Измените лист, поля или границы механики.",
    );
  }
  if (config.profile === "ebb") {
    throw new Error(
      "Сухой прогон рамки для EBB требует относительных шагов и пока недоступен. Проверьте область в мастере калибровки.",
    );
  }
  return [
    ...coordinateFrameCommands(config),
    penCommand(true, config),
    ...machineCorners.map(
      ({ x, y }) => `G1X${number(x)}Y${number(y)}F${config.jogSpeed}`,
    ),
  ];
}

export function createJogCommands(dx, dy, config) {
  if (config.profile === "ebb") {
    return [
      buildEbbMove({ x: 0, y: 0 }, { x: dx, y: dy }, config.jogSpeed, config, {
        x: 0,
        y: 0,
      }),
    ];
  }
  if (config.profile === "marlin")
    return ["G21", "G91", `G1X${number(dx)}Y${number(dy)}F${config.jogSpeed}`, "G90"];
  return [`$J=G21G91X${number(dx)}Y${number(dy)}F${config.jogSpeed}`];
}

export function createPageJogCommands(dx, dy, config) {
  const transformed = transformVectorForMachine(dx, dy, config);
  return createJogCommands(transformed.x, transformed.y, config);
}

export function createPenCommand(up, config) {
  return [...coordinateFrameCommands(config), penCommand(up, config)];
}

export function createPenReferenceCommands(config, position: "up" | "down" = "up") {
  if (!["stepper", "estepper"].includes(config.penMode)) return [];
  return [...coordinateFrameCommands(config), `G92${config.penMode === "estepper" ? "E" : "Z"}${number(Number(position === "down" ? config.zDown : automaticPenUpPosition(config)))}`];
}

export function createPenJogCommands(up: boolean, distance: number, config) {
  if (!["stepper", "estepper"].includes(config.penMode) || config.profile === "ebb")
    throw new Error("Короткий шаг доступен для шагового пера Z/E.");
  if (!Number.isFinite(distance) || distance < 0.01 || distance > MAX_PEN_JOG_MM)
    throw new Error("Выберите шаг пера от 0,01 до 1 мм.");
  const direction = config.zUpDirection === 1 ? 1 : config.zUpDirection === -1 ? -1 : Math.sign(config.zUp - config.zDown) || -1;
  const delta = number(distance * direction * (up ? 1 : -1));
  const speed = Math.min(60, Number(config.zSpeed));
  if (config.profile === "grbl") return [`$J=G21G91Z${delta}F${speed}`];
  if (config.penMode === "estepper") return ["G21", "M83", `G1E${delta}F${speed}`, "M82"];
  return ["G21", "G91", `G1Z${delta}F${speed}`, "G90"];
}

export function createOriginCommands(config, position = { x: 0, y: 0 }) {
  if (![position.x, position.y].every(Number.isFinite)) throw new Error("Некорректная точка привязки на листе.");
  if (config.profile === "ebb") {
    if (position.x || position.y) throw new Error("Привязка первого штриха доступна для GRBL и Marlin.");
    return [];
  }
  const axes = `X${number(position.x)}Y${number(position.y)}`;
  if (config.profile === "marlin") return [...coordinateFrameCommands(config), `G92${axes}`];
  return [...coordinateFrameCommands(config), `G10P0L20${axes}`];
}

export function createHomingCommands(config) {
  if (config.profile === "ebb")
    throw new Error(
      "Для EBB команда homing зависит от механики и не отправляется автоматически.",
    );
  return config.profile === "marlin" ? ["G28"] : ["$H"];
}

export function createReturnToOriginCommands(config) {
  if (config.profile === "ebb")
    throw new Error("Для EBB возврат к абсолютному нулю недоступен.");
  return [
    ...coordinateFrameCommands(config),
    penCommand(true, config),
    `G1X0Y0F${config.jogSpeed}`,
  ];
}
