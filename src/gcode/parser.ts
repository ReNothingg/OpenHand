const NUMBER_PATTERN = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const WORD_PATTERN = new RegExp(`([A-Z])\\s*(${NUMBER_PATTERN})`, "gi");
const FULL_CIRCLE = Math.PI * 2;
const MAX_ARC_SEGMENT_LENGTH_MM = 1;

export interface GCodePoint {
  x: number;
  y: number;
  z: number;
}

export interface GCodeSegment {
  from: GCodePoint;
  to: GCodePoint;
  line: number;
}

export interface GCodeBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface GCodeParseResult {
  lines: string[];
  lineCount: number;
  lineOffsets: Uint32Array;
  drawing: GCodeSegment[];
  travel: GCodeSegment[];
  drawingSegmentCount: number;
  travelSegmentCount: number;
  bounds: GCodeBounds;
  commandCount: number;
  ignoredLines: number[];
  unsupportedMotionLines: number[];
  drawDistance: number;
  travelDistance: number;
}

export interface GCodeParseOptions {
  includeLines?: boolean;
  maxSegmentsPerKind?: number;
}

interface GCodeWord {
  letter: string;
  value: number;
}

function cleanLine(line: string) {
  return line
    .replace(/\([^)]*\)/g, "")
    .replace(/;.*$/, "")
    .trim();
}

function wordsIn(line: string) {
  const words: GCodeWord[] = [];
  for (const match of line.matchAll(WORD_PATTERN)) {
    const letter = match[1];
    const value = match[2];
    if (letter && value) {
      words.push({ letter: letter.toUpperCase(), value: Number(value) });
    }
  }
  return words;
}

interface MutableBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  hasSegments: boolean;
}

function createBounds(): MutableBounds {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    hasSegments: false,
  };
}

function extendBounds(bounds: MutableBounds, segment: GCodeSegment) {
  bounds.hasSegments = true;
  for (const point of [segment.from, segment.to]) {
    bounds.minX = Math.min(bounds.minX, point.x);
    bounds.minY = Math.min(bounds.minY, point.y);
    bounds.maxX = Math.max(bounds.maxX, point.x);
    bounds.maxY = Math.max(bounds.maxY, point.y);
  }
}

function finishBounds(bounds: MutableBounds): GCodeBounds {
  if (!bounds.hasSegments) {
    return {
      minX: 0,
      minY: 0,
      maxX: 210,
      maxY: 297,
      width: 210,
      height: 297,
    };
  }
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY,
    width: Math.max(0.01, bounds.maxX - bounds.minX),
    height: Math.max(0.01, bounds.maxY - bounds.minY),
  };
}

function segmentLength(segment: GCodeSegment) {
  return Math.hypot(
    segment.to.x - segment.from.x,
    segment.to.y - segment.from.y,
  );
}

class SegmentCollector {
  segments: GCodeSegment[] = [];
  count = 0;
  distance = 0;
  private stride = 1;
  private readonly maximum: number;

  constructor(maximum?: number) {
    this.maximum =
      maximum === undefined
        ? Infinity
        : Math.max(1, Math.floor(maximum));
  }

  add(segment: GCodeSegment) {
    const ordinal = this.count;
    this.count += 1;
    this.distance += segmentLength(segment);
    if (ordinal % this.stride !== 0) return;
    if (this.segments.length >= this.maximum) {
      this.stride *= 2;
      this.segments = this.segments.filter((_, index) => index % 2 === 0);
      if (ordinal % this.stride !== 0) return;
    }
    this.segments.push(segment);
  }
}

function sweepFor(start: number, end: number, clockwise: boolean) {
  let sweep = end - start;
  if (clockwise) {
    while (sweep >= 0) sweep -= FULL_CIRCLE;
  } else {
    while (sweep <= 0) sweep += FULL_CIRCLE;
  }
  return sweep;
}

function centerFromRadius(
  from: GCodePoint,
  to: GCodePoint,
  radiusValue: number,
  clockwise: boolean,
) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const chord = Math.hypot(dx, dy);
  const radius = Math.abs(radiusValue);
  if (!chord || chord > radius * 2) return null;
  const midpoint = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const height = Math.sqrt(Math.max(0, radius * radius - (chord * chord) / 4));
  const perpendicular = { x: -dy / chord, y: dx / chord };
  const candidates = [-1, 1].map((direction) => ({
    x: midpoint.x + perpendicular.x * height * direction,
    y: midpoint.y + perpendicular.y * height * direction,
  }));
  const scored = candidates.map((center) => {
    const start = Math.atan2(from.y - center.y, from.x - center.x);
    const end = Math.atan2(to.y - center.y, to.x - center.x);
    return { center, magnitude: Math.abs(sweepFor(start, end, clockwise)) };
  });
  const wantsMajorArc = radiusValue < 0;
  const selected = scored.sort((left, right) =>
    wantsMajorArc
      ? right.magnitude - left.magnitude
      : left.magnitude - right.magnitude,
  )[0];
  return selected?.center ?? null;
}

