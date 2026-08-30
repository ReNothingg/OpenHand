import { rowsToMarkdown } from "./tabularImport";
import { BoundedZipReader } from "./zipReader";

const decoder = new TextDecoder();

function decodeXml(value: string) {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number(decimal)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textNodes(xml: string) {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "A";
  let value = 0;
  for (const letter of letters)
    value = value * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, value - 1);
}

function sheetRows(xml: string, sharedStrings: string[]) {
  const rows: string[][] = [];
  for (const rowMatch of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/gi)) {
    const row: string[] = [];
    const body = rowMatch[1];
    for (const cellMatch of body.matchAll(/<c(?:\s([^>]*))?>([\s\S]*?)<\/c>/gi)) {
      const attributes = cellMatch[1] || "";
      const contents = cellMatch[2] || "";
      const reference = /\br="([^"]+)"/i.exec(attributes)?.[1] || "A1";
      const type = /\bt="([^"]+)"/i.exec(attributes)?.[1] || "n";
      const raw = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/i.exec(contents)?.[1] || "";
      let value = decodeXml(raw);
      if (type === "s") value = sharedStrings[Number(raw)] || "";
      else if (type === "inlineStr") value = textNodes(contents);
      else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
      const column = columnIndex(reference);
      if (column >= 100) throw new Error("В XLSX больше 100 столбцов.");
      row[column] = value;
    }
    if (row.some((value) => String(value || "").length)) {
      rows.push(Array.from({ length: row.length }, (_, index) => row[index] || ""));
      if (rows.length > 2000) throw new Error("В XLSX больше 2000 строк.");
    }
  }
  if (!rows.length) throw new Error("Первый лист XLSX пуст.");
  const width = Math.max(...rows.map((row) => row.length));
  return rows.map((row) => [
    ...row,
    ...Array.from({ length: width - row.length }, () => ""),
  ]);
}

export async function xlsxToMarkdown(buffer: ArrayBuffer) {
  if (buffer.byteLength > 16 * 1024 * 1024)
    throw new Error("XLSX больше 16 МБ.");
  const zip = new BoundedZipReader(buffer);
  const sharedBytes = await zip.read("xl/sharedStrings.xml");
  const sharedStrings = sharedBytes
    ? [...decoder.decode(sharedBytes).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)].map(
        (match) => textNodes(match[1]),
      )
    : [];
  const sheetName = zip
    .names()
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))[0];
  if (!sheetName) throw new Error("В XLSX не найден лист с данными.");
  const sheetBytes = await zip.read(sheetName);
  if (!sheetBytes) throw new Error("Не удалось прочитать первый лист XLSX.");
  return rowsToMarkdown(sheetRows(decoder.decode(sheetBytes), sharedStrings));
}
