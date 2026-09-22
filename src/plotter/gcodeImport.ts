import { createPenCommand } from "./job";
import { importedCommandBlockers, preparedProgramBlockers } from "./importSafety";
import { normalizeGCodeSource, parseGCode } from "../gcode/parser";

export const MAX_IMPORTED_GCODE_BYTES = 16 * 1024 * 1024;
export const MAX_IMPORTED_GCODE_COMMANDS = 250_000;

const TOOL_POWER_COMMAND = /M\s*0?[34](?=[^0-9.]|$)/i;

function cleanCommand(rawLine: string) {
  return rawLine
    .replace(/\([^)]*\)/g, "")
    .replace(/;.*$/, "")
    .trim();
}

function fingerprint(commands: string[]) {
  let hash = 2166136261;
  for (const command of commands) {
    for (let index = 0; index < command.length; index += 1) {
      hash ^= command.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `import-${commands.length}-${(hash >>> 0).toString(36)}`;
}

export function prepareImportedGcode(
  source: string,
  options: {
    name?: string;
    byteLength?: number;
    workAreaWidth?: number;
    workAreaHeight?: number;
  } = {},
) {
  const byteLength =
    options.byteLength ?? new TextEncoder().encode(source).byteLength;
  if (byteLength > MAX_IMPORTED_GCODE_BYTES)
    throw new Error("G-code больше 16 МБ.");
  if (/\u0000|[\u0001-\u0008\u000b\u000c\u000e-\u001f]/.test(source))
    throw new Error("G-code содержит двоичные управляющие символы.");

  const normalized = normalizeGCodeSource(source);
  const commands = normalized
    .split("\n")
    .map(cleanCommand)
    .filter((line) => line && line !== "%" && !line.startsWith("/"));
  if (!commands.length) throw new Error("В файле нет команд G-code.");
  if (commands.length > MAX_IMPORTED_GCODE_COMMANDS)
    throw new Error(
      `В файле больше ${MAX_IMPORTED_GCODE_COMMANDS.toLocaleString("ru-RU")} команд.`,
    );
  const oversized = commands.find((line) => line.length > 256);
  if (oversized) throw new Error("В G-code есть строка длиннее 256 символов.");

  const parsed = parseGCode(normalized, {
    includeLines: false,
    maxSegmentsPerKind: 40_000,
  });
  const width = Math.max(1, Number(options.workAreaWidth) || 330);
  const height = Math.max(1, Number(options.workAreaHeight) || 203);
  const withinWorkArea =
    Math.max(Math.abs(parsed.bounds.minX), Math.abs(parsed.bounds.maxX)) <=
      width + 0.01 &&
    Math.max(Math.abs(parsed.bounds.minY), Math.abs(parsed.bounds.maxY)) <=
      height + 0.01;
  const warnings: string[] = [];
  const launchBlockers = importedCommandBlockers(commands);
  if (parsed.unsupportedMotionLines.length)
    launchBlockers.push(`Не удалось проверить ${parsed.unsupportedMotionLines.length.toLocaleString("ru-RU")} движений. Файл доступен для просмотра, но не для отправки.`);
  if (commands.some((line) => TOOL_POWER_COMMAND.test(line)))
    warnings.push(
      "Файл содержит M3/M4: для сервопривода это нормально, но при подключённом лазере команда включает излучатель.",
    );

  return {
    id: fingerprint(commands),
    name: String(options.name || "imported.gcode").slice(0, 160),
    commands,
    resumePoints: [],
    resumePrefix: [],
    recoverable: false,
    parsed,
    warnings,
    launchBlockers,
    withinWorkArea,
  };
}

/** Original file stays unchanged; host preparation/finalization are checked separately. */
export function prepareImportedExecution(job: ReturnType<typeof prepareImportedGcode>, config: any) {
  if (config.profile === "ebb") throw new Error("Обычный G-code доступен для GRBL и Marlin.");
  const prefix = createPenCommand(true, config);
  const suffix = createPenCommand(true, config);
  const blockers = [
    ...preparedProgramBlockers(job.commands, config),
    ...preparedProgramBlockers(prefix, config),
    ...preparedProgramBlockers(suffix, config),
  ];
  if (blockers.length) throw new Error(blockers[0]);
  return { job, prefix, suffix };
}
