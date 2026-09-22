import { validatePenModel, type GCodePenModel } from "./penModel";

export type PreviewPenKind = "auto" | "Z" | "E" | "M3" | "M280" | "spindle";

export function previewPenKind(model?: GCodePenModel): PreviewPenKind {
  if (!model) return "auto";
  return model.kind === "axis" ? model.axis : model.kind === "servo" ? model.command : "spindle";
}

/** Values describe file coordinates in mm (axis) or S units (servo), never hardware limits. */
export function previewPenFromFields(kind: PreviewPenKind, upText: string, downText: string): GCodePenModel | undefined {
  if (kind === "auto") return undefined;
  if (kind === "spindle") return { kind: "spindle" };
  const number = (text: string) => {
    const normalized = text.trim().replace(",", ".");
    return /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized) ? Number(normalized) : NaN;
  };
  const up = number(upText), down = number(downText);
  if (!Number.isFinite(up) || !Number.isFinite(down)) throw new Error("Введите оба значения из файла: для поднятого и опущенного пера.");
  if (up === down) throw new Error("Значения поднятого и опущенного пера должны различаться.");
  const model = validatePenModel(kind === "Z" || kind === "E"
    ? { kind: "axis", axis: kind, up, down } : { kind: "servo", command: kind, up, down });
  if (!model) throw new Error("Выберите способ управления пером.");
  return model;
}

export function previewPenDescription(model?: GCodePenModel): string {
  if (!model) return "приблизительно";
  if (model.kind === "spindle") return "M3/M4/M5";
  const name = model.kind === "axis" ? model.axis : model.command === "M280" ? "M280 P0" : "M3 S";
  return `${name}: ${model.up} ↑ / ${model.down} ↓`;
}
