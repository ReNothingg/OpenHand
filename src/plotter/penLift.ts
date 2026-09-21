export function penLiftDistance(config: { zUp: number; zDown: number }): number {
  return Number(Math.abs(config.zUp - config.zDown).toFixed(3));
}

export const PEN_TEST_STEP_MM = 0.1;

export function penPositionKey(config: any, up: boolean): string {
  return `${config.profile}:${config.penMode}:${config.zUpDirection}:${up ? config.zUp : config.zDown}`;
}

export function hasVerifiedPenPositions(config: any): boolean {
  if (!["stepper", "estepper"].includes(config.penMode)) return true;
  return config.zUp !== config.zDown
    && config.penVerifiedUp === penPositionKey(config, true)
    && config.penVerifiedDown === penPositionKey(config, false);
}

export function penTestDelta(current: number, target: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target))
    throw new Error("Текущее положение пера неизвестно. Сначала укажите его во вкладке «Плоттер».");
  return Number(Math.max(-PEN_TEST_STEP_MM, Math.min(PEN_TEST_STEP_MM, target - current)).toFixed(3));
}

export function clearPenSetup(config: any) {
  return { ...config, zUp: 0, zDown: 0, penVerifiedUp: "", penVerifiedDown: "" };
}
