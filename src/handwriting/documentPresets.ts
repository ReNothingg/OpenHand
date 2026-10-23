export const DOCUMENT_PRESETS = [
  { id: 'lecture', label: 'Конспект лекции', description: 'Компактные строки и небольшой отступ абзаца.', settings: { fontSize: 36, lineHeight: 1.15, paragraphIndent: 120, paragraphGap: 15, wordSpacing: 76 } },
  { id: 'summary', label: 'Краткие тезисы', description: 'Свободнее интервалы для списков и коротких пунктов.', settings: { fontSize: 36, lineHeight: 1.6, paragraphIndent: 0, paragraphGap: 35, wordSpacing: 86 } },
  { id: 'report', label: 'Развёрнутые записи', description: 'Выраженная красная строка и ровный основной текст.', settings: { fontSize: 36, lineHeight: 1.15, paragraphIndent: 200, paragraphGap: 20, wordSpacing: 80 } },
] as const;
