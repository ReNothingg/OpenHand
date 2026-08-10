import { describe, expect, it } from "vitest";
import {
  GFont,
  MAX_GFONT_ARCHIVE_BYTES,
  loadGFont,
} from "../src/plotter/gfont";

function concatenate(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function glyphBytes(codePoint: number) {
  const bytes = new Uint8Array(2 + 4 + 4 * 4 + 4 + 2);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, codePoint, false);
  view.setUint32(2, 4, false);
  [0, 0, 10, 5].forEach((value, index) =>
    view.setFloat32(6 + index * 4, value, false),
  );
  view.setUint32(22, 2, false);
  bytes.set([1, 0], 26);
  return bytes;
}

function storedZip(entryName: string, contents: Uint8Array) {
  const name = new TextEncoder().encode(entryName);
  const local = new Uint8Array(30);
  const localView = new DataView(local.buffer);
  localView.setUint32(0, 0x04034b50, true);
  localView.setUint16(4, 20, true);
  localView.setUint32(18, contents.length, true);
  localView.setUint32(22, contents.length, true);
  localView.setUint16(26, name.length, true);
  const localRecord = concatenate(local, name, contents);

  const central = new Uint8Array(46);
  const centralView = new DataView(central.buffer);
  centralView.setUint32(0, 0x02014b50, true);
  centralView.setUint16(4, 20, true);
  centralView.setUint16(6, 20, true);
  centralView.setUint32(20, contents.length, true);
  centralView.setUint32(24, contents.length, true);
  centralView.setUint16(28, name.length, true);
  const directory = concatenate(central, name);

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, 1, true);
  endView.setUint16(10, 1, true);
  endView.setUint32(12, directory.length, true);
  endView.setUint32(16, localRecord.length, true);
  return concatenate(localRecord, directory, end).buffer;
}

describe("GFont validation", () => {
  it("reads a bounded stored glyph", async () => {
    const font = await loadGFont(storedZip("65", glyphBytes(65)), "test.gfont");
    expect(font.has(65)).toBe(true);
    expect(await font.getGlyph(65)).toMatchObject({
      codePoint: 65,
      bounds: { minX: 0, maxX: 10, minY: 0, maxY: 5 },
    });
  });

  it("rejects missing and truncated ZIP directories", () => {
    expect(() => new GFont(new ArrayBuffer(12))).toThrow("ZIP-каталог");
    const bytes = new Uint8Array(storedZip("65", glyphBytes(65)));
    bytes[bytes.length - 6] = 0xff;
    expect(() => new GFont(bytes.buffer)).toThrow();
  });

  it("rejects archives above the explicit memory limit", () => {
    expect(() => new GFont(new ArrayBuffer(MAX_GFONT_ARCHIVE_BYTES + 1))).toThrow(
      "больше",
    );
  });
});
