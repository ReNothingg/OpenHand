export const CALIBRATION_CHECKS = [
  { id: "pen-raised", label: "Ручка снята или её кончик не касается бумаги. Лазер, если есть, отключён." },
  {
    id: "area-clear",
    label: "Держатель примерно посередине: есть место для короткого шага во все стороны.",
  },
  {
    id: "stop-ready",
    label: "Я могу сразу выключить питание плоттера, если движение пойдёт не так.",
  },
];

const BASE_STEPS = [
  { id: "connect", kind: "connect", title: "Подключение", action: "probe" },
  { id: "safety", kind: "checklist", title: "Безопасность" },
  {
    id: "axis-x-negative",
    kind: "verify",
    title: "Движение влево",
    action: "axis-x-negative",
  },
  {
    id: "axis-x-positive",
    kind: "verify",
    title: "Движение вправо",
    action: "axis-x-positive",
  },
  {
    id: "axis-y-negative",
    kind: "verify",
    title: "Движение вверх",
    action: "axis-y-negative",
  },
  {
    id: "axis-y-positive",
    kind: "verify",
    title: "Движение вниз",
    action: "axis-y-positive",
  },
  { id: "pen-reference", kind: "verify", title: "Ноль поднятого пера", action: "pen-reference", stepperOnly: true },
  {
    id: "pen-up",
    kind: "verify",
    title: "Поднятие пера",
    action: "pen-up",
    penOnly: true,
  },
  {
    id: "pen-down",
    kind: "verify",
    title: "Касание пера",
    action: "pen-down",
    penOnly: true,
  },
  {
    id: "pen-safe",
    kind: "verify",
    title: "Поднять перо перед позиционированием",
    action: "pen-up",
    penOnly: true,
  },
  { id: "origin", kind: "origin", title: "Нулевая точка", action: "origin" },
  { id: "area", kind: "area", title: "Размер доступной области" },
  { id: "summary", kind: "summary", title: "Готово" },
];

export function calibrationSteps(config) {
  return BASE_STEPS.filter(
    (step) => !(step.penOnly && config.penMode === "laser")
      && !(step.stepperOnly && !["stepper", "estepper"].includes(config.penMode)),
  );
}

export function createCalibrationState(config) {
  return {
    steps: calibrationSteps(config),
    index: 0,
    checks: Object.fromEntries(
      CALIBRATION_CHECKS.map((check) => [check.id, false]),
    ),
    phase: "ready",
    error: "",
    failedDirections: [],
  };
}

export function currentCalibrationStep(state) {
  return state.steps[state.index];
}

export function calibrationCanContinue(state) {
  const step = currentCalibrationStep(state);
  if (!step) return false;
  if (step.kind === "checklist")
    return CALIBRATION_CHECKS.every((check) => state.checks[check.id]);
  return state.phase === "verified";
}

export function calibrationReducer(state, event) {
  switch (event.type) {
    case "toggle-check":
      return {
        ...state,
        checks: { ...state.checks, [event.id]: Boolean(event.checked) },
        error: "",
      };
    case "action-start":
      if (state.phase === "running") return state;
      return { ...state, phase: "running", error: "" };
    case "settings-changed":
      return {
        ...state,
        index: event.axes ? 2 : event.penReference
          ? Math.max(0, state.steps.findIndex((step) => step.id === "pen-reference"))
          : state.index,
        phase: "ready",
        error: "",
      };
    case "action-success":
      return { ...state, phase: "awaiting-verification", error: "" };
    case "action-error":
      return {
        ...state,
        phase: "ready",
        error: event.error || "Проверка не выполнена.",
      };
    case "verify-pass":
      return { ...state, phase: "verified", error: "" };
    case "verify-fail": {
      const step = currentCalibrationStep(state);
      const failedDirections = step?.id.startsWith("axis-")
        ? [...new Set([...state.failedDirections, step.id])]
        : state.failedDirections;
      return {
        ...state,
        phase: "ready",
        failedDirections,
        error: step?.id.startsWith("axis-")
          ? "Исправьте направление ниже. После изменения повторите проверку осей."
          : "Измените параметры ниже и повторите проверку.",
      };
    }
    case "continue":
      if (
        currentCalibrationStep(state)?.kind === "checklist"
          ? !calibrationCanContinue(state)
          : state.phase !== "verified"
      )
        return state;
      return {
        ...state,
        index: Math.min(state.index + 1, state.steps.length - 1),
        phase: "ready",
        error: "",
      };
    case "disconnect":
      return {
        ...state,
        index: 0,
        phase: "ready",
        error: "Устройство отключено. Подключитесь и начните проверки заново.",
      };
    default:
      return state;
  }
}
