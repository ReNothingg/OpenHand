// Convert reviewed, photographed ink paths into GFont letter forms. Geometry
// stays in its baseline coordinate system; bearings must not be discarded.
function pathLength(path) {
  return path.reduce((length, point, index) => length + (index
    ? Math.hypot(point[0] - path[index - 1][0], point[1] - path[index - 1][1]) : 0), 0);
}

function stitchInkPaths(source) {
  const paths = source.map(path => path.map(point => [...point]));
  for (;;) {
    let best = null;
    for (let a = 0; a < paths.length; a++) for (let b = a + 1; b < paths.length; b++) {
      for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
        const p = reverseA ? paths[a][0] : paths[a].at(-1);
        const q = reverseB ? paths[b].at(-1) : paths[b][0];
        const distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
        // Only bridge sub-ink-width gaps left by skeleton junctions; never join
        // separate accents or replace a missing letter stroke with a long line.
        if (distance <= .9 && (!best || distance < best.distance))
          best = { a, b, reverseA, reverseB, distance };
      }
    }
    if (!best) return paths;
    const first = best.reverseA ? [...paths[best.a]].reverse() : paths[best.a];
    const second = best.reverseB ? [...paths[best.b]].reverse() : paths[best.b];
    paths[best.a] = [...first, ...second.slice(best.distance < 1e-6 ? 1 : 0)];
    paths.splice(best.b, 1);
  }
}

function smoothRasterPath(path) {
  const dense = [path[0]];
  for (let index = 1; index < path.length; index++) {
    const a = path[index - 1], b = path[index];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .5));
    for (let step = 1; step <= steps; step++)
      dense.push([a[0] + (b[0] - a[0]) * step / steps, a[1] + (b[1] - a[1]) * step / steps]);
  }
  return dense.map((point, index) => {
    if (!index || index === dense.length - 1) return point;
    let x = 0, y = 0, total = 0;
    for (let neighbor = Math.max(0, index - 4); neighbor <= Math.min(dense.length - 1, index + 4); neighbor++) {
      const weight = Math.exp(-(((neighbor - index) / 2) ** 2) / 2);
      x += dense[neighbor][0] * weight;
      y += dense[neighbor][1] * weight;
      total += weight;
    }
    x /= total;
    y /= total;
    // Remove pixel stair steps, with displacement bounded below the ink width.
    const distance = Math.hypot(x - point[0], y - point[1]);
    const amount = Math.min(1, .6 / Math.max(.001, distance));
    return [point[0] + (x - point[0]) * amount, point[1] + (y - point[1]) * amount];
  });
}

function joinAnchor(paths, cut, word, side) {
  const candidates = [];
  for (const [stroke, points] of paths.entries()) {
    for (let index = 0; index < points.length; index++) {
      const p = points[index], deskewedX = p[0] + word.slant * (p[1] - word.baseline);
      if (p[1] <= word.baseline - 24 || p[1] >= word.baseline + 6) continue;
      candidates.push({ stroke, point: index, end: side === 'entry' ? 'start' : 'end',
        score: Math.abs(deskewedX - cut) * 2 + Math.abs(p[1] - (word.baseline - 5)) * .5 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  if (!candidates.length) return undefined;
  const { score, ...anchor } = candidates[0];
  return anchor;
}

// These source words have the clearest complete bodies for these characters.
// Other pieces remain in the extraction dataset for review, not in the font.
const PREFERRED_WORD = { м: 'мантии', н: 'организмов', с: 'совокупность',
  т: 'литосфера', ч: 'часть', в: 'совокупность' };

export function rasterLetterForms(data, adjustments = {}) {
  if (data.version !== 1 || !(data.pixelsPerMm > 0) || !(data.nominalFontSizePx > 0))
    throw new Error('Invalid raster font calibration.');
  const forms = {}, captured = {};
  const factor = 400 / (data.nominalFontSizePx * 25.4 / 96 * data.pixelsPerMm);
  for (const [wordIndex, word] of data.words.entries()) {
    const characters = Array.from(word.text);
    if (word.cuts.length !== characters.length + 1 || word.glyphs.length !== characters.length ||
        word.cuts.some((value, index) => !Number.isFinite(value) || (index && value <= word.cuts[index - 1])))
      throw new Error(`Invalid character boundaries: ${word.text}`);
    for (const [index, char] of characters.entries()) {
      if (word.include && !word.include.includes(index)) continue;
      const paths = stitchInkPaths(word.glyphs[index]
        .filter(path => pathLength(path) > (char === 'й' ? 1 : 2.2))).map(smoothRasterPath);
      if (!paths.length) continue;
      const form = {
        originX: 0,
        advance: (word.cuts[index + 1] - word.cuts[index]) * factor,
        position: 'any',
        style: 'raster-geography',
        context: { before: characters[index - 1] || '', after: characters[index + 1] || '' },
        strokes: paths.map(path => path.map(([x, y]) => ({
          x: +((x - word.cuts[index]) * factor).toFixed(3),
          y: +((y - word.baseline) * factor).toFixed(3),
        }))),
        entry: joinAnchor(paths, word.cuts[index], word, 'entry'),
        exit: joinAnchor(paths, word.cuts[index + 1], word, 'exit'),
        source: { word: word.text, wordIndex, characterIndex: index },
      };
      (captured[char] ??= []).push(form);
    }
  }
  for (const [char, variants] of Object.entries(captured)) {
    const preferred = PREFERRED_WORD[char];
    const chosen = preferred ? variants.filter(form => form.source.word === preferred) : variants;
    if (!chosen.length) throw new Error(`Missing reviewed source for ${char}`);
    if (chosen.some(form => form.context.after))
      for (const form of chosen) if (!form.context.after) form.position = 'final';
    // Index zero must remain usable when handwriting variation is disabled.
    forms[char] = [...chosen.filter(form => form.position === 'any'),
      ...chosen.filter(form => form.position !== 'any')].slice(0, 6);
  }
  for (const [char, delta] of Object.entries(adjustments)) {
    if (!Number.isFinite(delta)) throw new Error(`Invalid spacing for ${char}`);
    for (const form of forms[char] || []) form.advance = Math.max(60, form.advance + delta * factor);
  }
  return forms;
}
