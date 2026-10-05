// Letter forms traced from the notebook photographs by
// scripts/trace-notebook-letters.py (GFont units, x-height 200). Every form
// is one written letter with its origin on the cut where the previous letter
// joined it, the step to the next cut and the side it was joined on.

export const NOTEBOOK_BODY_HEIGHT = 200;

// The join that leads into a letter from the previous one: the shallow
// start of the first stroke, up to where the letter's own stroke turns steep
// (more than about 50 degrees), turns back or reaches half the body.
function leadIn(strokes) {
  const first = strokes[0];
  if (!first || first.length < 4) return undefined;
  const start = first[0];
  for (let i = 1; i < first.length - 1; i++) {
    const a = first[i - 1], b = first[Math.min(first.length - 1, i + 2)];
    const dx = b.x - a.x, dy = a.y - b.y;
    if (dx <= 0 || dy > 1.2 * dx || start.y - first[i].y > NOTEBOOK_BODY_HEIGHT / 2) {
      if (first[i].x - start.x < 0.12 * NOTEBOOK_BODY_HEIGHT) return undefined;
      // Keep a short hook of the join, as a pen starting a word leaves one.
      let j = i;
      while (j > 1 && first[i].x - first[j - 1].x <= 0.1 * NOTEBOOK_BODY_HEIGHT) j--;
      return j > 0 ? j : undefined;
    }
  }
  return undefined;
}

const ACCENTED = new Set(Array.from('йЙёЁіІэЭ'));
const inkLength = stroke => stroke.slice(1).reduce((sum, [x, y], i) =>
  sum + Math.hypot(x - stroke[i][0], y - stroke[i][1]), 0);

// A short separate trace in a lowercase letter without accents is a thinning
// spur or a piece of a neighbour or of the line above, not part of the
// letter: the cursive lowercase letters have no strokes this short. The
// strokes that carry the joins are always kept.
function writtenStrokes(letter) {
  const exit = letter.exit ? letter.exitStroke ?? letter.strokes.length - 1 : -1;
  if (!/^\p{Ll}$/u.test(letter.char) || ACCENTED.has(letter.char) || letter.strokes.length < 2)
    return { strokes: letter.strokes, exit };
  const keep = letter.strokes.map((stroke, i) => (letter.entry && i === 0) || i === exit ||
    inkLength(stroke) >= 0.35 * NOTEBOOK_BODY_HEIGHT);
  return {
    strokes: letter.strokes.filter((_, i) => keep[i]),
    exit: exit < 0 ? -1 : keep.slice(0, exit).filter(Boolean).length,
  };
}

// Thinning leaves small breaks where the pen ran up and back down the same
// ink (the peaks of м, т, и). The photographed ink is continuous there, so a
// loose end within a fifth of the body of another piece is joined to it.
// The ends that carry the joins to neighbouring letters stay free.
function healBreaks(strokes, entry, exit) {
  const reach = 0.2 * NOTEBOOK_BODY_HEIGHT;
  return strokes.map((stroke, i) => {
    let result = stroke;
    for (const atStart of [true, false]) {
      if ((atStart && entry && i === 0) || (!atStart && i === exit)) continue;
      const end = atStart ? result[0] : result.at(-1);
      let best = null;
      strokes.forEach((other, j) => {
        if (j === i) return;
        for (const [x, y] of other) {
          const d = Math.hypot(x - end[0], y - end[1]);
          if (!best || d < best.d) best = { d, point: [x, y] };
        }
      });
      if (best && best.d > 4 && best.d <= reach)
        result = atStart ? [best.point, ...result] : [...result, best.point];
    }
    return result;
  });
}

function form(letter) {
  const written = writtenStrokes(letter);
  const healed = healBreaks(written.strokes, letter.entry, written.exit);
  const strokes = healed.map(stroke => stroke.map(([x, y]) => ({ x, y })));
  const lead = letter.entry ? leadIn(strokes) : undefined;
  // Digits and signs were followed by a dot or a space in the notes; in a
  // row of digits they keep their ink apart like separately written figures.
  const right = Math.max(...strokes.flat().map(p => p.x));
  const gap = /^\p{N}$/u.test(letter.char) ? 0.15 : /^\p{L}$/u.test(letter.char) ? 0 : 0.05;
  return {
    ...(lead ? { leadIn: lead } : {}),
    strokes,
    originX: 0,
    advance: Math.max(20, letter.advance, gap ? right + gap * NOTEBOOK_BODY_HEIGHT : 0),
    // Unjoined beginnings and endings keep their place in a word; joined
    // bodies (and letters written alone) can stand anywhere.
    position: !letter.entry && letter.exit ? 'initial' : letter.entry && !letter.exit ? 'final' : 'any',
    // The notebook page: letters written in one sitting share their style.
    style: `notebook-${letter.photo.replace(/\D/g, '')}`,
    joins: 'recorded',
    context: { before: letter.before, after: letter.after },
    source: letter.source,
    ...(letter.entry ? { entry: { stroke: 0, end: 'start' } } : {}),
    ...(letter.exit ? { exit: { stroke: written.exit, end: 'end' } } : {}),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

// Index zero is the plain glyph (handwriting variation off, formulas): use
// the joined form closest to the typical width and height of the letter.
function typicalFirst(forms) {
  const size = f => {
    const ys = f.strokes.flat().map(p => p.y);
    return { advance: f.advance, height: Math.max(...ys) - Math.min(...ys) };
  };
  const pool = forms.filter(f => f.position === 'any');
  const candidates = pool.length ? pool : forms;
  const sizes = candidates.map(size);
  const a = median(sizes.map(s => s.advance)) || 1, h = median(sizes.map(s => s.height)) || 1;
  let best = 0;
  sizes.forEach((s, i) => {
    const score = Math.abs(s.advance - a) / a + Math.abs(s.height - h) / h;
    const current = Math.abs(sizes[best].advance - a) / a + Math.abs(sizes[best].height - h) / h;
    if (score < current) best = i;
  });
  const first = candidates[best];
  return [first, ...forms.filter(f => f !== first)];
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))];
}

