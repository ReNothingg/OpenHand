import { describe, expect, it } from "vitest";
import { GRBL_REALTIME, parseGrblStatus } from "../src/plotter/grbl";

describe("GRBL 1.1 telemetry", () => {
  it("keeps sparse WCO reports and derives working coordinates", () => {
    const first = parseGrblStatus(
      "<Idle|MPos:10,20,30|WCO:1,2,3|FS:100,0|Ov:90,50,100>",
    )!;
    expect(first.work).toEqual([9, 18, 27]);
    const next = parseGrblStatus("<Run|MPos:20,30,40|FS:120,0>", first)!;
    expect(next.work).toEqual([19, 28, 37]);
    expect(next.overrides).toEqual([90, 50, 100]);
  });
  it("does not invent working coordinates without offsets", () => {
    const state = parseGrblStatus("<Hold:0|MPos:10,20,30|Pn:XYZ>")!;
    expect(state.work).toBeUndefined();
    expect(state.pins).toBe("XYZ");
    expect(parseGrblStatus("<Run|WPos:2,3,4|WCO:1,2,3>")!.machine).toEqual([
      3, 5, 7,
    ]);
  });
  it("ignores malformed statuses and non-finite vectors", () => {
    expect(parseGrblStatus("ok")).toBeNull();
    expect(parseGrblStatus("<Nonsense|MPos:1,2,3>")).toBeNull();
    expect(parseGrblStatus("<Idle|MPos:NaN,2,3>")!.machine).toBeUndefined();
    expect(parseGrblStatus("<Idle|MPos:1,,3>")!.machine).toBeUndefined();
  });
  it("uses raw single-byte overrides (never UTF-8 strings)", () => {
    expect([
      ...new Uint8Array([
        GRBL_REALTIME.feedPlus10,
        GRBL_REALTIME.rapid25,
        GRBL_REALTIME.jogCancel,
      ]),
    ]).toEqual([0x91, 0x97, 0x85]);
  });
});
