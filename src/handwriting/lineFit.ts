export type WordGap = { start: number; end: number };

/** Fit one whole line, with one compression budget (never once per word). */
export function fitHandwritingLine(
  left: number,
  right: number,
  availableRight: number,
  gaps: WordGap[],
  compressionPercent: number,
) {
  const width = right - left;
  const available = availableRight - left;
  const limit = Math.max(0, Math.min(28, Number(compressionPercent) || 0)) / 100;
  if (![width, available].every(Number.isFinite) || available <= 0) return null;
  // Merge overlaps so malformed/repeated whitespace cannot buy extra capacity.
  const spaces: WordGap[] = [];
  for (const gap of [...gaps].sort((a, b) => a.start - b.start)) {
    const start = Math.max(left, gap.start), end = Math.min(right, gap.end);
    if (!(end > start)) continue;
    const previous = spaces.at(-1);
    if (previous && start <= previous.end) previous.end = Math.max(previous.end, end);
    else spaces.push({ start, end });
  }
  const gapWidth = spaces.reduce((sum, gap) => sum + gap.end - gap.start, 0);
  const deficit = Math.max(0, width - available);
  // Tighten spaces first, but only moderately: in the notebook photographs a
  // crowded line end keeps clearly separated words and narrows letters instead.
  const gapReduction = gapWidth ? Math.min(limit * 1.25, 0.3, deficit / gapWidth) : 0;
  const tightened = width - gapWidth * gapReduction;
  const scale = tightened > available ? available / tightened : 1;
  if (scale < 1 - limit - 1e-9) return null;
  return {
    scale, gapReduction,
    mapX(value: number) {
      let removed = 0;
      for (const gap of spaces)
        removed += Math.max(0, Math.min(value, gap.end) - gap.start) * gapReduction;
      return left + (value - left - removed) * scale;
    },
  };
}
