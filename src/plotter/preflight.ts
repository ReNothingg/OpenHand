export interface PlotterLayoutSafety {
  strokes?: unknown[];
  missing?: unknown[];
  clipped?: boolean;
  startLineSafe?: boolean;
}

export interface PlotterPreflight {
  hasStrokes: boolean;
  hasMissingGlyphs: boolean;
  clipped: boolean;
  calibrated: boolean;
  originConfirmed: boolean;
  withinWorkArea: boolean;
  blockers: string[];
  warnings: string[];
  canStart: boolean;
}

/** Keeps the launch decision consistent across every way of starting a job. */
export function assessPlotterPreflight(
  layout: PlotterLayoutSafety | null | undefined,
  options: {
    calibrated: boolean;
    originConfirmed: boolean;
    withinWorkArea?: boolean;
    penReferenceConfirmed?: boolean;
    penPositionsVerified?: boolean;
  },
): PlotterPreflight {
  const hasStrokes = Boolean(layout?.strokes?.length);
  const hasMissingGlyphs = Boolean(layout?.missing?.length);
  const clipped = Boolean(layout?.clipped);
  const withinWorkArea = options.withinWorkArea !== false;
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!hasStrokes) blockers.push("В задании нет траекторий для рисования.");
  if (hasMissingGlyphs)
    blockers.push("В выбранном GFont отсутствуют символы из документа.");
  if (clipped)
    blockers.push("Часть документа выходит за пределы выбранного листа.");
  if (layout?.startLineSafe === false)
    blockers.push("Есть штрихи выше линии начала письма. Измените разметку перед запуском.");
  if (!withinWorkArea)
    blockers.push(
      "Траектория выходит за настроенную рабочую область плоттера.",
    );
  if (!options.originConfirmed)
    blockers.push("Нулевая точка плоттера не подтверждена.");
  if (options.penReferenceConfirmed === false)
    blockers.push("Укажите текущее положение пера во вкладке «Плоттер»: поднято или опущено.");
  if (options.penPositionsVerified === false)
    blockers.push("Сохраните проверенные верхнее и нижнее положения пера во вкладке «Плоттер».");
  if (!options.calibrated)
    warnings.push("Профиль ещё не прошёл калибровку.");

  return {
    hasStrokes,
    hasMissingGlyphs,
    clipped,
    calibrated: options.calibrated,
    originConfirmed: options.originConfirmed,
    withinWorkArea,
    blockers,
    warnings,
    canStart: blockers.length === 0,
  };
}
