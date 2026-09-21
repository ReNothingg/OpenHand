export function penLiftDistance(config: { zUp: number; zDown: number }): number {
  return Number(Math.abs(config.zUp - config.zDown).toFixed(3));
}

/** Change travel relative to the existing contact point, never the Z reference. */
export function penLiftTarget(config: { zUp: number; zDown: number }, distance: number): number {
  if (!Number.isFinite(distance) || distance <= 0) return config.zUp;
  const direction = Math.sign(config.zUp - config.zDown) || -1;
  return Number(Math.max(-50, Math.min(50, config.zDown + direction * distance)).toFixed(3));
}
