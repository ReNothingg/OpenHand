import { describe, expect, it } from "vitest";
import { dxfToSvg } from "../src/lib/dxfImport";

function dxf(entities: string) {
  return `0\nSECTION\n2\nENTITIES\n${entities}\n0\nENDSEC\n0\nEOF\n`;
}

describe("DXF import", () => {
  it("converts line and circle entities to local SVG paths", () => {
    const source = dxf(
      "0\nLINE\n10\n0\n20\n0\n11\n100\n21\n50\n0\nCIRCLE\n10\n50\n20\n25\n40\n10",
    );
    const svg = dxfToSvg(source);
    expect(svg).toContain("<svg");
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).not.toContain("href=");
  });

  it("supports classic POLYLINE vertices", () => {
    const source = dxf(
      "0\nPOLYLINE\n70\n1\n0\nVERTEX\n10\n0\n20\n0\n0\nVERTEX\n10\n10\n20\n0\n0\nVERTEX\n10\n10\n20\n10\n0\nSEQEND",
    );
    expect(dxfToSvg(source)).toContain("L0 10");
  });

  it("rejects binary or unsupported drawings", () => {
    expect(() => dxfToSvg("\u0000AutoCAD Binary DXF")).toThrow("ASCII DXF");
    expect(() => dxfToSvg(dxf("0\nTEXT\n1\nhello"))).toThrow(
      "не найдено",
    );
  });
});
