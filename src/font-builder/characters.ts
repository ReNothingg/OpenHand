export const CHARACTER_GROUPS = [
  {
    id: "ru",
    label: "Кириллица",
    characters: Array.from(
      "АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя",
    ),
  },
  {
    id: "en",
    label: "Латиница",
    characters: Array.from(
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz",
    ),
  },
  {
    id: "numbers",
    label: "Цифры",
    characters: Array.from("0123456789"),
  },
  {
    id: "symbols",
    label: "Знаки",
    characters: Array.from(".,!?;:—-()[]«»\"'№@#+=/"),
  },
];

export const ALL_CHARACTERS = [
  ...new Set(CHARACTER_GROUPS.flatMap((group) => group.characters)),
];

export const PREVIEW_TEXT = {
  ru: "Съешь ещё этих мягких французских булок",
  en: "The quick brown fox jumps over the lazy dog",
  numbers: "2026 — 12:45",
  symbols: "«Привет!» — OpenHand.",
};
