import { describe, expect, it } from "vitest";
import { xlsxToMarkdown } from "../src/lib/xlsxImport";

function concatenate(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function storedZip(entries: Array<[string, string]>) {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let localOffset = 0;
  for (const [entryName, value] of entries) {
    const name = encoder.encode(entryName);
    const contents = encoder.encode(value);
    const local = new Uint8Array(30);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint32(18, contents.length, true);
    localView.setUint32(22, contents.length, true);
    localView.setUint16(26, name.length, true);
    const localRecord = concatenate(local, name, contents);
    locals.push(localRecord);

    const central = new Uint8Array(46);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(20, contents.length, true);
    centralView.setUint32(24, contents.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, localOffset, true);
    centrals.push(concatenate(central, name));
    localOffset += localRecord.length;
  }
  const directory = concatenate(...centrals);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, localOffset, true);
  return concatenate(...locals, directory, end).buffer;
}

describe("XLSX import", () => {
  it("reads shared, inline and numeric cells from the first sheet", async () => {
    const workbook = storedZip([
      [
        "xl/sharedStrings.xml",
        '<sst><si><t>Имя</t></si><si><t>Анна &amp; Борис</t></si></sst>',
      ],
      [
        "xl/worksheets/sheet1.xml",
        '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Балл</t></is></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>10</v></c></row></sheetData></worksheet>',
      ],
    ]);
    const markdown = await xlsxToMarkdown(workbook);
    expect(markdown).toContain("| Имя | Балл |");
    expect(markdown).toContain("| Анна & Борис | 10 |");
  });
});
