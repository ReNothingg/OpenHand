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
