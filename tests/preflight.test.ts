import { describe, expect, it } from "vitest";
import { assessPlotterPreflight } from "../src/plotter/preflight";

describe("plotter preflight", () => {
  const readyLayout = { strokes: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] };

  it("allows a prepared, complete job", () => {
    const result = assessPlotterPreflight(readyLayout, {
      calibrated: true,
      originConfirmed: true,
    });
    expect(result.canStart).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it("blocks unsafe jobs while keeping calibration as a visible warning", () => {
    const result = assessPlotterPreflight(
      { strokes: [], missing: ["Ж"], clipped: true },
      { calibrated: false, originConfirmed: false },
    );
    expect(result.canStart).toBe(false);
    expect(result.blockers).toHaveLength(4);
    expect(result.warnings).toEqual(["Профиль ещё не прошёл калибровку."]);
  });
});
