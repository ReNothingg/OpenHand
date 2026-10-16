// A school notebook spread: 5 mm squares that start at the sheet's upper-left
// corner and a red margin line near each outer edge. Text sits on the squares
// the way it is written by hand: every baseline on a horizontal rule, lines a
// whole number of squares apart, each page between its outer margin and the
// spine, mirrored on the right page.

const PX_PER_MM = 96 / 25.4;

export const NOTEBOOK_CELL_MM = 5;
export const NOTEBOOK_CELL_PX = NOTEBOOK_CELL_MM * PX_PER_MM;
/** Red margin line, from the outer edge of either page. */
export const NOTEBOOK_MARGIN_LINE_PX = 62;
/** Free space next to the spine. */
export const NOTEBOOK_SPINE_GAP_PX = 24;
/** A line may come this much closer than asked before it moves a whole square down. */
const LINE_TOLERANCE = 0.3;

export function isNotebookSpread(settings: { pageSize?: string }) {
  return settings.pageSize === "NotebookSpread";
}

function cells(px: number) {
  return px / NOTEBOOK_CELL_PX;
}

/** Distance between baselines: the requested line height rounded to whole squares. */
export function notebookLinePitchPx(fontSize: number, lineHeight: number) {
  const requested = (Number(fontSize) || 27) * (Number(lineHeight) || 1.35);
  return Math.max(1, Math.ceil(cells(requested) - LINE_TOLERANCE)) * NOTEBOOK_CELL_PX;
}

/** CSS line-height multiplier that keeps screen lines on the same squares. */
export function notebookLineHeight(fontSize: number, lineHeight: number) {
  return notebookLinePitchPx(fontSize, lineHeight) / Math.max(1, Number(fontSize) || 27);
}

/** The first rule at or below `y`, allowing for the line tolerance. */
export function snapDownToRule(y: number, cellSize: number) {
  return Math.max(1, Math.ceil(y / cellSize - LINE_TOLERANCE)) * cellSize;
}

/** Advance between two baselines rounded to whole squares (never zero). */
export function snapLineAdvance(advance: number, cellSize: number) {
  return Math.max(1, Math.ceil(advance / cellSize - LINE_TOLERANCE)) * cellSize;
}

/** Text column width that fits a page of the spread, in whole squares. */
export function notebookColumnWidth(settings, spreadWidth: number) {
  const outer = notebookOuterMargin(settings);
  const available = spreadWidth / 2 - outer - NOTEBOOK_SPINE_GAP_PX;
  const requested = Math.min(Number(settings.textWidth) || available, available);
  return Math.max(NOTEBOOK_CELL_PX * 8, Math.floor(cells(requested) + 1e-6) * NOTEBOOK_CELL_PX);
}

/** Outer margin of both pages, on a vertical rule. */
export function notebookOuterMargin(settings) {
  return Math.max(1, Math.round(cells(Number(settings.marginLeft) || 0))) * NOTEBOOK_CELL_PX;
}

/** Left edge and width of the text on one page of the spread, in px. */
export function notebookColumn(settings, spreadWidth: number, side: "left" | "right") {
  const width = notebookColumnWidth(settings, spreadWidth);
  const outer = notebookOuterMargin(settings);
  if (side === "left") return { left: outer, width };
  // Mirror the left page, then put the start on a vertical rule. Rounding
  // down keeps the end clear of the right margin line.
  const left = Math.floor(cells(spreadWidth - outer - width) + 1e-6) * NOTEBOOK_CELL_PX;
  return { left, width };
}
