import { describe, expect, it } from "vitest";
import { parseGCode, segmentsToPathChunks } from "../src/gcode/parser";

describe("G-code parser", () => {
  it("separates rapid travel from linear drawing", () => {
    const result = parseGCode("G21\nG90\nG0 X10 Y0\nG1 X20 Y0");
    expect(result.travel).toHaveLength(1);
    expect(result.drawing).toHaveLength(1);
    expect(result.travelDistance).toBeCloseTo(10);
    expect(result.drawDistance).toBeCloseTo(10);
  });

  it("tracks explicit spindle and laser pen state", () => {
    const result = parseGCode(
      "G21 G90\nM5\nG1 X10 Y0\nM3\nG1 X20 Y0\nM5\nG1 X30 Y0",
    );
    expect(result.travel).toHaveLength(2);
    expect(result.drawing).toHaveLength(1);
    expect(result.drawDistance).toBeCloseTo(10);
  });

  it("uses Z direction as pen state for stepper plotters", () => {
    const result = parseGCode(
      "G21 G90\nG1 Z5\nG1 X10 Y0\nG1 Z0\nG1 X20 Y0",
    );
    expect(result.travelDistance).toBeCloseTo(10);
    expect(result.drawDistance).toBeCloseTo(10);
  });

  it("converts inch units and relative coordinates", () => {
    const result = parseGCode("G20\nG91\nG1 X1 Y0\nG1 X1 Y0");
    expect(result.bounds.maxX).toBeCloseTo(50.8);
    expect(result.drawDistance).toBeCloseTo(50.8);
  });

  it("approximates circular arcs while retaining their bounds", () => {
    const result = parseGCode("G21 G90\nG0 X10 Y0\nG3 X-10 Y0 I-10 J0");
    expect(result.drawing.length).toBeGreaterThan(10);
    expect(result.drawDistance).toBeCloseTo(Math.PI * 10, 1);
    expect(result.bounds.maxY).toBeCloseTo(10, 1);
  });

  it("supports absolute arc centers", () => {
    const result = parseGCode(
      "G21 G90 G90.1\nG0 X10 Y0\nG3 X-10 Y0 I0 J0",
    );
    expect(result.drawDistance).toBeCloseTo(Math.PI * 10, 1);
    expect(result.bounds.maxY).toBeCloseTo(10, 1);
    expect(result.unsupportedMotionLines).toEqual([]);
  });

  it("resets coordinates with G92 without adding a false movement", () => {
    const result = parseGCode(
      "G21 G90\nG0 X10 Y0\nG92 X0 Y0\nG1 X5 Y0",
    );
    expect(result.travelDistance).toBeCloseTo(10);
    expect(result.drawDistance).toBeCloseTo(5);
    expect(result.drawingSegmentCount).toBe(1);
  });

  it("caps retained preview segments without losing exact statistics", () => {
    const source = Array.from(
      { length: 10 },
      (_, index) => `G1 X${index + 1}`,
    ).join("\n");
    const result = parseGCode(source, {
      includeLines: false,
      maxSegmentsPerKind: 2,
    });
    expect(result.lines).toEqual([]);
    expect(result.lineCount).toBe(10);
    expect(result.lineOffsets).toHaveLength(10);
    expect(result.drawing).toHaveLength(2);
    expect(result.drawingSegmentCount).toBe(10);
    expect(result.drawDistance).toBeCloseTo(10);
    expect(result.bounds.maxX).toBe(10);
  });

  it("reports non-command text and chunks long SVG paths", () => {
    const result = parseGCode("not gcode\nG1 X1\nG1 X2\nG1 X3");
    expect(result.ignoredLines).toEqual([1]);
    expect(segmentsToPathChunks(result.drawing, 2)).toHaveLength(2);
  });
});
