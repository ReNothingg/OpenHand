export function penLiftDistance(config: { zUp: number; zDown: number }): number {
  return Number(Math.abs(config.zUp - config.zDown).toFixed(3));
}
