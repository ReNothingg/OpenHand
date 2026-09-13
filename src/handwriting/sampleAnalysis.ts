import type { FontStroke } from '../font-builder/penInput';

export const SAMPLE_WORDS = ['мама', 'пишет', 'конспект'];
export const SAMPLE_PROMPTS = [...SAMPLE_WORDS, 'мама пишет конспект'];
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));
function quantile(values: number[], q: number) { const a = [...values].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * q))] || 0; }

export function analyzeSamples(samples: FontStroke[][]) {
  const complete = samples.slice(0, 3).filter(s => s?.flat().length >= 8);
  if (complete.length < SAMPLE_WORDS.length) return null;
  const slopes: number[] = [], widths: number[] = [], baseline: number[] = [], pressures: number[] = [], speeds: number[] = [];
  complete.forEach((strokes, i) => {
    const points = strokes.flat();
    const ys = points.map(p => p.y);
    const top = quantile(ys, .15), bottom = quantile(ys, .85), height = bottom - top;
    if (height < 10) return;
    const xs = points.map(p => p.x);
    widths.push((Math.max(...xs) - Math.min(...xs)) / SAMPLE_WORDS[i].length / height);
    strokes.forEach(s => s.forEach((p, j) => {
      if (p.pressure !== undefined) pressures.push(p.pressure);
      if (p.y > bottom - height * .12) baseline.push((p.y - bottom) / height);
      const prev = s[j - 1];
      if (!prev) return;
      const dx = p.x - prev.x, dy = p.y - prev.y;
      if (Math.abs(dy) > 2 && Math.abs(dx / dy) < .65) slopes.push(-dx / dy);
      const dt = (p.time ?? 0) - (prev.time ?? 0);
      if (dt > 0 && dt < 200) speeds.push(Math.hypot(dx, dy) / dt);
    }));
  });
  if (widths.length !== SAMPLE_WORDS.length) return null;
  const slant = Math.round(Math.atan(quantile(slopes, .5)) * 180 / Math.PI);
  const rhythm = speeds.length ? clamp(Math.round((quantile(speeds, .8) / Math.max(.01, quantile(speeds, .5)) - 1) * 40), 10, 70) : 30;
  const line = samples[3] || [];
  const lineYs = line.flat().map(p => p.y);
  const height = quantile(lineYs, .85) - quantile(lineYs, .15);
  const intervals = line.filter(s => s.length > 1).map(s => ({ start: Math.min(...s.map(p => p.x)), end: Math.max(...s.map(p => p.x)) })).sort((a, b) => a.start - b.start);
  const gaps: number[] = [];
  let right = intervals[0]?.end || 0;
  intervals.slice(1).forEach(i => { if (i.start - right > height * .15) gaps.push(i.start - right); right = Math.max(right, i.end); });
  // Only infer spaces when the three-word sentence has exactly two clear gaps.
  const measuredSpacing = height > 10 && gaps.length === 2;
  return { settings: { authorSlant: clamp(slant, -18, 22), authorWidth: Math.round(clamp(quantile(widths, .5) / .65 * 100, 78, 122)), authorBaseline: Math.round(clamp((quantile(baseline, .9) - quantile(baseline, .1)) * 100, 5, 65)), authorRhythm: rhythm, wordCoherence: 80, ...(measuredSpacing ? { wordSpacing: Math.round(clamp(quantile(gaps, .5) / height / .84 * 100, 55, 160)) } : {}), pressureVariation: pressures.length ? Math.round(clamp((quantile(pressures, .85) - quantile(pressures, .15)) * 50, 0, 35)) : 18, trueHandwriting: true, handwritingProfile: 'personal' }, measuredPressure: pressures.length > 0, measuredTiming: speeds.length > 0, measuredSpacing };
}