function arcSegments(
  from: GCodePoint,
  to: GCodePoint,
  coordinates: Partial<Record<"i" | "j" | "r", number>>,
  clockwise: boolean,
  line: number,
) {
  const hasCenterOffset =
    coordinates.i !== undefined || coordinates.j !== undefined;
  const center = hasCenterOffset
    ? {
        x: from.x + (coordinates.i ?? 0),
        y: from.y + (coordinates.j ?? 0),
      }
    : coordinates.r !== undefined
      ? centerFromRadius(from, to, coordinates.r, clockwise)
      : null;
  if (!center) return [{ from, to, line }];

  const radius = Math.hypot(from.x - center.x, from.y - center.y);
  if (!Number.isFinite(radius) || radius < 0.0001) return [{ from, to, line }];
  const startAngle = Math.atan2(from.y - center.y, from.x - center.x);
  const endAngle = Math.atan2(to.y - center.y, to.x - center.x);
  let sweep = sweepFor(startAngle, endAngle, clockwise);
  if (Math.hypot(to.x - from.x, to.y - from.y) < 0.0001) {
    sweep = clockwise ? -FULL_CIRCLE : FULL_CIRCLE;
  }
  const steps = Math.max(
    4,
    Math.min(
      1440,
      Math.ceil(
        (Math.abs(sweep) * radius) / MAX_ARC_SEGMENT_LENGTH_MM,
      ),
    ),
  );
  const segments: GCodeSegment[] = [];
  let previous = from;
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const angle = startAngle + sweep * progress;
    const next =
      step === steps
        ? to
        : {
            x: center.x + Math.cos(angle) * radius,
            y: center.y + Math.sin(angle) * radius,
            z: from.z + (to.z - from.z) * progress,
          };
    segments.push({ from: previous, to: next, line });
    previous = next;
  }
  return segments;
}

function lastValue(words: GCodeWord[], letter: string) {
  return words.findLast((word) => word.letter === letter)?.value;
}

export function normalizeGCodeSource(source = "") {
  return String(source).replace(/\r\n?/g, "\n");
}

function offsetsForLines(lines: string[]) {
  const offsets = new Uint32Array(lines.length);
  let offset = 0;
  lines.forEach((line, index) => {
    offsets[index] = offset;
    offset += line.length + 1;
  });
  return offsets;
}

