const VOWELS = new Set(Array.from("аеёиоуыэюя"));
const SIGNS = new Set(Array.from("йьъ"));
const LETTER = /^\p{L}$/u;
const CYRILLIC = /^[а-яё]$/iu;

type Kind = "g" | "s" | "x";

function kind(char: string): Kind {
  const lower = char.toLocaleLowerCase("ru-RU");
  if (VOWELS.has(lower)) return "g";
  if (SIGNS.has(lower)) return "x";
  return "s";
}

function syllableBreaks(letters: string[]): number[] {
  const kinds = letters.map(kind);
  const at = (i: number) => kinds[i];
  const breaks: number[] = [];
  for (let i = 2; i <= letters.length - 2; i++) {
    if (at(i) === "x") continue;
    if (!kinds.slice(0, i).includes("g") || !kinds.slice(i).includes("g")) continue;
    const allowed =
      at(i - 1) === "x" ||
      (at(i - 1) === "g" && at(i) === "g") ||
      (at(i - 1) === "g" && at(i) === "s" && at(i + 1) === "g") ||
      (at(i - 2) === "g" && at(i - 1) === "s" && at(i) === "s" && at(i + 1) === "g") ||
      (at(i - 2) === "g" && at(i - 1) === "s" && at(i) === "s" && at(i + 1) === "s" && at(i + 2) === "g") ||
      (at(i - 3) === "g" && at(i - 2) === "s" && at(i - 1) === "s" && at(i) === "s" && at(i + 1) === "s" && at(i + 2) === "g");
    if (allowed) breaks.push(i);
  }
  return breaks;
}

export type HyphenSplit = { head: string; tail: string };

export function hyphenSplits(word: string): HyphenSplit[] {
  const chars = Array.from(word);
  let start = 0;
  while (start < chars.length && !LETTER.test(chars[start]!)) start++;
  let end = chars.length;
  while (end > start && !LETTER.test(chars[end - 1]!)) end--;
  const leading = chars.slice(0, start), trailing = chars.slice(end), core = chars.slice(start, end);
  if (core.length < 4 || [...leading, ...trailing].some(char => /[\p{L}\p{N}]/u.test(char))) return [];
  if (!core.every(char => CYRILLIC.test(char) || char === "-")) return [];
  const positions: { index: number; hyphen: boolean }[] = [];
  let offset = 0;
  const pieces = core.join("").split("-").map(piece => Array.from(piece));
  if (pieces.some(piece => !piece.length)) return [];
  pieces.forEach((piece, k) => {
    const abbreviation = piece.length > 1 && piece.every(char => char === char.toLocaleUpperCase("ru-RU"));
    if (!abbreviation) for (const i of syllableBreaks(piece)) positions.push({ index: offset + i, hyphen: true });
    offset += piece.length + 1;
    if (k < pieces.length - 1) positions.push({ index: offset, hyphen: false });
  });
  return positions
    .sort((a, b) => b.index - a.index)
    .map(({ index, hyphen }) => ({
      head: [...leading, ...core.slice(0, index)].join("") + (hyphen ? "-" : ""),
      tail: [...core.slice(index), ...trailing].join(""),
    }));
}
