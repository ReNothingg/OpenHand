// Convert traced notebook words (millimetres in each word's baseline frame)
// into GFont letter forms. Every form keeps the photographed geometry, its
// origin on the baseline, the step to the next letter and the connections
// that were actually written. Only one shear per source word aligns its
// measured slant with the writer's median slant, so letters from different
// pages can stand next to each other.

// One scale per source word keeps relative sizes and bearings intact. Pages
// written at different sizes share a 4.23 mm body at the default 32 CSS px.
export const NOTEBOOK_BODY_HEIGHT = 200;

const LETTER = /^\p{L}$/u;
const MARKS = new Set(Array.from('.,:;!?ёйЁЙі«»"\'-—–=+'));

function length(path) {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
  return total;
}

function stitch(source, tolerance) {
  const paths = source.map(path => path.map(point => [...point]));
  for (;;) {
    let best = null;
    for (let a = 0; a < paths.length; a++) for (let b = a + 1; b < paths.length; b++) {
      for (const reverseA of [false, true]) for (const reverseB of [false, true]) {
        const p = reverseA ? paths[a][0] : paths[a].at(-1);
        const q = reverseB ? paths[b].at(-1) : paths[b][0];
        const distance = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (distance <= tolerance && (!best || distance < best.distance)) best = { a, b, reverseA, reverseB, distance };
      }
    }
    if (!best) return paths;
    const first = best.reverseA ? [...paths[best.a]].reverse() : paths[best.a];
    const second = best.reverseB ? [...paths[best.b]].reverse() : paths[best.b];
    paths[best.a] = [...first, ...second.slice(best.distance < 1e-9 ? 1 : 0)];
    paths.splice(best.b, 1);
  }
}

// Remove raster stair steps; the displacement stays below a third of the
// ballpoint line width, so the written shape is not redrawn.
function smooth(path, sigma = .07, limit = .045) {
  const dense = [path[0]];
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / .03));
    for (let s = 1; s <= steps; s++) dense.push([a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps]);
  }
  const radius = Math.ceil(sigma * 3 / .03);
  return dense.map((point, index) => {
    if (!index || index === dense.length - 1) return point;
    let x = 0, y = 0, total = 0;
    for (let n = Math.max(0, index - radius); n <= Math.min(dense.length - 1, index + radius); n++) {
      const d = (n - index) * .03 / sigma;
      const w = Math.exp(-d * d / 2);
      x += dense[n][0] * w; y += dense[n][1] * w; total += w;
    }
    x /= total; y /= total;
    const shift = Math.hypot(x - point[0], y - point[1]);
    const k = Math.min(1, limit / Math.max(1e-9, shift));
    return [point[0] + (x - point[0]) * k, point[1] + (y - point[1]) * k];
  });
}

function simplify(points, tolerance) {
  if (points.length < 3) return points;
  const [ax, ay] = points[0], [bx, by] = points.at(-1);
  const dx = bx - ax, dy = by - ay, dd = dx * dx + dy * dy;
  let worst = 0, index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const [px, py] = points[i];
    const t = dd ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / dd)) : 0;
    const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    if (d > worst) { worst = d; index = i; }
  }
  if (worst <= tolerance) return [points[0], points.at(-1)];
  return [...simplify(points.slice(0, index + 1), tolerance).slice(0, -1), ...simplify(points.slice(index), tolerance)];
}

function nearest(paths, point) {
  let best = null;
  paths.forEach((path, stroke) => path.forEach((p, index) => {
    const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
    if (!best || d < best.d) best = { stroke, index, d };
  }));
  return best;
}

export function medianSlant(data) {
  const values = [];
  for (const word of data.words) {
    const letters = Array.from(word.text).filter(c => LETTER.test(c)).length;
    for (let i = 0; i < letters; i++) values.push(word.slant);
  }
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] ?? 0;
}

function position(chars, index) {
  const isLetter = value => Boolean(value && LETTER.test(value));
  if (!isLetter(chars[index])) return 'any';
  if (!isLetter(chars[index - 1])) return 'initial';
  return isLetter(chars[index + 1]) ? 'medial' : 'final';
}

/**
 * @returns {{ forms: Record<string, object[]>, slant: number }}
 */
