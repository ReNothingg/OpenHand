import { createPenCommand } from "./job";

export interface PaperChange {
  completedLabel: string;
  nextLabel: string;
  nextSheet: number;
  completedCount: number;
  totalSheets: number;
}

export function sheetLabel(index: number, spread: boolean) {
  return spread
    ? `Страницы ${index * 2 + 1}–${index * 2 + 2}`
    : `Лист ${index + 1}`;
}

export function createSheetQueue(
  jobs,
  indices: number[],
  config,
  spread: boolean,
) {
  if (!["grbl", "marlin"].includes(config.profile))
    throw new Error(
      "Очередь с ожиданием смены бумаги доступна для GRBL и Marlin.",
    );
  if (
    !indices.length ||
    indices.length > 100 ||
    indices.some(
      (n, i) =>
        !Number.isInteger(n) ||
        n < 0 ||
        n >= jobs.length ||
        (i > 0 && n <= indices[i - 1]),
    )
  )
    throw new Error("Выберите от 1 до 100 листов в порядке документа.");
  if (indices.length === 1) {
    const sheet = indices[0];
    const job = jobs[sheet];
    if (!job?.commands?.length || !job.strokes?.length || job.withinWorkArea === false)
      throw new Error(`${sheetLabel(sheet, spread)}: нет безопасной траектории.`);
    return { ...job, source: "document", sheetIndices: [...indices], totalSheets: 1,
      sheetRanges: [{ sheet, start: 0, end: job.commands.length }], barriers: [], paperChanges: [] };
  }
  const resumePoints: number[] = [];
  const commands: string[] = [];
  const barriers: number[] = [];
  const sheetRanges: Array<{ sheet: number; start: number; end: number }> = [];
  const paperChanges: Array<{ after: number; change: PaperChange }> = [];
  indices.forEach((sheet, position) => {
    const start = commands.length;
    const job = jobs[sheet];
    if (
      !job?.commands?.length ||
      !job.strokes?.length ||
      job.withinWorkArea === false
    )
      throw new Error(
        `${sheetLabel(sheet, spread)}: нет безопасной траектории.`,
      );
    commands.push(
      ...job.commands,
      "G21",
      "G90",
      ...createPenCommand(true, config),
      config.profile === "grbl" ? "G4P0.01" : "M400",
    );
    resumePoints.push(...(job.resumePoints || []).map((point: number) => start + point));
    barriers.push(commands.length);
    if (position < indices.length - 1) resumePoints.push(commands.length);
    sheetRanges.push({ sheet, start, end: commands.length });
    if (position < indices.length - 1)
      paperChanges.push({
        after: commands.length,
        change: {
          completedLabel: sheetLabel(sheet, spread),
          nextLabel: sheetLabel(indices[position + 1], spread),
          nextSheet: indices[position + 1],
          completedCount: position + 1,
          totalSheets: indices.length,
        },
      });
  });
  return {
    id: `sheets:${indices.map((i) => jobs[i].id).join(":")}`,
    commands,
    barriers,
    sheetRanges,
    paperChanges,
    totalSheets: indices.length,
    source: "document",
    sheetIndices: [...indices],
    recoverable: indices.every(index => jobs[index].recoverable !== false),
    resumePoints: [...new Set(resumePoints)].sort((a, b) => a - b),
    resumePrefix: jobs[indices[0]].resumePrefix || [],
  };
}
