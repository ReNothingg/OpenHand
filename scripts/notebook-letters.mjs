// Letter forms traced from the notebook photographs by
// scripts/trace-notebook-letters.py (GFont units, x-height 200). Every form
// is one written letter with its origin on the cut where the previous letter
// joined it (or at its body when it was written without a join), the step to
// the next cut and the side it was joined on.

export const NOTEBOOK_BODY_HEIGHT = 200;

// Where letters written after a pen lift meet. A letter starts with its
// x-height body: loops of р, у, д, з reach back under the previous letter.
// It ends with its lower body: the tops of б, в, д curl over the next one.
const inBody = p => p.y > -1.05 * NOTEBOOK_BODY_HEIGHT && p.y < 0.25 * NOTEBOOK_BODY_HEIGHT;
const inLowerBody = p => p.y > -0.6 * NOTEBOOK_BODY_HEIGHT && p.y < 0.25 * NOTEBOOK_BODY_HEIGHT;

// The join that leads into a letter from the previous one: the shallow
// start of the first stroke, up to where the letter's own stroke turns steep
// (more than about 50 degrees), turns back or reaches half the body. Letters
// whose own stroke starts at the top of the body (з, э, ч, у, ж, х, я) are
// joined by a diagonal up to that top; their join is followed up to it.
const TOP_START = new Set(Array.from('зэчужхя'));
// These letters start with a stem written upwards from the join (the first
// stem of м, т, н, и, л…). The slanted stem is not steeper than 50 degrees,
// so the join ends where the stroke leaves the baseline: everything above
// it is the stem, and cutting at half the body made т read as п, м as ч.
const STEM_START = new Set(Array.from('ийлмнптцшщыьъю'));
function stemLeadIn(first) {
  const rise = first.findIndex(p => p.y < -0.2 * NOTEBOOK_BODY_HEIGHT);
  if (rise <= 0) return undefined;
  // The lowest point before the rise is where the stem begins.
  let low = 0;
  for (let k = 1; k < rise; k++) if (first[k].y >= first[low].y) low = k;
  if (first[low].x - first[0].x < 0.12 * NOTEBOOK_BODY_HEIGHT) return undefined;
  // Keep a short foot of the join, as a pen starting a word leaves one.
  let j = low;
  while (j > 1 && first[low].x - first[j - 1].x <= 0.1 * NOTEBOOK_BODY_HEIGHT) j--;
  return j > 0 ? j : undefined;
}
function leadIn(strokes, char) {
  const first = strokes[0];
  if (!first || first.length < 4) return undefined;
  if (STEM_START.has(char)) return stemLeadIn(first);
  const start = first[0];
  const reach = (TOP_START.has(char) ? 0.85 : 0.5) * NOTEBOOK_BODY_HEIGHT;
  for (let i = 1; i < first.length - 1; i++) {
    const a = first[i - 1], b = first[Math.min(first.length - 1, i + 2)];
    const dx = b.x - a.x, dy = a.y - b.y;
    if (dx <= 0 || dy > 1.2 * dx || start.y - first[i].y > reach) {
      // A join that runs on under the letter (into the bottom of о, а) ends
      // where it reaches the letter's own ink, not where it turns up.
      const body = [...first.slice(i + 1), ...strokes.slice(1).flat()].filter(inBody);
      const left = body.length ? Math.min(...body.map(p => p.x)) : first[i].x;
      if (first[i].x > left + 0.15 * NOTEBOOK_BODY_HEIGHT) {
        const enter = first.findIndex(p => p.x >= left);
        if (enter > 0 && enter < i) i = enter;
      }
      // Where the join already touches the rest of the letter it closes a
      // loop (the bowl of д, о, а) or forms its back (с): keep it from there.
      const rest = [...first.slice(i + 1), ...strokes.slice(1).flat()];
      const touch = first.findIndex((p, j) => j > 0 && j < i &&
        rest.some(q => Math.hypot(q.x - p.x, q.y - p.y) < 0.08 * NOTEBOOK_BODY_HEIGHT));
      if (touch > 0) i = touch;
      if (first[i].x - start.x < 0.12 * NOTEBOOK_BODY_HEIGHT) return undefined;
      // Keep a short hook of the join, as a pen starting a word leaves one,
      // when it starts low; higher up a hook would read as a stroke (о as э).
      let j = i;
      if (first[i].y > -0.3 * NOTEBOOK_BODY_HEIGHT)
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
// letter: the cursive lowercase letters have no strokes this short. A short
// piece that ends at the rest of the letter is part of it, though: thinning
// splits a stem where the join or a crossbar meets it (the lower half of the
// first stem of н, м, т), and without it the letter reads as к or ч. The
// strokes that carry the joins are always kept.
function writtenStrokes(letter) {
  const exit = letter.exit ? letter.exitStroke ?? letter.strokes.length - 1 : -1;
  if (!/^\p{Ll}$/u.test(letter.char) || ACCENTED.has(letter.char) || letter.strokes.length < 2)
    return { strokes: letter.strokes, exit };
  const attached = i => [letter.strokes[i][0], letter.strokes[i].at(-1)].some(([x, y]) =>
    letter.strokes.some((other, j) => j !== i && other.some(([u, v]) =>
      Math.hypot(u - x, v - y) <= 0.25 * NOTEBOOK_BODY_HEIGHT)));
  const keep = letter.strokes.map((stroke, i) => (letter.entry && i === 0) || i === exit ||
    inkLength(stroke) >= 0.35 * NOTEBOOK_BODY_HEIGHT ||
    (inkLength(stroke) >= 0.1 * NOTEBOOK_BODY_HEIGHT && attached(i)));
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
  const reach = 0.25 * NOTEBOOK_BODY_HEIGHT;
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

// The words were sheared to one reference slant, but measured on whole lines
// of the photographs the notes lean further (projection slant 0.60 against
// 0.48 for the rebuilt letters). One extra shear about the baseline restores
// it; letters keep their joins because entry and exit lie near the baseline.
export const NOTEBOOK_EXTRA_SLANT = 0.12;

function form(letter) {
  const written = writtenStrokes(letter);
  const healed = healBreaks(written.strokes, letter.entry, written.exit);
  let strokes = healed.map(stroke => stroke.map(([x, y]) => ({ x: +(x - NOTEBOOK_EXTRA_SLANT * y).toFixed(1), y })));
  const isLetter = /^\p{L}$/u.test(letter.char);
  // A letter written without a join starts at its body.
  let shift = 0;
  if (isLetter && !letter.entry) {
    const body = strokes.flat().filter(inBody);
    shift = body.length ? Math.min(...body.map(p => p.x)) : 0;
    strokes = strokes.map(stroke => stroke.map(p => ({ ...p, x: +(p.x - shift).toFixed(1) })));
  }
  let lead = letter.entry ? leadIn(strokes, letter.char) : undefined;
  // The cut must only remove the join. A cut that takes away ink of the
  // letter's upper body (the left of the bowl of о, the first stem of и) is
  // dropped: such a form keeps its join and is not used to start a word.
  if (lead !== undefined && !TOP_START.has(letter.char)) {
    const upper = list => list.reduce((sum, stroke) => sum + stroke.slice(1).reduce((s, p, i) =>
      s + ((p.y + stroke[i].y) / 2 < -0.3 * NOTEBOOK_BODY_HEIGHT ? Math.hypot(p.x - stroke[i].x, p.y - stroke[i].y) : 0), 0), 0);
    if (upper([strokes[0].slice(lead), ...strokes.slice(1)]) < 0.85 * upper(strokes)) lead = undefined;
  }
  // Digits and signs were followed by a dot or a space in the notes; in a
  // row of digits they keep their ink apart like separately written figures.
  // After a pen lift the author starts the next letter right at the body of
  // the previous one (the photographed bodies touch in most lifts).
  const lower = strokes.flat().filter(inLowerBody);
  const right = Math.max(...(lower.length ? lower : strokes.flat()).map(p => p.x));
  const gap = /^\p{N}$/u.test(letter.char) ? 0.15 : 0.05;
  const advance = isLetter
    ? (letter.exit ? letter.advance - shift : right + gap * NOTEBOOK_BODY_HEIGHT)
    : Math.max(letter.advance, right + gap * NOTEBOOK_BODY_HEIGHT);
  return {
    ...(lead ? { leadIn: lead } : {}),
    strokes,
    originX: 0,
    advance: Math.max(20, advance),
    // Where the letter stood in its word. A letter inside a word can still
    // be followed by a pen lift (the author lifts after р, д, з, т and in a
    // quarter of all pairs); its missing exit is part of the handwriting.
    position: !letter.before && !letter.after ? 'any' : !letter.before ? 'initial' : !letter.after ? 'final' : 'medial',
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
  const pool = forms.filter(f => f.entry && f.exit);
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

// The stems of a letter lean at the angle of the strokes down through the
// body: the length-weighted median of dx/dy over steep pieces between the
// baseline and the x-height (positive leans right).
function stemSlant(strokes) {
  const pieces = [];
  for (const stroke of strokes)
    for (let i = 1; i < stroke.length; i++) {
      const a = stroke[i - 1], b = stroke[i];
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      const middle = (a.y + b.y) / 2;
      if (length < 1 || middle < -0.92 * NOTEBOOK_BODY_HEIGHT || middle > -0.08 * NOTEBOOK_BODY_HEIGHT) continue;
      const slant = -dx / dy;
      if (Math.abs(dy) > 1.2 * Math.abs(dx + 0.6 * dy) && slant > -0.2 && slant < 1.3) pieces.push([slant, length]);
    }
  if (pieces.length < 2) return null;
  pieces.sort((p, q) => p[0] - q[0]);
  const half = pieces.reduce((sum, [, length]) => sum + length, 0) / 2;
  let sum = 0;
  for (const [slant, length] of pieces) if ((sum += length) >= half) return slant;
  return null;
}

// Where the body sits: the median of the low turning points of the strokes
// near the baseline (descender loops and their tails are below this band).
function bodyBase(strokes) {
  const lows = [];
  for (const stroke of strokes)
    for (let i = 1; i < stroke.length - 1; i++) {
      const y = stroke[i].y;
      if (y >= stroke[i - 1].y && y >= stroke[i + 1].y && y > -0.35 * NOTEBOOK_BODY_HEIGHT && y < 0.22 * NOTEBOOK_BODY_HEIGHT) lows.push(y);
    }
  return lows.length ? median(lows) : null;
}

// A letter keeps the slant and the baseline of the word it was cut from, and
// those were measured per word with some error. Side by side in a new word,
// letters from different words then lean and sit unevenly, while the
// author's stems run parallel and the bodies stand on one line. Each form is
// moved to its letter's median sitting height, and a letter with straight
// stems is sheared about the baseline to its letter's median stem slant; its
// joins move with it. Round letters (о, с, е, а, з, в, б, д…) have no stem to
// measure, so their own slant is kept.
const STEM_LETTERS = new Set(Array.from('иклмнпртуцчшщъыьйгя'));
function alignForms(forms) {
  for (const [char, list] of Object.entries(forms)) {
    if (!/^\p{Ll}$/u.test(char) || list.length < 5) continue;
    const slants = list.map(f => STEM_LETTERS.has(char) ? stemSlant(f.strokes) : null);
    const bases = list.map(f => bodyBase(f.strokes));
    const known = values => values.filter(v => v !== null);
    const slant = known(slants).length >= 3 ? median(known(slants)) : null;
    const base = known(bases).length >= 3 ? median(known(bases)) : null;
    forms[char] = list.map((f, i) => {
      const shear = slant === null || slants[i] === null ? 0 : Math.max(-0.25, Math.min(0.25, slant - slants[i]));
      const lift = base === null || bases[i] === null ? 0 : Math.max(-0.1, Math.min(0.1, (base - bases[i]) / NOTEBOOK_BODY_HEIGHT)) * NOTEBOOK_BODY_HEIGHT;
      if (!shear && !lift) return f;
      const move = p => ({ ...p, x: +(p.x - shear * p.y).toFixed(1), y: +(p.y + lift).toFixed(1) });
      const strokes = f.strokes.map(stroke => stroke.map(move));
      // The step to the next letter follows the exit (or, after a lift, the
      // right edge of the lower body).
      let shift;
      if (f.exit) {
        const end = f.strokes[f.exit.stroke].at(-1);
        shift = -shear * end.y;
      } else {
        const right = list => Math.max(...list.filter(inLowerBody).map(p => p.x));
        shift = f.strokes.flat().some(inLowerBody) ? right(strokes.flat()) - right(f.strokes.flat()) : 0;
      }
      return { ...f, strokes, advance: Math.max(20, +(f.advance + shift).toFixed(1)) };
    });
  }
  return forms;
}

// Every letter of the notes reaches the same x-height (photographs of
// "через", "пружинный", "случае"), but the traced у, ч, з, ж come out a fifth
// lower and е, я a little higher: tracing shortens the free stroke ends at the
// top. Each such letter is stretched vertically to the common height of the
// body letters, with its stems kept at their slant; its width stays as written.
const BODY_LETTERS = new Set(Array.from('аегжзиклмнопрстухцчшщъыьэюя'));
function evenHeights(forms) {
  const topOf = f => percentile(f.strokes.flat().map(p => p.y), 0.01);
  const letters = Object.keys(forms).filter(char => BODY_LETTERS.has(char) && forms[char].length);
  const tops = Object.fromEntries(letters.map(char => [char, median(forms[char].map(topOf))]));
  const common = median(letters.filter(char => forms[char].length >= 5).flatMap(char => forms[char].map(topOf)));
  for (const char of letters) {
    const k = Math.max(0.85, Math.min(1.25, common / tops[char]));
    if (Math.abs(k - 1) < 0.02) continue;
    const slants = forms[char].map(f => stemSlant(f.strokes)).filter(v => v !== null);
    const slant = slants.length ? median(slants) : 0;
    forms[char] = forms[char].map(f => ({ ...f,
      strokes: f.strokes.map(stroke => stroke.map(p => ({ ...p,
        x: +(p.x - slant * (k - 1) * p.y).toFixed(1), y: +(p.y * k).toFixed(1) }))) }));
  }
  return forms;
}

// Each word was scaled by its own measured x-height. That measurement is
// noisy, so letters taken from different words differ in size by up to a
// fifth, while a written word keeps one size. Every form is scaled about its
// baseline origin to the median height of its character: fully for letters
// whose top is the x-height, by half for tall letters (б, в, й, ё, ф) whose
// top is an ascender. Word-level size changes are added again in layout.
const TALL = new Set(Array.from('бвйёф'));
// The top of д is its upper loop, written round at the x-height or tall and
// narrow above it, so its height says nothing about the size of the word.
const FREE_TOP = new Set(Array.from('д'));
function normaliseSizes(forms) {
  for (const [char, list] of Object.entries(forms)) {
    if (!/^\p{Ll}$/u.test(char) || list.length < 5 || FREE_TOP.has(char)) continue;
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

/** @returns {Record<string, object[]>} */
export function notebookLetterForms(data, maximum = 256, liftRates = {}) {
  if (data.version !== 1 || data.unit !== 'gfont' || data.bodyHeight !== NOTEBOOK_BODY_HEIGHT)
    throw new Error('Unsupported notebook letter data.');
  const forms = {};
  for (const letter of data.letters) {
    const result = form(letter);
    if (liftRates[letter.char] !== undefined) result.lift = liftRates[letter.char];
    (forms[letter.char] ??= []).push(result);
  }
  // Every form was reviewed against its photograph (broken traces are not
  // accepted in notebook-letter-words.json). The forms are brought to their
  // letter's size, aligned, then brought back to their letter's height.
  normaliseSizes(forms);
  alignForms(forms);
  normaliseSizes(forms);
  evenHeights(forms);
  for (const char of Object.keys(forms)) forms[char] = typicalFirst(forms[char]).slice(0, maximum);
  return forms;
}
