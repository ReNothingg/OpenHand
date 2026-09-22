export type XYPoint = { x: number; y: number };

export function sameXY(a?: XYPoint | null, b?: XYPoint | null) {
  return Boolean(a && b && a.x === b.x && a.y === b.y);
}

export function textStartPoint(job: { firstPoint?: XYPoint | null; withinWorkArea?: boolean }, config: { profile: string; customStartGcode?: string }) {
  if (!["grbl", "marlin"].includes(config.profile)) throw new Error("Привязка начала текста доступна для GRBL и Marlin.");
  if (config.customStartGcode?.trim()) throw new Error("Для привязки текста уберите пользовательские стартовые команды: они могут изменить координаты до первого штриха.");
  if (!job.firstPoint || ![job.firstPoint.x, job.firstPoint.y].every(Number.isFinite)) throw new Error("Дождитесь готовности траектории текущего листа.");
  if (job.withinWorkArea === false) throw new Error("Траектория выходит за рабочую область.");
  return { ...job.firstPoint };
}
