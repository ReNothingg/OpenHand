import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/app/config";
import {
  normalizeBlockLayout,
  updatePlacementDirective,
} from "../src/lib/manualLayout";
import { getPageMetrics } from "../src/lib/pagination";

describe("page metrics and manual layout", () => {
  it("swaps dimensions for landscape pages", () => {
    const portrait = getPageMetrics({
      ...DEFAULT_SETTINGS,
      pageSize: "A4",
      pageOrientation: "portrait",
    });
    const landscape = getPageMetrics({
      ...DEFAULT_SETTINGS,
      pageSize: "A4",
      pageOrientation: "landscape",
    });
    expect(portrait.width).toBe(794);
    expect(portrait.height).toBe(1123);
    expect(landscape.width).toBe(1123);
    expect(landscape.height).toBe(794);
  });

  it("clamps unsafe manual block values", () => {
    expect(
      normalizeBlockLayout({ width: 1, height: 2, rotation: 999, pageIndex: -3 }),
    ).toMatchObject({ width: 36, height: 24, rotation: 180, pageIndex: 0 });
  });

  it("updates only the placement directive with the requested id", () => {
    const source = [
      ":::place id=first page=1 x=0",
      "one",
      ":::",
      ":::place id=second page=1 x=0",
      "two",
      ":::",
    ].join("\n");
    const updated = updatePlacementDirective(source, "second", {
      pageIndex: 2,
      x: 12.5,
      y: 8,
      width: 200,
      height: 60,
      align: "right",
    });
    expect(updated).toContain(":::place id=first page=1 x=0");
    expect(updated).toContain(":::place id=second page=3 x=12.5 y=8");
  });
});
