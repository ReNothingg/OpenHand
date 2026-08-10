export interface PlotterRecoveryState {
  jobId: string;
  current: number;
  total: number;
  profile: string;
  updatedAt?: number;
}

export interface RecoverablePlotterJob {
  id: string;
  commands: unknown[];
  recoverable?: boolean;
}

export function normalizeRecoveryState(
  value: Partial<PlotterRecoveryState> | null | undefined,
): PlotterRecoveryState | null {
  if (
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
  if (recovery.profile !== profile) {
    throw new Error(
      "Профиль контроллера изменился. Верните прежнюю прошивку перед продолжением.",
    );
  }
}
