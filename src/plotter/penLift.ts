export function penLiftDistance(config: { zUp: number; zDown: number }): number {
  return Number(Math.abs(config.zUp - config.zDown).toFixed(3));
}

export const PEN_TEST_STEP_MM = 0.1;

export function penPositionKey(config: any, up: boolean): string {
  return `${config.profile}:${config.penMode}:${config.penControllerKey || ""}:${config.zUpDirection}:${up ? config.zUp : config.zDown}`;
}

export function hasVerifiedPenPositions(config: any, controllerKey?: string | null): boolean {
  if (!["stepper", "estepper"].includes(config.penMode)) return true;
  if (config.profile === "grbl" && controllerKey !== undefined && (controllerKey === null || config.penControllerKey !== controllerKey)) return false;
  return Number.isFinite(config.zUp) && Number.isFinite(config.zDown)
    && (config.zUp - config.zDown) * config.zUpDirection > 0
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

export function savePenPosition<T extends { zUp: number; zDown: number; zUpDirection: number; penVerifiedUp?: string; penVerifiedDown?: string }>(config: T, up: boolean, position: number): T {
  if (!Number.isFinite(position) || position < -50 || position > 50) throw new Error("Положение вне диапазона настройки пера.");
  const otherVerified = config[up ? "penVerifiedDown" : "penVerifiedUp"] === penPositionKey(config, !up);
  const next = { ...config, [up ? "zUp" : "zDown"]: position };
  if (otherVerified && (next.zUp - next.zDown) * next.zUpDirection <= 0)
    throw new Error("Верхнее положение должно быть выше нижнего. Проверьте направление стрелок и подведите перо коротким шагом.");
  return { ...next, [up ? "penVerifiedUp" : "penVerifiedDown"]: penPositionKey(next, up) };
}
