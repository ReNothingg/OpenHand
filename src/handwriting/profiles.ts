import { STRUCTURE_CONTROLS } from "./structure";
export const PAVEL_NOTES_WRITING_CONFIG = Object.freeze({ feedRate: 900, letterSpacing: 0.1, optimizePath: false, compactPaths: true });

export const HANDWRITING_PROFILES = Object.freeze({
  personal: {
    label: "Мой текущий",
    description: "Не меняет настроенные вручную значения.",
    settings: {},
  },
  pavelNotes: {
    label: "Павел · по конспектам",
    description: "Реконструкция букв по 14 фото. Наклон и петли уже в шрифте; размер для строки около 10 мм. Письмо 900 мм/мин, интервал 0,1 мм; требуется проба на бумаге.",
    settings: {
      fontType: "plotter", plotterFontId: "pavel-notes-original", trueHandwriting: true,
      fontSize: 27, lineHeight: 1.4, inkColor: "#233266",
      glyphVariation: 18, connectionStrength: 72, pressureVariation: 0,
      maxWordTilt: 0.7, maxLift: 0.4, maxLetterSpacing: 0.15,
      authorSlant: 0, authorWidth: 100, authorRhythm: 22, authorBaseline: 12,
      wordSpacing: 82, spaceVariation: 16, wordCoherence: 85, endCompression: 4,
      ascenderScale: 100, descenderScale: 100, correctionChance: 0, fatigueEnabled: false,
      fontRandomization: 0, maxLineDrift: 0,
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
      score: 100,
      level: "empty",
      repeats: [],
      recommendations: ["Добавьте текст, чтобы оценить повторяемость почерка."],
    };
  }

  const concentration =
    repeats.reduce((sum, item) => sum + Math.max(0, item.count - 2), 0) / total;
  const variation = Math.max(
    0,
    Math.min(100, Number(settings.glyphVariation) || 0),
  );
  const pressure = Math.max(
    0,
    Math.min(50, Number(settings.pressureVariation) || 0),
  );
  const rhythm = Math.max(0, Math.min(100, Number(settings.authorRhythm) || 0));
  const connections = Math.max(
    0,
    Math.min(100, Number(settings.connectionStrength) || 0),
  );
  const safeguards =
    variation * 0.38 +
    pressure * 0.34 +
    rhythm * 0.22 +
    connections * 0.12 +
    (settings.fatigueEnabled ? 12 : 0);
  const repetitionRisk =
    concentration * 58 + Math.max(0, 58 - variation) * 0.52;
  const score = Math.round(
    Math.max(0, Math.min(100, 76 + safeguards * 0.32 - repetitionRisk)),
  );
  const recommendations = [];
  if (variation < 45 && concentration > 0.12)
    recommendations.push("Увеличить вариативность повторяющихся букв.");
  if (pressure < 12)
    recommendations.push("Добавить небольшое изменение давления.");
  if (rhythm < 30) recommendations.push("Добавить индивидуальный ритм автора.");
  if (!settings.fatigueEnabled && total > 280)
    recommendations.push("Для длинного текста включить усталость почерка.");
  if (connections < 40)
    recommendations.push(
      "Низкая связность делает письмо похожим на набор отдельных глифов.",
    );
  if (!recommendations.length)
    recommendations.push("Повторяемость сбалансирована для текущего текста.");
  return {
    score,
    level: score >= 82 ? "good" : score >= 62 ? "medium" : "risk",
    repeats,
    recommendations,
  };
}

export function naturalnessAutofix(settings) {
  return {
    glyphVariation: Math.max(64, Number(settings.glyphVariation) || 0),
    pressureVariation: Math.max(18, Number(settings.pressureVariation) || 0),
    authorRhythm: Math.max(52, Number(settings.authorRhythm) || 0),
    connectionStrength: Math.max(62, Number(settings.connectionStrength) || 0),
    fatigueEnabled: true,
    handwritingProfile: "personal",
  };
}
