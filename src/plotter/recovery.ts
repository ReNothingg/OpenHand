export interface PlotterRecoveryState {
  checkpointVersion: 2;
  jobId: string;
  current: number;
  total: number;
  profile: string;
  updatedAt?: number;
  sheetIndices?: number[];
}

export interface RecoverablePlotterJob {
  id: string;
  commands: unknown[];
  recoverable?: boolean;
  resumePoints?: number[];
  sheetIndices?: number[];
}

export function normalizeRecoveryState(
  value: Partial<PlotterRecoveryState> | null | undefined,
): PlotterRecoveryState | null {
  if (
    value?.checkpointVersion !== 2 ||
    typeof value?.jobId !== "string" ||
    !Number.isInteger(value.current) ||
    !Number.isInteger(value.total) ||
    Number(value.current) < 0 ||
    Number(value.total) < 0 ||
    Number(value.current) > Number(value.total) ||
    typeof value.profile !== "string"
  ) {
    return null;
  }
  if (value.sheetIndices !== undefined && (!Array.isArray(value.sheetIndices) ||
      !value.sheetIndices.length || value.sheetIndices.length > 100 ||
      value.sheetIndices.some((n, i, indices) => !Number.isInteger(n) || n < 0 || (i > 0 && n <= indices[i - 1]!)))) return null;
  return value as PlotterRecoveryState;
}

export function assertRecoveryCompatible(
  recovery: PlotterRecoveryState | null,
  job: RecoverablePlotterJob | null | undefined,
  profile: string,
) {
  if (!recovery) {
    throw new Error("Нет сохранённого задания для продолжения.");
  }
  if (job?.recoverable === false) {
    throw new Error(
      "Эта прошивка использует относительные координаты: безопасное продолжение после сбоя недоступно.",
    );
  }
  if (
    !job ||
    job.id !== recovery.jobId ||
    job.commands.length !== recovery.total
  ) {
    throw new Error(
      "Текст или настройки изменились. Продолжение старой траектории небезопасно.",
    );
  }
  if (recovery.checkpointVersion !== 2 || (recovery.current !== 0 && !job.resumePoints?.includes(recovery.current)))
    throw new Error("Сохранённая точка не подтверждена выполнением контроллера. Начните задание заново.");
  if (JSON.stringify(recovery.sheetIndices || null) !== JSON.stringify(job.sheetIndices || null))
    throw new Error("Выбор листов изменился. Продолжение относится к прежней очереди.");
  if (recovery.profile !== profile) {
    throw new Error(
      "Профиль контроллера изменился. Верните прежнюю прошивку перед продолжением.",
    );
  }
}
