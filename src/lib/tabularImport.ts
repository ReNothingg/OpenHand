const MAX_TABLE_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_TABLE_ROWS = 2000;
const MAX_TABLE_COLUMNS = 100;

function detectDelimiter(source: string) {
  const sample = source.split(/\r?\n/, 12).join("\n");
  const scores = ["\t", ";", ","].map((delimiter) => ({
    delimiter,
    count: [...sample].filter((character) => character === delimiter).length,
  }));
  return scores.sort((left, right) => right.count - left.count)[0]?.delimiter ||
    ",";
}

export function parseDelimitedText(source: string, delimiter?: string) {
  const normalized = String(source || "").replace(/^\uFEFF/, "");
  if (new TextEncoder().encode(normalized).byteLength > MAX_TABLE_SOURCE_BYTES)
    throw new Error("Таблица больше 4 МБ.");
  const separator = delimiter || detectDelimiter(normalized);
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;

  const pushValue = () => {
    row.push(value.trim());
    value = "";
    if (row.length > MAX_TABLE_COLUMNS)
      throw new Error(`В таблице больше ${MAX_TABLE_COLUMNS} столбцов.`);
  };
  const pushRow = () => {
    pushValue();
    if (row.some((cell) => cell.length)) rows.push(row);
    row = [];
    if (rows.length > MAX_TABLE_ROWS)
      throw new Error(`В таблице больше ${MAX_TABLE_ROWS} строк.`);
  };

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === '"') {
      if (quoted && normalized[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === separator && !quoted) {
      pushValue();
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && normalized[index + 1] === "\n") index += 1;
      pushRow();
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("В таблице не закрыта кавычка.");
  if (value.length || row.length) pushRow();
  if (!rows.length) throw new Error("Таблица пуста.");
  const width = Math.max(...rows.map((item) => item.length));
  return rows.map((item) => [
    ...item,
    ...Array.from({ length: width - item.length }, () => ""),
  ]);
}

function markdownCell(value: string) {
  return String(value || "")
    .replace(/\r?\n/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\|/g, "\\|")
    .trim();
}

export function rowsToMarkdown(rows: string[][]) {
  if (!rows.length) throw new Error("Таблица пуста.");
  const header = rows[0];
  const body = rows.slice(1);
  return [
    `| ${header.map(markdownCell).join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map(markdownCell).join(" | ")} |`),
  ].join("\n");
}

export function delimitedTextToMarkdown(source: string, delimiter?: string) {
  return rowsToMarkdown(parseDelimitedText(source, delimiter));
}
