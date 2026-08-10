import { describe, expect, it } from "vitest";
import {
  base64DecodedSize,
  MAX_GCODE_FILE_BYTES,
  MAX_GCODE_PREVIEW_SEGMENTS,
  previewSegments,
  validateGCodeFileSize,
} from "../src/gcode/limits";

describe("G-code limits", () => {
  it("accounts for Base64 padding when checking native payloads", () => {
    expect(base64DecodedSize("YQ==")).toBe(1);
    expect(base64DecodedSize("YWI=")).toBe(2);
    expect(base64DecodedSize("YWJj")).toBe(3);
  });

  it("accepts the exact file limit and rejects the next byte", () => {
    expect(() => validateGCodeFileSize(MAX_GCODE_FILE_BYTES)).not.toThrow();
    expect(() => validateGCodeFileSize(MAX_GCODE_FILE_BYTES + 1)).toThrow(
      "больше",
    );
  });

  it("bounds the number of segments sent to the SVG preview", () => {
    const segments = Array.from(
      { length: MAX_GCODE_PREVIEW_SEGMENTS + 1 },
      (_, index) => index,
    );
    const preview = previewSegments(segments);
    expect(preview.length).toBeLessThanOrEqual(MAX_GCODE_PREVIEW_SEGMENTS);
    expect(preview[0]).toBe(0);
  });
});