export function notebookLetterForms(data, { slant = medianSlant(data), reject = {}, review = false } = {}) {
  if (data.version !== 1 || data.unit !== 'mm') throw new Error('Unsupported notebook stroke data.');
  const forms = {};
  for (const word of data.words) {
    const chars = Array.from(word.text);
    if (word.cuts.length !== chars.length + 1 || word.glyphs.length !== chars.length)
      throw new Error(`Invalid character boundaries: ${word.text}`);
    if ((!word.include && !review) || !(word.xHeight > 0)) throw new Error(`Unreviewed word: ${word.text}`);
    const unitsPerMm = NOTEBOOK_BODY_HEIGHT / word.xHeight;
    const shear = slant - word.slant;
    chars.forEach((char, index) => {
      if (word.include && !word.include.includes(index)) return;
      if (reject[`${word.index}:${index}`]) return;
      const origin = word.cuts[index];
      const local = ([u, v]) => [u - origin - shear * (v - word.baselineOffset), v - word.baselineOffset];
      const minimum = MARKS.has(char) || !LETTER.test(char) ? .05 : .25;
      let paths = stitch(word.glyphs[index].map(path => path.map(local)), .09)
        .filter(path => length(path) >= minimum);
      if (!paths.length) return;
      paths = paths.map(path => simplify(smooth(path), .012));
      const anchorFor = (points, end) => {
        if (!points?.length) return undefined;
        // Several crossings: the lowest one is the connecting stroke.
        const point = local(points.reduce((a, b) => (b[1] > a[1] ? b : a)));
        const hit = nearest(paths, point);
        return hit && hit.d < .35 ? { ...hit, end } : undefined;
      };
      let entry = anchorFor(word.joins[index].entry, 'start');
      let exit = anchorFor(word.joins[index].exit, 'end');
      // Orient connected strokes: the entry starts a stroke, the exit ends one.
      if (entry && exit && entry.stroke === exit.stroke && entry.index > exit.index) {
        const last = paths[entry.stroke].length - 1;
        paths[entry.stroke].reverse();
        entry.index = last - entry.index;
        exit.index = last - exit.index;
      }
      if (entry && entry.index === paths[entry.stroke].length - 1 && !(exit && exit.stroke === entry.stroke)) {
        paths[entry.stroke].reverse();
        entry.index = 0;
      }
      if (exit && exit.index === 0 && !(entry && entry.stroke === exit.stroke)) {
        paths[exit.stroke].reverse();
        exit.index = paths[exit.stroke].length - 1;
      }
      // Pen order: entry stroke first, exit stroke last, the rest left to right.
      const order = paths.map((_, i) => i).sort((a, b) => {
        const rank = i => (entry && i === entry.stroke ? -1 : exit && i === exit.stroke ? 1 : 0);
        if (rank(a) !== rank(b)) return rank(a) - rank(b);
        return Math.min(...paths[a].map(p => p[0])) - Math.min(...paths[b].map(p => p[0]));
      });
      for (const stroke of order.map(i => paths[i])) {
        // Unconnected strokes are written left to right / top to bottom.
        if (stroke === paths[entry?.stroke] || stroke === paths[exit?.stroke]) continue;
        const [a, b] = [stroke[0], stroke.at(-1)];
        if (a[0] - b[0] > Math.abs(a[1] - b[1]) * .6 || (Math.abs(a[0] - b[0]) < .2 && a[1] > b[1] + .3)) stroke.reverse();
      }
      const remap = anchor => anchor && { stroke: order.indexOf(anchor.stroke), end: anchor.end,
        ...(anchor.index > 0 && anchor.index < paths[anchor.stroke].length - 1 ? { point: anchor.index } : {}) };
      const strokes = order.map(i => paths[i].map(([x, y]) => ({
        x: +(x * unitsPerMm).toFixed(2), y: +(y * unitsPerMm).toFixed(2) })));
      const ys = strokes.flat().map(p => p.y / NOTEBOOK_BODY_HEIGHT);
      const above = -Math.min(...ys), below = Math.max(...ys);
      const upperLimit = /^[\p{Lu}]$/u.test(char) || 'бв'.includes(char) ? 3.2
        : 'ёйф'.includes(char) ? 2.1 : 1.55;
      const lowerLimit = 'дзуфрцщ'.includes(char) ? 2.7 : .6;
      // Intersection with another line, or a body reduced to a join, is never
      // silently admitted. Reviewed source geometry remains in the dataset.
      const implausible = above > upperLimit || below > lowerLimit || above + below < .45 ||
        ('бв'.includes(char) && above < 1.4) || ('друфц'.includes(char) && below < .4);
      if (implausible && !review) return;
      const form = {
        strokes,
        originX: 0,
        advance: +((word.cuts[index + 1] - origin) * unitsPerMm).toFixed(2),
        position: position(chars, index),
        style: 'notebook',
        // Source crossings are preferred. Unseen lowercase joins in new
        // combinations use the normal anchor search; capitals keep pen lifts.
        ...(/^\p{Lu}$/u.test(char) ? { joins: 'recorded' } : {}),
        context: {
          before: chars[index - 1]?.match(/^[\p{L}\p{N}]$/u)?.[0] || '',
          after: chars[index + 1]?.match(/^[\p{L}\p{N}]$/u)?.[0] || '',
        },
        ...(entry ? { entry: remap(entry) } : {}),
        ...(exit ? { exit: remap(exit) } : {}),
        source: { word: word.index, char: index, photo: word.photo },
        ...(review ? { implausible, reviewed: Boolean(word.reviewed && word.include?.includes(index)) } : {}),
      };
      (forms[char] ??= []).push(form);
    });
  }
  return { forms, slant };
}

/** Up to twelve actual alternatives (the GFont reader limit), covering endings
 * and different photographed words. */
export function selectNotebookForms(captured, maximum = 12) {
  const selected = {};
  for (const [char, candidates] of Object.entries(captured)) {
    const joined = f => Boolean(f.entry && f.exit);
    const primary = candidates.find(f => f.position === 'medial' && joined(f)) ||
      candidates.find(f => f.position === 'initial') || candidates[0];
    const chosen = [primary];
    const add = candidate => { if (candidate && !chosen.includes(candidate) && chosen.length < maximum) chosen.push(candidate); };
    // Word endings and beginnings have their own shapes; keep a few of each.
    for (const position of ['final', 'initial'])
      candidates.filter(f => f.position === position).slice(0, 3).forEach(add);
    // Then connected bodies from as many different pages as possible.
    for (const candidate of candidates)
      if (joined(candidate) && !chosen.some(f => f.source.photo === candidate.source.photo)) add(candidate);
    for (const candidate of candidates) if (joined(candidate)) add(candidate);
    for (const candidate of candidates) add(candidate);
    selected[char] = chosen.map((form, index) => ({ ...form,
      // A normal body works at the beginning too. Keeping all medial forms
      // restricted made isolated repeated letters reuse only one recorded shape.
      position: !index || form.position === 'medial' ? 'any' : form.position,
    }));
  }
  return selected;
}
