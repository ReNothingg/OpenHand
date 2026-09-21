import {
  createPageJogCommands,
  createOriginCommands,
  createPenCommand,
  transformPointForMachine,
} from "./job";

function probeCommands(profile) {
  if (profile === "marlin") return ["M115"];
  if (profile === "ebb") return ["V"];
  return ["$I"];
}

export function calibrationCommands(action, config) {
  const step = Number(config.calibrationStep);
  const width = Number(config.workAreaWidth);
  const height = Number(config.workAreaHeight);
  const boundaryTargets = {
    "boundary-right": [width, 0],
    "boundary-bottom": [width, height],
    "boundary-left": [0, height],
    "boundary-home": [0, 0],
  };
  if (config.profile !== "ebb" && boundaryTargets[action]) {
    const [x, y] = boundaryTargets[action];
    const target = transformPointForMachine({ x, y }, config);
    // Absolute corners make a repeated check return to the same point instead
    // of travelling another full width/height beyond the paper.
    return ["G21", "G90", `G0X${target.x}Y${target.y}F${config.jogSpeed}`];
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
    case "boundary-right":
      return createPageJogCommands(width, 0, config);
    case "boundary-bottom":
      return createPageJogCommands(0, height, config);
    case "boundary-left":
      return createPageJogCommands(-width, 0, config);
    case "boundary-home":
      return createPageJogCommands(0, -height, config);
    default:
      throw new Error("Неизвестный шаг калибровки.");
  }
}

export async function runCalibrationAction(action, config, sendCommands) {
  const commands = calibrationCommands(action, config);
  if (commands.length) await sendCommands(commands, { waitForMotion: action !== "probe" });
  return commands;
}
