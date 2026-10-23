import { compilePlotJob, transformVectorForMachine } from "./job";
import { automaticPenSpeed } from "./penLift";
import { penAxis } from "./penTouch";

export const LADDER_STEPS_MM = [0.1, 0.2, 0.3] as const;
export const LADDER_COUNT = 12;
export const LADDER_DASH_MM = 3;
export const LADDER_GAP_MM = 2;
export const TEST_STROKE_WIDTH_MM = 24;

const fixed = (value: number) => Number(value.toFixed(3)).toString();

function relativeFrame(config: any) {
  const estepper = config.penMode === "estepper";
  return {
    begin: ["G21", "G91", ...(estepper ? ["M83"] : [])],
    end: ["G90", ...(estepper ? ["M82"] : [])],
  };
}

function move(config: any, dx: number, dy: number, dz: number, feed: number) {
  const axis = penAxis(config);
  const xy = transformVectorForMachine(dx, dy, config);
  const parts = [
    Math.abs(xy.x) > 1e-6 ? `X${fixed(xy.x)}` : "",
    Math.abs(xy.y) > 1e-6 ? `Y${fixed(xy.y)}` : "",
    Math.abs(dz) > 1e-6 ? `${axis}${fixed(dz)}` : "",
  ].join("");
  return parts ? `G1${parts}F${Math.max(1, Math.round(feed))}` : null;
}

export function ladderDepths(step: number, count = LADDER_COUNT) {
  return Array.from({ length: count }, (_, index) => Number(((index + 1) * step).toFixed(3)));
}

export function contactLadderCommands(config: any, step: number) {
  if (!["stepper", "estepper"].includes(config.penMode) || config.profile === "ebb")
    throw new Error("Лесенка касания нужна для шагового подъёма пера Z/E.");
  if (!LADDER_STEPS_MM.includes(step as typeof LADDER_STEPS_MM[number])) throw new Error("Выберите шаг лесенки 0,1, 0,2 или 0,3 мм.");
  const down = config.zUpDirection === 1 ? -1 : 1;
  const zFeed = Math.min(automaticPenSpeed(config), 400);
  const dashFeed = Math.min(Number(config.feedRate) || 600, 600);
  const travelFeed = Math.min(Number(config.jogSpeed) || 600, 1500);
  const frame = relativeFrame(config);
  const commands: string[] = [...frame.begin];
  for (const depth of ladderDepths(step)) {
    commands.push(move(config, 0, 0, down * depth, zFeed)!);
    commands.push(move(config, LADDER_DASH_MM, 0, 0, dashFeed)!);
    commands.push(move(config, 0, 0, -down * depth, zFeed)!);
    commands.push(move(config, LADDER_GAP_MM, 0, 0, travelFeed)!);
  }
  commands.push(move(config, -LADDER_COUNT * (LADDER_DASH_MM + LADDER_GAP_MM), 0, 0, travelFeed)!);
  commands.push(...frame.end);
  return commands;
}

export function contactFromLadder(step: number, firstInkIndex: number) {
  const depths = ladderDepths(step);
  const depth = depths[firstInkIndex];
  if (depth === undefined) throw new Error("Выберите черту лесенки.");
  return Number(Math.max(0, depth - step / 2).toFixed(3));
}

function testPattern() {
  const loops = Array.from({ length: 61 }, (_, i) => {
    const t = i / 60 * 4;
    return { x: 2 + t * 2.4 - 0.9 * Math.sin(t * Math.PI * 2), y: 5 - 1.6 * (1 - Math.cos(t * Math.PI * 2)) / 2 };
  });
  const wave = Array.from({ length: 25 }, (_, i) => ({ x: 14 + i * 0.35, y: 3.6 + Math.sin(i / 24 * Math.PI * 3) * 1.4 }));
  const dot = [{ x: 23, y: 4.6 }, { x: 23.15, y: 4.75 }];
  return [loops, wave, dot].map(points => Object.assign(points, { pressure: 1 }));
}

export function testStrokeCommands(config: any, currentHeight: number) {
  if (!Number.isFinite(currentHeight)) throw new Error("Высота пера неизвестна. Сначала найдите касание.");
  const job = compilePlotJob(testPattern(), {
    ...config, startPosition: "left-top", paperAlignment: null, pageOffsetX: 0,
    workAreaWidth: 1000, workAreaHeight: 1000, optimizePath: false, returnToOrigin: false,
    customStartGcode: "", customEndGcode: "",
  });
  const axis = penAxis(config);
  const pattern = new RegExp(`([XYF${axis}])\\s*([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+))`, "g");
  let x = 0, y = 0, z = currentHeight;
  const frame = relativeFrame(config);
  const commands: string[] = [...frame.begin];
  for (const command of job.commands) {
    if (/^G4/i.test(command)) { commands.push(command); continue; }
    if (!/^G1/i.test(command)) continue;
    const values = Object.fromEntries([...command.slice(2).replace(/^G\d+/g, "").replace(/G\d+/g, "").matchAll(pattern)].map(m => [m[1], Number(m[2])]));
    const parts: string[] = [];
    if (values.X !== undefined) { parts.push(`X${fixed(values.X - x)}`); x = values.X; }
    if (values.Y !== undefined) { parts.push(`Y${fixed(values.Y - y)}`); y = values.Y; }
    if (values[axis] !== undefined) { parts.push(`${axis}${fixed(values[axis] - z)}`); z = values[axis]; }
    if (parts.length && values.F) commands.push(`G1${parts.join("")}F${Math.round(values.F)}`);
  }
  if (Math.abs(x) > 1e-6 || Math.abs(y) > 1e-6) {
    const back = `G1X${fixed(-x)}Y${fixed(-y)}F${Math.min(Number(config.jogSpeed) || 600, 1500)}`;
    commands.push(back);
  }
  commands.push(...frame.end);
  return { commands, endHeight: z };
}
