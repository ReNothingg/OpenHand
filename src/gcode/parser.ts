const NUMBER_PATTERN = "[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)";
const WORD_PATTERN = new RegExp(`([A-Z])\\s*(${NUMBER_PATTERN})`, "gi");

function cleanLine(line) {
  return line
    .replace(/\([^)]*\)/g, "")
    .replace(/;.*$/, "")
    .trim();
}

function wordsIn(line) {
  const words = [];
  for (const match of line.matchAll(WORD_PATTERN)) {
    words.push({ letter: match[1].toUpperCase(), value: Number(match[2]) });
  }
  return words;
}

function boundsFor(segments) {
  if (!segments.length)
    return { minX: 0, minY: 0, maxX: 210, maxY: 297, width: 210, height: 297 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const segment of segments) {
    for (const point of [segment.from, segment.to]) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0.01, maxX - minX),
    height: Math.max(0.01, maxY - minY),
  };
}

function segmentLength(segment) {
  return Math.hypot(
    segment.to.x - segment.from.x,
    segment.to.y - segment.from.y,
  );
}

export function parseGCode(source = "") {
  const lines = String(source).replace(/\r\n?/g, "\n").split("\n");
  const drawing = [];
  const travel = [];
  const ignoredLines = [];
  let units = 1;
  let absolute = true;
  let motion = null;
  let position = { x: 0, y: 0, z: 0 };
  let commandCount = 0;

  lines.forEach((rawLine, index) => {
    const line = cleanLine(rawLine);
    if (!line || line === "%" || line.startsWith("/")) return;
    const words = wordsIn(line);
    if (!words.length) {
      ignoredLines.push(index + 1);
      return;
    }

    const gCodes = words
      .filter((word) => word.letter === "G")
      .map((word) => word.value);
    if (gCodes.includes(20)) units = 25.4;
    if (gCodes.includes(21)) units = 1;
    if (gCodes.includes(90)) absolute = true;
    if (gCodes.includes(91)) absolute = false;
    if (gCodes.some((code) => code === 0 || code === 1)) {
      motion = gCodes.findLast((code) => code === 0 || code === 1);
    }

    const coordinates = Object.fromEntries(
      words
        .filter((word) => ["X", "Y", "Z"].includes(word.letter))
        .map((word) => [word.letter.toLowerCase(), word.value * units]),
    );
    const hasPlanarMove =
      coordinates.x !== undefined || coordinates.y !== undefined;
    if (hasPlanarMove && motion !== null) {
      const next = {
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
      const segment = { from: position, to: next, line: index + 1 };
      if (motion === 0) travel.push(segment);
      else drawing.push(segment);
      position = next;
    } else if (coordinates.z !== undefined) {
      position = {
        ...position,
        z: absolute ? coordinates.z : position.z + coordinates.z,
      };
    }
    commandCount += words.filter((word) =>
      ["G", "M"].includes(word.letter),
    ).length;
  });

  const segments = [...drawing, ...travel];
  const bounds = boundsFor(segments);
  return {
    lines,
    drawing,
    travel,
    bounds,
    commandCount,
    ignoredLines,
    drawDistance: drawing.reduce(
      (sum, segment) => sum + segmentLength(segment),
      0,
    ),
    travelDistance: travel.reduce(
      (sum, segment) => sum + segmentLength(segment),
      0,
    ),
  };
}

export function segmentsToPath(segments) {
  return segments
    .map(({ from, to }) => `M${from.x} ${from.y}L${to.x} ${to.y}`)
    .join("");
}
