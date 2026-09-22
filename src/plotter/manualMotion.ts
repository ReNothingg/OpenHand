import type { GrblStatus } from "./grbl";
import { transformPointForMachine, transformVectorForMachine } from "./job";

/** Bounds are the user's configured area relative to the declared sheet origin. */
export function assertManualJogAllowed(dx: number, dy: number, config: any,
  originConfirmed: boolean, report: GrblStatus | null) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.1 - 1e-9 || Math.hypot(dx, dy) > 50)
    throw new Error("Выберите один ручной шаг от 0,1 до 50 мм.");
  if (config.profile !== "grbl" || !originConfirmed) return;
  if (!report?.unitsKnown || !report.work || report.work.length < 2 || !report.work.slice(0, 2).every(Number.isFinite))
    throw new Error("Не получены актуальные координаты. Ручной шаг не отправлен.");
  const [width, height] = [Number(config.workAreaWidth), Number(config.workAreaHeight)];
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0)
    throw new Error("Задайте размеры рабочей области.");
  const a = transformPointForMachine({ x: 0, y: 0 }, config);
  const b = transformPointForMachine({ x: width, y: height }, config);
  const delta = transformVectorForMachine(dx, dy, config);
  const from = [report.work[0]!, report.work[1]!];
  const to = [from[0]! + delta.x, from[1]! + delta.y];
  const low = [Math.min(a.x, b.x), Math.min(a.y, b.y)];
  const high = [Math.max(a.x, b.x), Math.max(a.y, b.y)];
  const outside = (value: number, axis: number) => Math.max(low[axis]! - value, value - high[axis]!, 0);
  const before = from.map(outside), after = to.map(outside), tolerance = 0.01;
  if (after.every(distance => distance <= tolerance)) return;
  // If already outside, allow only steps that reduce the error without crossing
  // another edge. Never shorten the selected step silently.
  if (after.every((distance, axis) => distance <= before[axis]! + tolerance) &&
      after.some((distance, axis) => distance < before[axis]! - tolerance)) return;
  throw new Error("Этот шаг выходит за выбранную рабочую область. Уменьшите шаг или нажмите «Переставить начало листа», чтобы заново выбрать его положение.");
}
