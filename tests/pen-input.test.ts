import { describe, expect, it } from "vitest";
import { acceptsPointer, appendSample, completeStroke, DEFAULT_PEN_SETTINGS, nibWidth, normalizePenSettings, penPoint, strokeHit, type FontStroke } from "../src/font-builder/penInput";
import { createGFontBlob } from "../src/font-builder/gfontExport";
import { GFont } from "../src/plotter/gfont";

const pointer = { pointerType: "pen", button: 0, isPrimary: false, width: 2, height: 2 };
describe("pen input", () => {
  it("prioritizes Pencil even when the palm is the primary pointer", () => {
    expect(acceptsPointer("pen", pointer, false)).toBe(true);
    expect(acceptsPointer("pen", { ...pointer, pointerType: "touch", isPrimary: true }, false)).toBe(false);
    expect(acceptsPointer("auto", { ...pointer, pointerType: "touch", isPrimary: true }, true)).toBe(false);
    expect(acceptsPointer("all", { ...pointer, pointerType: "touch", isPrimary: true }, true)).toBe(true);
    expect(acceptsPointer("auto", { ...pointer, button: 5 }, true)).toBe(true);
  });
  it("stores pressure and tilt, but does not invent mouse pressure", () => {
    const sample = { pressure: 0.2, tiltX: 32, tiltY: -18, timeStamp: 123 };
    expect(penPoint(sample, { x: 1, y: 2 }, "pen", 100)).toEqual({ x: 1, y: 2, pressure: 0.2, tiltX: 32, tiltY: -18, time: 23 });
    expect(penPoint(sample, { x: 1, y: 2 }, "mouse", 100)).toEqual({ x: 1, y: 2 });
    expect(nibWidth({ x: 0, y: 0, pressure: 0.9 }, DEFAULT_PEN_SETTINGS)).toBeGreaterThan(nibWidth({ x: 0, y: 0, pressure: 0.1 }, DEFAULT_PEN_SETTINGS));
    expect(nibWidth({ x: 0, y: 0, pressure: 0.9 }, { ...DEFAULT_PEN_SETTINGS, pressureEnabled: false })).toBe(nibWidth({ x: 0, y: 0, pressure: 0.1 }, { ...DEFAULT_PEN_SETTINGS, pressureEnabled: false }));
  });
  it("keeps pressure changes at a stationary tip and preserves endpoints", () => {
    const stroke: FontStroke = [{ x: 0, y: 0, pressure: 0.1 }];
    appendSample(stroke, { x: 0, y: 0, pressure: 0.8 }, 70);
    expect(stroke).toHaveLength(2);
    appendSample(stroke, { x: 10, y: 15, pressure: 0.8 }, 70, true);
    expect(stroke.at(-1)).toMatchObject({ x: 10, y: 15 });
    expect(completeStroke([{ x: 2, y: 2, pressure: 0.3 }])).toHaveLength(2);
  });
  it("erases segments between sparse samples", () => {
    expect(strokeHit([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 50, y: 2 }, 3)).toBe(true);
    expect(strokeHit([{ x: 0, y: 0 }, { x: 100, y: 0 }], { x: 50, y: 5 }, 3)).toBe(false);
  });
  it("round-trips original geometry and pen metadata in GFont", async () => {
    const points = [{ x: 12, y: -50, pressure: 0.2, tiltX: 22, tiltY: -15, time: 0 }, { x: 24, y: 0, pressure: 0.8, tiltX: 40, tiltY: -10, time: 10 }];
    const font = new GFont(await createGFontBlob({ А: [points] }).arrayBuffer());
    expect(font.entries.size).toBe(1);
    expect((await font.getGlyph(1040)).points).toEqual(points);
    const legacy = new GFont(await createGFontBlob({ А: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] }).arrayBuffer());
    expect((await legacy.getGlyph(1040)).points).toEqual([{ x: 0, y: 0 }, { x: 1, y: 1 }]);
  });
  it("keeps metadata indices aligned when empty strokes are omitted", async () => {
    const font = new GFont(await createGFontBlob({ а: [[{ x: 0, y: 0, pressure: 1 }], [{ x: 3, y: 2, pressure: 0.1 }, { x: 6, y: 7, pressure: 0.7 }]] }).arrayBuffer());
    expect((await font.getGlyph(1072)).points.map(p => p.pressure)).toEqual([0.1, 0.7]);
  });
  it("normalizes settings and discards invalid imported sensor metadata", async () => {
    expect(normalizePenSettings({ smoothing: NaN, pressureResponse: 50 })).toMatchObject({ smoothing: 25, pressureResponse: 2 });
    const font = new GFont(await createGFontBlob({ а: [[{ x: 0, y: 0, pressure: -9, tiltX: 800 }, { x: 1, y: 1, pressure: 0.4 }]] }).arrayBuffer());
    expect((await font.getGlyph(1072)).points[0]).toEqual({ x: 0, y: 0 });
  });
});