// Each word was scaled by its own measured x-height. That measurement is
// noisy, so letters taken from different words differ in size by up to a
// fifth, while a written word keeps one size. Every form is scaled about its
// baseline origin to the median height of its character: fully for letters
// whose top is the x-height, by half for tall letters (б, в, й, ё, ф) whose
// top is an ascender. Word-level size changes are added again in layout.
const TALL = new Set(Array.from('бвйёф'));
function normaliseSizes(forms) {
  for (const [char, list] of Object.entries(forms)) {
    if (!/^\p{Ll}$/u.test(char) || list.length < 5) continue;
    const tops = list.map(f => percentile(f.strokes.flat().map(p => p.y), 0.01));
    const median = percentile(tops, 0.5);
    forms[char] = list.flatMap((f, i) => {
      const ratio = median / tops[i];
      // A body far from its character's size is a broken trace, not a variant.
      if (!(ratio > 0.72 && ratio < 1.38)) return [];
      const s = Math.max(0.8, Math.min(1.25, TALL.has(char) ? Math.sqrt(ratio) : ratio));
      return [{ ...f, advance: f.advance * s,
        strokes: f.strokes.map(stroke => stroke.map(p => ({ ...p, x: +(p.x * s).toFixed(1), y: +(p.y * s).toFixed(1) }))) }];
    });
  }
  return forms;
}

// Points every 8 units along the strokes, centred on the median x.
function outline(form) {
  const points = [];
  for (const stroke of form.strokes)
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1], b = stroke[i];
      const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 8));
      for (let k = 0; k < n; k++) points.push([a.x + (b.x - a.x) * k / n, a.y + (b.y - a.y) * k / n]);
    }
  const middle = percentile(points.map(p => p[0]), 0.5);
  return points.map(([x, y]) => [x - middle, y]);
}

function chamfer(a, b) {
  const mean = (p, q) => {
    let total = 0;
    for (const [x, y] of p) {
      let best = Infinity;
      for (const [u, v] of q) { const d = (x - u) ** 2 + (y - v) ** 2; if (d < best) best = d; }
      total += Math.sqrt(best);
    }
    return total / p.length;
  };
  return (mean(a, b) + mean(b, a)) / 2;
}

// Tracing can merge strokes that touch on the photograph or join a letter
// with an unusual neighbour; such forms look unlike every other copy of
// the letter. Each form is compared with its nearest copies, and the least
// typical third of a well-covered letter (or a clear outlier of a rare one)
// is left out.
function dropAtypical(forms) {
  for (const [char, list] of Object.entries(forms)) {
    if (!/^\p{L}$/u.test(char) || list.length < 6) continue;
    const shapes = list.map(outline);
    const n = list.length, k = Math.max(2, Math.min(6, Math.floor(n / 5)));
    const distances = shapes.map(() => []);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const d = chamfer(shapes[i], shapes[j]);
      distances[i].push(d); distances[j].push(d);
    }
    const typical = distances.map(d => d.sort((a, b) => a - b).slice(0, k).reduce((a, b) => a + b, 0) / k);
    const median = percentile(typical, 0.5);
    const limit = n >= 12 ? Math.min(percentile(typical, 0.7), 1.35 * median) : 1.6 * median;
    forms[char] = list.filter((_, i) => typical[i] <= limit);
  }
  return forms;
}

/** @returns {Record<string, object[]>} */
export function notebookLetterForms(data, maximum = 128) {
  if (data.version !== 1 || data.unit !== 'gfont' || data.bodyHeight !== NOTEBOOK_BODY_HEIGHT)
    throw new Error('Unsupported notebook letter data.');
  const forms = {};
  for (const letter of data.letters) (forms[letter.char] ??= []).push(form(letter));
  normaliseSizes(forms);
  dropAtypical(forms);
  for (const char of Object.keys(forms)) forms[char] = typicalFirst(forms[char]).slice(0, maximum);
  return forms;
}
