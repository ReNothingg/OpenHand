/** "1 лист", "3 листа", "11 листов": Russian plural forms with a localized number. */
export function plural(count: number, one: string, few: string, many: string) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  const word = mod10 === 1 && mod100 !== 11 ? one
    : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
  return `${count.toLocaleString("ru-RU")} ${word}`;
}
