import { describe, expect, it } from "vitest";
import {
  alignToOrigin,
  bounds,
  hatch,
  parseCoordinateCSV,
  parseHPGL,
  parseWorkshop,
  repeat,
  serializeWorkshop,
  shape,
  transform,
  validateStrokes,
} from "../src/plotter/workshop";
import { compilePlotJob, DEFAULT_PLOTTER_CONFIG } from "../src/plotter/job";

describe("workshop geometry", () => {
  it("preserves handwriting pressure and feed rate across transformations and saving", () => {
    const source = shape("rectangle", 20, 10);
    source[0].pressure = 0.8;
    source[0].feedRate = 900;
    const moved = transform(source, { angle: 90 });
    const restored = parseWorkshop(serializeWorkshop(moved, "Почерк"));
    expect(restored.strokes[0].pressure).toBe(0.8);
    expect(restored.strokes[0].feedRate).toBe(900);
  });
  it("rotates around the drawing center, mirrors, and aligns without changing physical dimensions", () => {
    const original = shape("rectangle", 60, 40);
    const rotated = alignToOrigin(
      transform(original, { angle: 90, mirrorX: true }),
    );
    expect(bounds(rotated).width).toBeCloseTo(40);
    expect(bounds(rotated).height).toBeCloseTo(60);
    expect(bounds(rotated).minX).toBeCloseTo(10);
    expect(bounds(rotated).minY).toBeCloseTo(10);
    expect(original[0][0]).toEqual({ x: 10, y: 10 });
  });
  it("tiles with a physical gap and blocks unbounded multiplication", () => {
    expect(bounds(repeat(shape("rectangle", 10, 20), 3, 2, 5))).toMatchObject({
      width: 40,
      height: 45,
    });
    expect(() => repeat(shape("ellipse", 20, 20), 20, 20, 0)).not.toThrow();
    expect(() =>
      repeat(Array(3).fill(shape("ellipse", 20, 20)[0]), 20, 20, 0),
    ).toThrow(/100 000/);
    expect(() => repeat([], 1.5, 2, 0)).toThrow();
  });
  it("hatches closed contours with a hole without drawing through the hole", () => {
    const outside = shape("rectangle", 20, 20);
    const inside = transform(shape("rectangle", 10, 10), { x: 5, y: 5 });
    const lines = hatch([...outside, ...inside], 2, 0);
    for (const [a, b] of lines) {
      if (a.y > 15 && a.y < 25)
        expect(Math.max(a.x, b.x) <= 15 || Math.min(a.x, b.x) >= 25).toBe(true);
      expect(Math.min(a.x, b.x)).toBeGreaterThanOrEqual(10);
      expect(Math.max(a.x, b.x)).toBeLessThanOrEqual(30);
    }
    expect(() => hatch(shape("line", 10, 10), 2, 0)).toThrow(/замкнутый/);
    expect(() => hatch(outside, 0, 0)).toThrow();
  });
  it("roundtrips projects, rejects invalid and nonfinite coordinates", () => {
    const strokes = shape("ellipse", 20, 10);
    expect(parseWorkshop(serializeWorkshop(strokes, "Эллипс"))).toEqual({
      name: "Эллипс",
      strokes,
    });
    expect(() => parseWorkshop('{"format":"other","strokes":[]}')).toThrow();
    expect(() =>
      validateStrokes([
        [
          { x: Infinity, y: 0 },
          { x: 0, y: 0 },
        ],
      ]),
    ).toThrow();
    expect(() => transform(strokes, { scale: 0 })).toThrow();
  });
  it("generated files retain pen lifts and work-area checks for each controller", () => {
    for (const profile of ["grbl", "marlin", "ebb"]) {
      const config = {
        ...DEFAULT_PLOTTER_CONFIG,
        profile,
        workAreaWidth: 100,
        workAreaHeight: 100,
      };
      const job = compilePlotJob(shape("rectangle", 60, 40), config);
      expect(job.withinWorkArea).toBe(true);
      expect(job.penLifts).toBe(1);
      expect(
        compilePlotJob(repeat(shape("rectangle", 60, 40), 2, 2, 5), config)
          .withinWorkArea,
      ).toBe(false);
    }
  });
});

describe("HPGL and coordinate CSV imports", () => {
  it("converts 40 plotter units per mm and handles relative moves and pen lifts", () => {
    const strokes = parseHPGL(
      "IN;PA;PU400,800;PD800,800;PR0,400;PU;PA0,0;PD40,40;",
    );
    expect(strokes).toEqual([
      [
        { x: 10, y: 20 },
        { x: 20, y: 20 },
        { x: 20, y: 30 },
      ],
      [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
    ]);
  });
  it("arcs end at the proper position and circles do not change current position", () => {
    const arc = parseHPGL("PA400,0;PD;AA0,0,90;");
    expect(arc[0].at(-1)!.x).toBeCloseTo(0);
    expect(arc[0].at(-1)!.y).toBeCloseTo(10);
    const circle = parseHPGL("PU400,400;CI80;PD800,400;");
    expect(circle[1][0]).toEqual({ x: 10, y: 10 });
    expect(bounds([circle[0]]).width).toBeCloseTo(4);
  });
  it("rejects unsupported commands instead of silently changing geometry", () => {
    expect(() => parseHPGL("IN;SC0,100,0,100;PD0,0,40,40;")).toThrow(/SC/);
    expect(() => parseHPGL("PD10;")).toThrow(/пара/);
    expect(() => parseHPGL("PDNaN,10;")).toThrow();
    expect(() => parseHPGL("CI10,2,1;")).toThrow();
  });
  it("reads coordinate CSV with blank-line pen lifts", () => {
    expect(parseCoordinateCSV("x,y\n0,0\n10,5\n\n20,20\n30,20")).toHaveLength(
      2,
    );
    expect(() => parseCoordinateCSV("0,0\n1,\n")).toThrow(/строка 2/);
    expect(() => parseCoordinateCSV("0,0")).toThrow(/Одиночная/);
  });
});
