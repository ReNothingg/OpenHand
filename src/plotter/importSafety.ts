import { penModelForConfig } from "../gcode/penModel";
import { parseGCode } from "../gcode/parser";
import { isWithinWorkArea } from "./job";
/** Execution policy; the viewer may display a file that is not safe to stream. */
const WORD = /([A-Z])\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))/gi;
const SAFE_G = new Set([0, 1, 2, 3, 4, 17, 20, 21, 90, 91, 94, 90.1, 91.1]);
const SAFE_M = new Set([2, 3, 4, 5, 30, 82, 83, 280, 400]);

export function importedCommandBlockers(commands: string[], config?: any): string[] {
  const blockers: string[] = [];
  let units = 1, absolute = true, extrusionRelative = false;
  let xKnown = false, yKnown = false, z: number | null = null, e: number | null = null;
  let ended = false, motion: number | undefined;
  for (let index = 0; index < commands.length; index++) {
    const line = commands[index]!;
    const fail = (reason: string) => { if (blockers.length < 8) blockers.push(`Строка ${index + 1}: ${reason}`); };
    if (line.includes('$')) { fail("системные команды контроллера нельзя запускать из файла задания."); continue; }
    const words = [...line.matchAll(WORD)].map(m => ({ key: m[1]!.toUpperCase(), value: Number(m[2]) }));
    if (!words.length || line.replace(WORD, '').trim() || words.some(w => !Number.isFinite(w.value))) {
      fail("не удалось полностью разобрать команду; отправка заблокирована."); continue;
    }
    if (ended) { fail("после завершения программы есть дополнительные команды."); continue; }
    const values = (key: string) => words.filter(w => w.key === key).map(w => w.value);
    const last = (key: string) => values(key).at(-1);
    const g = values('G'), m = values('M');
    motion = g.findLast(code => [0, 1, 2, 3].includes(code)) ?? motion;
    if (g.some(n => !SAFE_G.has(n)) || m.some(n => !SAFE_M.has(n))) {
      fail("команда меняет координатную систему, оборудование или не поддерживается проверкой траектории."); continue;
    }
    if (words.some(w => !'GMNXYZEFIJKRSP'.includes(w.key))) { fail("неподдерживаемая ось или параметр."); continue; }
    if (g.includes(94) && config && config.profile !== "grbl")
      fail("режим G94 поддержан отправкой только для GRBL.");
    if (g.includes(20)) units = 25.4;
    if (g.includes(21)) units = 1;
    if (g.includes(90)) { absolute = true; extrusionRelative = false; }
    if (g.includes(91)) { absolute = false; extrusionRelative = true; }
    if (m.includes(82)) extrusionRelative = false;
    if (m.includes(83)) extrusionRelative = true;
    const x = last('X'), y = last('Y');
    if ((x !== undefined || y !== undefined || ((motion === 2 || motion === 3) && (last('I') !== undefined || last('J') !== undefined || last('R') !== undefined))) && !g.includes(4)) {
      if (absolute) { if (x !== undefined) xKnown = true; if (y !== undefined) yKnown = true; }
      if (!xKnown || !yKnown) fail("первое перемещение должно задать обе абсолютные координаты X и Y.");
    }
    for (const axis of ['Z', 'E']) {
      const value = last(axis);
      if (value === undefined) continue;
      const relative = axis === 'E' ? extrusionRelative : !absolute;
      const previous = axis === 'Z' ? z : e;
      if (relative && previous === null) { fail(`первое положение ${axis} должно быть абсолютным.`); continue; }
      const next = value * units + (relative ? previous! : 0);
      if (axis === 'Z') z = next; else e = next;
      if (config) {
        const expectedAxis = config.penMode === 'estepper' ? 'E' : config.penMode === 'stepper' ? 'Z' : null;
        if (axis !== expectedAxis) fail(`ось ${axis} не используется выбранным механизмом пера.`);
        else if (next < Math.min(config.zUp, config.zDown) - .001 || next > Math.max(config.zUp, config.zDown) + .001)
          fail(`${axis}${next} выходит за сохранённые положения пера.`);
      }
    }
    if (config) {
      if (config.profile === 'grbl' && (m.some(n => [82, 83, 280, 400].includes(n)) || g.includes(90.1)))
        fail("команда не поддерживается выбранным GRBL.");
      const standaloneS = last('S');
      const dwellS = config.profile === 'marlin' && g.includes(4);
      if (standaloneS !== undefined && !dwellS) {
        if (config.penMode !== 'servo' && config.penMode !== 'laser') fail("выход S не используется выбранным шаговым пером.");
        else {
          const low = config.penMode === 'laser' ? 0 : Math.min(config.penUp, config.penDown);
          const high = config.penMode === 'laser' ? config.laserPower : Math.max(config.penUp, config.penDown);
          if (standaloneS < low || standaloneS > high) fail("значение S вне настроенного диапазона инструмента.");
        }
      }
      if (m.includes(4) && config.penMode !== 'laser') fail("динамический выход M4 не предназначен для выбранного пера.");
      if (m.some(n => [3, 4, 280].includes(n))) {
        if (config.penMode !== 'servo' && config.penMode !== 'laser') fail("файл включает выход, не используемый шаговым пером.");
        const power = last('S');
        const limit = config.penMode === 'laser' ? config.laserPower : Math.max(config.penUp, config.penDown);
        const minimum = config.penMode === 'laser' ? 0 : Math.min(config.penUp, config.penDown);
        if (power === undefined || power < minimum || power > limit) fail("значение S вне настроенного диапазона инструмента.");
        if (m.includes(280) && (config.profile !== 'marlin' || last('P') !== 0)) fail("поддерживается только настроенный сервопривод Marlin P0.");
      }
    }
    if (m.includes(2) || m.includes(30)) ended = true;
  }
  return [...new Set(blockers)];
}


const programCache = new WeakMap<string[], { signature: string; blockers: string[] }>();
export function preparedProgramBlockers(commands: string[], config: any): string[] {
  if (config.profile === "ebb") return config.customStartGcode?.trim() || config.customEndGcode?.trim()
    ? ["Пользовательские команды EBB нельзя проверить по траектории. Уберите их перед запуском."] : [];
  const signature = JSON.stringify(config);
  const cached = programCache.get(commands);
  if (cached?.signature === signature) return cached.blockers;
  const blockers = importedCommandBlockers(commands, config);
  const parsed = parseGCode(commands.join("\n"), { includeLines: false, maxSegmentsPerKind: 1, penModel: penModelForConfig(config) });
  if (parsed.unsupportedMotionLines.length) blockers.push("Часть движений не поддерживается проверкой траектории.");
  if (parsed.drawingSegmentCount + parsed.travelSegmentCount > 0) {
    const b = parsed.bounds;
    if (!isWithinWorkArea([[{ x: b.minX, y: b.minY }, { x: b.maxX, y: b.maxY }]], config))
      blockers.push("Команды задания выходят за рабочую область с учётом выбранных осей и нуля.");
  }
  const unique = [...new Set(blockers)];
  programCache.set(commands, { signature, blockers: unique });
  return unique;
}
