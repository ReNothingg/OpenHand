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
    style: 'notebook',
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

/** @returns {Record<string, object[]>} */
export function notebookLetterForms(data, maximum = 128) {
  if (data.version !== 1 || data.unit !== 'gfont' || data.bodyHeight !== NOTEBOOK_BODY_HEIGHT)
    throw new Error('Unsupported notebook letter data.');
  const forms = {};
  for (const letter of data.letters) (forms[letter.char] ??= []).push(form(letter));
  for (const char of Object.keys(forms)) forms[char] = typicalFirst(forms[char]).slice(0, maximum);
  return forms;
}
