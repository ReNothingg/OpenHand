import {
  createPageJogCommands,
  createOriginCommands,
  createPenCommand,
  createPenReferenceCommands,
} from "./job";

function probeCommands(profile) {
  if (profile === "marlin") return ["M115"];
  if (profile === "ebb") return ["V"];
  return ["$I"];
}

export function calibrationCommands(action, config) {
  const step = Number(config.calibrationStep);
  if (action.startsWith("boundary-")) {
    throw new Error("Автоматический объезд непроверенной области отключён. Измерьте доступную область от нуля листа.");
  }
  switch (action) {
    case "probe":
      return probeCommands(config.profile);
    case "axis-x-negative":
      return createPageJogCommands(-step, 0, config);
    case "axis-x-positive":
      return createPageJogCommands(step, 0, config);
    case "axis-y-negative":
      return createPageJogCommands(0, -step, config);
    case "axis-y-positive":
      return createPageJogCommands(0, step, config);
    case "pen-up":
      if (config.penMode === "laser")
        throw new Error("Мастер не активирует лазер.");
      return createPenCommand(true, config);
    case "pen-down":
      if (config.penMode === "laser")
        throw new Error("Мастер не активирует лазер.");
      return createPenCommand(false, config);
    case "origin":
      return createOriginCommands(config);
    case "pen-reference":
      return createPenReferenceCommands(config);
    default:
      throw new Error("Неизвестный шаг калибровки.");
  }
}

export async function runCalibrationAction(action, config, sendCommands) {
  const commands = calibrationCommands(action, config);
  if (commands.length) await sendCommands(commands, { waitForMotion: action !== "probe" });
  return commands;
}
