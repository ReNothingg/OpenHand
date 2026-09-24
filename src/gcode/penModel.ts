/** Preview metadata only. It must never authorize or change device commands. */
import { automaticPenUpPosition } from "../plotter/penLift";
export type GCodePenModel =
  | { kind: "axis"; axis: "Z" | "E"; up: number; down: number }
  | { kind: "servo"; command: "M3" | "M280"; up: number; down: number }
  | { kind: "spindle" };

const HEADER = "; OpenHand-Pen: ";

export function validatePenModel(value: unknown): GCodePenModel | undefined {
  if (!value || typeof value !== "object") return undefined;
  const model = value as Record<string, unknown>;
  if (model.kind === "spindle") return { kind: "spindle" };
  if (typeof model.up !== "number" || typeof model.down !== "number" ||
      !Number.isFinite(model.up) || !Number.isFinite(model.down) || model.up === model.down) return undefined;
  if (model.kind === "axis" && (model.axis === "Z" || model.axis === "E"))
    return { kind: "axis", axis: model.axis, up: model.up, down: model.down };
  if (model.kind === "servo" && (model.command === "M3" || model.command === "M280"))
    return { kind: "servo", command: model.command, up: model.up, down: model.down };
  return undefined;
}

export function penModelForConfig(config: any): GCodePenModel | undefined {
  if (config.profile === "ebb") return undefined;
  if (config.penMode === "laser") return { kind: "spindle" };
  if (["stepper", "estepper"].includes(config.penMode))
    return validatePenModel({ kind: "axis", axis: config.penMode === "estepper" ? "E" : "Z", up: automaticPenUpPosition(config), down: config.zDown });
  return validatePenModel({ kind: "servo", command: config.profile === "marlin" ? "M280" : "M3", up: config.penUp, down: config.penDown });
}

export function readPenModel(source: string): GCodePenModel | undefined {
  // Bounded header parsing; arbitrary comments are never executable instructions.
  for (const line of source.slice(0, 2048).split(/\r?\n/).slice(0, 8)) {
    if (!line.startsWith(HEADER) || line.length > 256) continue;
    try { return validatePenModel(JSON.parse(line.slice(HEADER.length))); } catch { return undefined; }
  }
  return undefined;
}

export function serializePlotterGcode(commands: string[], config: any): string {
  const model = penModelForConfig(config);
  return (model ? HEADER + JSON.stringify(model) + "\n" : "") + commands.join("\n") + "\n";
}

export function isPenDownAt(value: number, model: { up: number; down: number }): boolean {
  return (value - model.up) / (model.down - model.up) >= 0.5;
}
