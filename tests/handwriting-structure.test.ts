import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { normalizeSettings, DEFAULT_SETTINGS } from "../src/app/config";
import { profilePatch } from "../src/handwriting/profiles";
import { wordMotion, shapeVertical, spaceFactor } from "../src/handwriting/structure";
import { GFont, BUILTIN_GFONT_OPTIONS } from "../src/plotter/gfont";
import { layoutText } from "../src/plotter/job";

const bytes = readFileSync(new URL("../font/plotter/ReTest.gfont", import.meta.url));
const font = new GFont(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const page = { pageWidth: 148, pageHeight: 210, left: 12, right: 12, top: 12, bottom: 12, fontSize: 5, lineHeight: 9 };
const settings = { ...DEFAULT_SETTINGS, ...profilePatch("notebook"), letterSpacing: 0.3 };

describe("handwriting structure and actual ReTest paths", () => {
  it("bundles the personal font and reads Cyrillic letters", async () => {
    expect(BUILTIN_GFONT_OPTIONS.some((item) => item.id === "retest-original")).toBe(true);
    for (const char of "Обществоучение") expect((await font.getGlyph(char.codePointAt(0)))?.points.length).toBeGreaterThan(2);
  });
  it("keeps body and baseline fixed when extending loops", () => {
    expect(shapeVertical(-150, -200, { ascenderScale: 130 })).toBe(-150);
    expect(shapeVertical(-300, -200, { ascenderScale: 130 })).toBe(-330);
    expect(shapeVertical(80, -200, { descenderScale: 125 })).toBe(100);
    expect(shapeVertical(0, -200, settings)).toBe(0);
  });
  it("shares word posture, tapers long words, and disables random structure", () => {
    const a = wordMotion(settings, "word", 0, 8);
    const b = wordMotion(settings, "word", 7, 8);
    expect(a.height).toBe(b.height);
    expect(b.width).toBeLessThan(a.width);
    expect(wordMotion({ ...settings, trueHandwriting: false }, "word", 7, 8)).toMatchObject({ coherence: 0, width: 1, height: 1, slant: 0, baseline: 0 });
    expect(spaceFactor(settings, "a")).not.toBe(spaceFactor(settings, "b"));
  });
  it("normalizes imported values and resets structural controls on profile changes", () => {
    expect(normalizeSettings({ wordSpacing: Infinity, endCompression: 99, descenderScale: -100 })).toMatchObject({ wordSpacing: 100, endCompression: 18, descenderScale: 75 });
    expect(profilePatch("careful")).toMatchObject({ wordCoherence: 0, wordSpacing: 100 });
    expect(profilePatch("personal")).toEqual({ handwritingProfile: "personal" });
  });
  it("produces deterministic finite trajectories without changing source glyphs", async () => {
    const before = JSON.stringify(await font.getGlyph(1072));
    const text = "Общество — это система отношений между людьми.\nУчение и работа.";
    const a = await layoutText(text, font, page, settings);
    const b = await layoutText(text, font, page, settings);
    expect(a).toEqual(b);
    expect(a.missing).toEqual([]);
    expect(a.strokes.length).toBeGreaterThan(30);
    expect(a.strokes.flat().every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(JSON.stringify(await font.getGlyph(1072))).toBe(before);
    expect((await layoutText(text, font, page, { ...settings, seed: 100 })).strokes).not.toEqual(a.strokes);
  });
  it("uses wider spaces in actual geometry and retains overflow text", async () => {
    const small = await layoutText("а а", font, page, { ...settings, wordSpacing: 55 });
    const wide = await layoutText("а а", font, page, { ...settings, wordSpacing: 160 });
    expect(Math.max(...wide.strokes.flat().map((p) => p.x))).toBeGreaterThan(Math.max(...small.strokes.flat().map((p) => p.x)));
    const short = await layoutText("учение ".repeat(100), font, { ...page, pageHeight: 35 }, settings);
    expect(short.clipped).toBe(true);
    expect(short.overflowText.length).toBeGreaterThan(0);
  });
  it("positive slant leans the top right", async () => {
    const plain = { ...settings, trueHandwriting: false, authorSlant: 0 };
    const a = await layoutText("а", font, page, plain);
    const b = await layoutText("а", font, page, { ...plain, authorSlant: 10 });
    const pa = a.strokes.flat();
    const pb = b.strokes.flat();
    const top = pa.reduce((best, p, i) => p.y < pa[best].y ? i : best, 0);
    expect(pb[top].x).toBeGreaterThan(pa[top].x);
  });
});

it("indents only the first paragraph line and adds paragraph spacing", async () => {
  const { PLOTTER_PARAGRAPH_MARKS: marks } = await import("../src/plotter/richText");
  const text = `${marks.start}а${marks.end}\n${marks.start}а${marks.end}`;
  const config = { ...settings, trueHandwriting: false, authorBaseline: 0 };
  const a = await layoutText(text, font, page, config);
  const b = await layoutText(text, font, page, { ...config, paragraphIndent: 100, paragraphGap: 50 });
  expect(b.missing).toEqual([]);
  expect(b.strokes[0][0].x - a.strokes[0][0].x).toBeCloseTo(page.fontSize);
  expect(b.strokes.at(-1)[0].y - a.strokes.at(-1)[0].y).toBeCloseTo(page.lineHeight * 0.5);
});
