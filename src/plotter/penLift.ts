export function penLiftDistance(config: { zUp: number; zDown: number }): number {
  return Number(Math.abs(config.zUp - config.zDown).toFixed(3));
}

/** Change travel relative to the existing contact point, never the Z reference. */
export function penLiftTarget(config: { zUp: number; zDown: number }, distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return config.zUp;
  const direction = Math.sign(config.zUp - config.zDown) || -1;
  return Number(Math.max(-50, Math.min(50, config.zDown + direction * distance)).toFixed(3));
}

/** A user-observed contact becomes Z/E zero; only a short lift is requested later. */
export function penContactConfig<T extends { zUp: number; zDown: number }>(config: T): T {
  return { ...config, zDown: 0, zUp: (Math.sign(config.zUp - config.zDown) || -1) * 0.5 };
}

export function adjustPenContact<T extends { zUp: number; zDown: number }>(config: T, deeper: boolean, distance: number): T {
  if (!Number.isFinite(distance) || distance <= 0 || distance > 0.5)
    throw new Error("Шаг подстройки пера должен быть не больше 0,5 мм.");
  const delta = (Math.sign(config.zDown - config.zUp) || 1) * distance * (deeper ? 1 : -1);
  const zUp = Number((config.zUp + delta).toFixed(3));
  const zDown = Number((config.zDown + delta).toFixed(3));
  if (Math.abs(zUp) > 50 || Math.abs(zDown) > 50) throw new Error("Достигнут предел настройки пера.");
  return { ...config, zUp, zDown };
}
