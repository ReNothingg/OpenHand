export const DOCUMENT_PRESETS = [
  { id: 'lecture', label: 'Конспект лекции', description: 'Компактные строки и небольшой отступ абзаца.', settings: { fontSize: 27, lineHeight: 1.5, paragraphIndent: 120, paragraphGap: 15, wordSpacing: 92 } },
  { id: 'summary', label: 'Краткие тезисы', description: 'Свободнее интервалы для списков и коротких пунктов.', settings: { fontSize: 28, lineHeight: 1.65, paragraphIndent: 0, paragraphGap: 35, wordSpacing: 100 } },
  { id: 'report', label: 'Развёрнутые записи', description: 'Выраженная красная строка и ровный основной текст.', settings: { fontSize: 26, lineHeight: 1.6, paragraphIndent: 200, paragraphGap: 20, wordSpacing: 100 } },
] as const;