export function parseGCode(
  source = "",
  options: GCodeParseOptions = {},
): GCodeParseResult {
  const normalizedSource = normalizeGCodeSource(source);
  const lines = normalizedSource.split("\n");
  const drawing = new SegmentCollector(options.maxSegmentsPerKind);
  const travel = new SegmentCollector(options.maxSegmentsPerKind);
  const bounds = createBounds();
  const ignoredLines: number[] = [];
  const unsupportedMotionLines: number[] = [];
  let units = 1;
  let absolute = true;
  let arcCenterAbsolute = false;
  let plane: "xy" | "xz" | "yz" = "xy";
  let motion: 0 | 1 | 2 | 3 | null = null;
  let penDown: boolean | null = null;
  let position: GCodePoint = { x: 0, y: 0, z: 0 };
  let commandCount = 0;

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = cleanLine(rawLine);
    if (!line || line === "%" || line.startsWith("/")) return;
    const words = wordsIn(line);
    if (!words.length) {
      ignoredLines.push(lineNumber);
      return;
    }
    commandCount += words.filter((word) =>
      ["G", "M"].includes(word.letter),
    ).length;

    const gCodes = words
      .filter((word) => word.letter === "G")
      .map((word) => word.value);
    const mCodes = words
      .filter((word) => word.letter === "M")
      .map((word) => word.value);
    if (gCodes.includes(20)) units = 25.4;
    if (gCodes.includes(21)) units = 1;
    if (gCodes.includes(90)) absolute = true;
    if (gCodes.includes(91)) absolute = false;
    if (gCodes.includes(90.1)) arcCenterAbsolute = true;
    if (gCodes.includes(91.1)) arcCenterAbsolute = false;
    if (gCodes.includes(17)) plane = "xy";
    if (gCodes.includes(18)) plane = "xz";
    if (gCodes.includes(19)) plane = "yz";
    const nextMotion = gCodes.findLast((code) => [0, 1, 2, 3].includes(code));
    if (nextMotion !== undefined) motion = nextMotion as 0 | 1 | 2 | 3;
    const hasUnsupportedMotion = gCodes.some(
      (code) =>
        (code >= 0 && code <= 3 && !Number.isInteger(code)) ||
        code === 5 ||
        (code >= 38 && code < 39),
    );
    if (hasUnsupportedMotion) {
      unsupportedMotionLines.push(lineNumber);
    }
    if (mCodes.includes(3) || mCodes.includes(4)) penDown = true;
    if (mCodes.includes(5)) penDown = false;

    const coordinate = (letter: string) => {
      const value = lastValue(words, letter);
      return value === undefined ? undefined : value * units;
    };
    const coordinates = {
      x: coordinate("X"),
      y: coordinate("Y"),
      z: coordinate("Z"),
      i: coordinate("I"),
      j: coordinate("J"),
      r: coordinate("R"),
    };
    if (gCodes.includes(92)) {
      position = {
        x: coordinates.x ?? position.x,
        y: coordinates.y ?? position.y,
        z: coordinates.z ?? position.z,
      };
      return;
    }
    if (gCodes.some((code) => [10, 28, 30].includes(code))) {
      unsupportedMotionLines.push(lineNumber);
      return;
    }
    const next: GCodePoint = {
      x:
        coordinates.x === undefined
          ? position.x
          : absolute
            ? coordinates.x
            : position.x + coordinates.x,
      y:
        coordinates.y === undefined
          ? position.y
          : absolute
            ? coordinates.y
            : position.y + coordinates.y,
      z:
        coordinates.z === undefined
          ? position.z
          : absolute
            ? coordinates.z
            : position.z + coordinates.z,
    };
    if (coordinates.z !== undefined && next.z !== position.z) {
      penDown = next.z < position.z;
    }

    const hasPlanarMove =
      coordinates.x !== undefined || coordinates.y !== undefined;
    if (hasPlanarMove && motion !== null && !hasUnsupportedMotion) {
      const arcCoordinates = arcCenterAbsolute
        ? {
            i:
              coordinates.i === undefined
                ? undefined
                : coordinates.i - position.x,
            j:
              coordinates.j === undefined
                ? undefined
                : coordinates.j - position.y,
            r: coordinates.r,
          }
        : { i: coordinates.i, j: coordinates.j, r: coordinates.r };
      if ((motion === 2 || motion === 3) && plane !== "xy") {
        unsupportedMotionLines.push(lineNumber);
      }
      const segments =
        (motion === 2 || motion === 3) && plane === "xy"
          ? arcSegments(
              position,
              next,
              arcCoordinates,
              motion === 2,
              lineNumber,
            )
          : [{ from: position, to: next, line: lineNumber }];
      const target = motion === 0 || penDown === false ? travel : drawing;
      for (const segment of segments) {
        extendBounds(bounds, segment);
        target.add(segment);
      }
      position = next;
    } else if (coordinates.z !== undefined) {
      position = next;
    }
  });

  return {
    lines: options.includeLines === false ? [] : lines,
    lineCount: lines.length,
    lineOffsets: offsetsForLines(lines),
    drawing: drawing.segments,
    travel: travel.segments,
    drawingSegmentCount: drawing.count,
    travelSegmentCount: travel.count,
    bounds: finishBounds(bounds),
    commandCount,
    ignoredLines,
    unsupportedMotionLines: [...new Set(unsupportedMotionLines)],
    drawDistance: drawing.distance,
    travelDistance: travel.distance,
  };
}

export function segmentsToPath(segments: GCodeSegment[]) {
  return segments
    .map(({ from, to }) => `M${from.x} ${from.y}L${to.x} ${to.y}`)
    .join("");
}

export function segmentsToPathChunks(
  segments: GCodeSegment[],
  chunkSize = 4_000,
) {
  const paths: string[] = [];
  for (let offset = 0; offset < segments.length; offset += chunkSize) {
    paths.push(segmentsToPath(segments.slice(offset, offset + chunkSize)));
  }
  return paths;
}
