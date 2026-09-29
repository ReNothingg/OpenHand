import { STRUCTURE_CONTROLS } from "./structure";
import { DEFAULT_HANDWRITING_SETTINGS } from "./defaults";
export { DEFAULT_WRITING_CONFIG } from "./defaults";

export const HANDWRITING_PROFILES = Object.freeze({
  personal: {
    label: "Мой текущий",
    description: "Не меняет настроенные вручную значения.",
    settings: {},
  },
  pavelNotes: {
    label: "По умолчанию",
    description: "Линии чернил из ваших конспектов, исходные смещения букв и контекстные соединения. Редкие знаки дополнены прежней реконструкцией.",
    settings: DEFAULT_HANDWRITING_SETTINGS,
  },
  pavelNotesLegacy: {
    label: "Прежняя реконструкция",
    description: "Сохранённый вариант до оцифровки линий чернил — для сравнения и возврата.",
    settings: {
      ...DEFAULT_HANDWRITING_SETTINGS, plotterFontId: "pavel-notes-legacy-original",
      glyphVariation: 14, connectionStrength: 90, authorWidth: 82,
      authorRhythm: 26, authorBaseline: 12, endCompression: 6,
    },
  },
  pavelSamples: {
    label: "Из заполненного бланка",
    description: "Ваши целые буквы и реальные варианты из заполненного PDF. Соединения между буквами требуют проверки на связном тексте.",
    settings: {
      ...DEFAULT_HANDWRITING_SETTINGS, plotterFontId: "pavel-samples-original",
      glyphVariation: 0, authorRhythm: 0, authorBaseline: 0,
      maxWordTilt: 0, maxLift: 0, maxLetterSpacing: 0,
    },
  },
  notebook: {
    label: "Реалистичный",
    description: "Связное письмо, спокойная строка, свободные пробелы.",
    settings: {
      fontType: "plotter", plotterFontId: "retest-original", trueHandwriting: true,
      glyphVariation: 40, connectionStrength: 80, pressureVariation: 10,
      maxWordTilt: 0.8, maxLift: 0.6, maxLetterSpacing: 0.2,
      authorSlant: 4, authorWidth: 98, authorRhythm: 25, authorBaseline: 12,
      wordSpacing: 90, spaceVariation: 22, wordCoherence: 82, endCompression: 6,
      ascenderScale: 108, descenderScale: 110, correctionChance: 0, fatigueEnabled: false,
    },
  },
  careful: {
    label: "Аккуратный",
    description: "Ровные строки, спокойный ритм и мягкое давление.",
    settings: {
      glyphVariation: 34,
      connectionStrength: 72,
      pressureVariation: 10,
      maxWordTilt: 0.8,
      maxLift: 0.8,
      maxLetterSpacing: 0.25,
      directionChance: 35,
      authorSlant: -1,
      authorWidth: 98,
      authorRhythm: 24,
      authorBaseline: 12,
    },
  },
  lecture: {
    label: "Конспектный",
    description: "Быстрое связное письмо с заметным живым ритмом.",
    settings: {
      glyphVariation: 64,
      connectionStrength: 82,
      pressureVariation: 20,
      maxWordTilt: 2.8,
      maxLift: 2.6,
      maxLetterSpacing: 0.5,
      directionChance: 52,
      authorSlant: 4,
      authorWidth: 94,
      authorRhythm: 58,
      authorBaseline: 42,
    },
  },
  broad: {
    label: "Размашистый",
    description: "Широкие буквы, длинные хвосты и свободные интервалы.",
    settings: {
      glyphVariation: 72,
      connectionStrength: 68,
      pressureVariation: 27,
      maxWordTilt: 4.2,
      maxLift: 3.8,
      maxLetterSpacing: 0.9,
      directionChance: 56,
      authorSlant: 6,
      authorWidth: 108,
      authorRhythm: 72,
      authorBaseline: 55,
    },
  },
  hurried: {
    label: "Торопливый",
    description: "Узкие буквы, сильные соединения и неровный темп.",
    settings: {
      glyphVariation: 78,
      connectionStrength: 91,
      pressureVariation: 32,
      maxWordTilt: 5.8,
      maxLift: 4.4,
      maxLetterSpacing: 0.35,
      directionChance: 61,
      authorSlant: 9,
      authorWidth: 89,
      authorRhythm: 86,
      authorBaseline: 68,
    },
  },
});

export function profilePatch(id) {
  const profile = HANDWRITING_PROFILES[id] || HANDWRITING_PROFILES.personal;
  return {
    handwritingProfile: id in HANDWRITING_PROFILES ? id : "personal",
    ...(id !== "personal" ? Object.fromEntries(STRUCTURE_CONTROLS.map((control) => [control.key, control.initial])) : {}),
    ...profile.settings,
  };
}

function countCharacters(source) {
  const counts = new Map();
  for (const character of Array.from(
    String(source).toLocaleLowerCase("ru-RU"),
  )) {
    if (!/[\p{L}\p{N}]/u.test(character)) continue;
    counts.set(character, (counts.get(character) || 0) + 1);
  }
  return counts;
}

export function analyzeNaturalness(source, settings) {
  const counts = countCharacters(source);
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const repeats = [...counts]
    .filter(([, count]) => count > 2)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([character, count]) => ({ character, count }));

  if (!total) {
    return {
      level: "empty",
      repeats: [],
      recommendations: ["Добавьте текст, чтобы оценить повторяемость почерка."],
    };
  }

  const variation = Math.max(0, Math.min(100, Number(settings.glyphVariation) || 0));
  const coherence = Math.max(0, Math.min(100, Number(settings.wordCoherence) || 0));
  const rhythm = Math.max(0, Math.min(100, Number(settings.authorRhythm) || 0));
  const baseline = Math.max(0, Math.min(100, Number(settings.authorBaseline) || 0));
  const connections = Math.max(0, Math.min(100, Number(settings.connectionStrength) || 0));
  const recommendations = [];
  if (variation > 40)
    recommendations.push("Сильные искажения меняют форму букв. Уменьшите вариативность, сохранив реальные варианты начертаний.");
  if (coherence < 75)
    recommendations.push("Увеличьте согласованность букв, чтобы наклон, размер и характер форм не менялись резко внутри слова.");
  if (rhythm > 50 || baseline > 35)
    recommendations.push("Снизьте ритм и колебание строки: крупные независимые смещения выглядят неестественно.");
  if (connections < 40)
    recommendations.push("Низкая связность оставляет буквы отдельно. Сверьте соединения с вашим образцом.");
  if (settings.fontType === "plotter" && Number(settings.lineFitCompression) === 0)
    recommendations.push("Уплотнение строки отключено: не поместившееся слово сразу переносится.");
  const level = recommendations.length ? "review" : "good";
  if (!recommendations.length)
    recommendations.push("Сильных искажений в настройках нет. Сходство почерка проверяйте по образцу, а не по числу случайных эффектов.");
  return { level, repeats, recommendations };
}

export function naturalnessAutofix(settings) {
  const bounded = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));
  return {
    glyphVariation: bounded(settings.glyphVariation, 12, 28),
    wordCoherence: bounded(settings.wordCoherence, 85, 100),
    authorRhythm: bounded(settings.authorRhythm, 18, 34),
    authorBaseline: bounded(settings.authorBaseline, 8, 22),
    connectionStrength: bounded(settings.connectionStrength, 62, 100),
    ...(settings.fontType === "plotter" ? { lineFitCompression: bounded(settings.lineFitCompression, 16, 24) } : {}),
    handwritingProfile: "personal",
  };
}
