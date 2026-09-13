// Dimensionless controls shared by screen text and physical GFont trajectories.
export const STRUCTURE_CONTROLS = [
  { key: "paragraphIndent", label: "Красная строка", min: 0, max: 300, initial: 0, hint: "Отступ первой строки обычного абзаца, в процентах размера шрифта." },
  { key: "paragraphGap", label: "Интервал после абзаца", min: 0, max: 100, initial: 0, hint: "Дополнительный интервал в процентах межстрочного расстояния." },
  { key: "wordSpacing", label: "Пробел между словами", min: 55, max: 160, initial: 100, hint: "Ширина пробела относительно шрифта." },
  { key: "spaceVariation", label: "Неравномерность пробелов", min: 0, max: 50, initial: 0, hint: "Небольшое различие интервалов между словами." },
  { key: "wordCoherence", label: "Согласованность букв слова", min: 0, max: 100, initial: 0, hint: "Общий наклон и размер внутри слова вместо независимых скачков букв." },
  { key: "endCompression", label: "Сжатие окончания слова", min: 0, max: 18, initial: 0, hint: "Плавно сужает буквы к концу длинного слова." },
  { key: "ascenderScale", label: "Верхние петли", min: 75, max: 130, initial: 100, plotterOnly: true, hint: "Меняет верхние выносные штрихи GFont, сохраняя тело буквы." },
  { key: "descenderScale", label: "Нижние хвосты", min: 75, max: 130, initial: 100, plotterOnly: true, hint: "Длина штрихов ниже строки в траектории GFont." },
] as const;

export function structureValue(settings, key: string): number {
  const control = STRUCTURE_CONTROLS.find((item) => item.key === key);
  if (!control) return 0;
  const value = Number(settings?.[key] ?? control.initial);
  return Number.isFinite(value) ? Math.max(control.min, Math.min(control.max, value)) : control.initial;
}

function noise(seed, key): number {
  let hash = 2166136261;
  for (const char of `${seed}:${key}`) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296 - 0.5;
}

export function wordMotion(settings, wordKey, position = 0, length = 1) {
  const enabled = Boolean(settings.trueHandwriting);
  if (!enabled) return { coherence: 0, width: 1, height: 1, slant: 0, baseline: 0 };
  const coherence = enabled ? structureValue(settings, "wordCoherence") / 100 : 0;
  const progress = length > 1 ? position / (length - 1) : 0;
  const compression = enabled ? structureValue(settings, "endCompression") / 100 : 0;
  const wave = noise(settings.seed, `${wordKey}:wave`) * progress;
  return {
    coherence,
    width: 1 - compression * progress * Math.min(1, Math.max(0, length - 2) / 5),
    height: 1 + coherence * noise(settings.seed, `${wordKey}:height`) * 0.08,
    slant: coherence * (noise(settings.seed, `${wordKey}:slant`) * 3 + wave),
    baseline: coherence ? coherence * wave * 0.035 : 0,
  };
}

export function spaceFactor(settings, key) {
  return structureValue(settings, "wordSpacing") / 100 * (1 + (settings.trueHandwriting ? noise(settings.seed, `${key}:space`) * structureValue(settings, "spaceVariation") / 100 : 0));
}

// GFont uses a negative Y above the baseline. Keep the body and its joins fixed.
export function shapeVertical(y: number, bodyTop: number, settings): number {
  if (y < bodyTop) return bodyTop + (y - bodyTop) * structureValue(settings, "ascenderScale") / 100;
  if (y > 0) return y * structureValue(settings, "descenderScale") / 100;
  return y;
}

export function pageEvolution(progress: number, enabled: boolean, strength: number) {
  const t = Math.max(0, Math.min(1, (progress - .15) / .85));
  const amount = enabled ? t * t * (3 - 2 * t) * Math.max(0, Math.min(100, Number(strength) || 0)) / 100 : 0;
  return { amount, width: 1 - amount * .035, slant: amount * 3.2, pressure: 1 - amount * .06 };
}
