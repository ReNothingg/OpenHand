export function writingStartLimit(settings, height: number) {
  const line = Math.max(
    20,
    (Number(settings.fontSize) || 27) * (Number(settings.lineHeight) || 1.55),
  );
  return Math.max(
    0,
    height - Math.max(0, Number(settings.marginBottom) || 0) - line,
  );
}

export function writingStartY(settings, height: number, sheet: number) {
  const custom = settings.writingStartEnabled && sheet === settings.writingStartPage
    ? settings.writingStartPositions?.[String(sheet)] : undefined;
  const value =
    typeof custom === "number" && Number.isFinite(custom)
      ? custom
      : Number(settings.marginTop) || 0;
  return Math.max(0, Math.min(writingStartLimit(settings, height), value));
}

export function physicalSheetIndex(settings, logicalPage: number) {
  return settings.pageSize === "NotebookSpread"
    ? Math.floor(logicalPage / 2)
    : logicalPage;
}

export function minStrokeY(strokes): number {
  let minimum = Infinity;
  for (const stroke of strokes || [])
    for (const point of stroke) minimum = Math.min(minimum, point.y);
  return minimum;
}
