import { describe, expect, it } from "vitest";
import { calibrationCommands } from "../src/plotter/calibrationRunner";
import {
  compilePlotJob,
  createDryRunCommands,
  createJogCommands,
  createPageJogCommands,
  DEFAULT_PLOTTER_CONFIG,
  optimizeStrokeOrder,
} from "../src/plotter/job";

const grblConfig = {
  ...DEFAULT_PLOTTER_CONFIG,
  profile: "grbl",
  workAreaWidth: 210,
  workAreaHeight: 297,
};

describe("plotter job compiler", () => {
  const strokes = [
    [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
    ],
    [
      { x: 40, y: 20 },
      { x: 45, y: 25 },
    ],
  ];

  it("creates deterministic recoverable absolute jobs", () => {
    const first = compilePlotJob(strokes, grblConfig);
    const second = compilePlotJob(strokes, grblConfig);
    expect(first.id).toBe(second.id);
    expect(first.recoverable).toBe(true);
    expect(first.resumePoints).toHaveLength(2);
    expect(first.commands).toContain("G21");
    expect(first.commands).toContain("G90");
    expect(first.commands.some((command) => command.startsWith("G0X10Y10"))).toBe(
      true,
    );
  });

  it("marks relative EBB jobs as non-recoverable", () => {
    const job = compilePlotJob(strokes, {
      ...grblConfig,
      profile: "ebb",
      mmToSteps: 100,
    });
    expect(job.recoverable).toBe(false);
    expect(job.resumePoints).toEqual([]);
    expect(job.commands.every((command) => !command.startsWith("G"))).toBe(true);
  });

  it("does not mutate strokes while optimizing their order", () => {
    const snapshot = JSON.stringify(strokes);
    expect(optimizeStrokeOrder(strokes)).toHaveLength(2);
    expect(JSON.stringify(strokes)).toBe(snapshot);
  });

  it("rejects dry runs beyond the configured work area", () => {
    expect(() =>
      createDryRunCommands(
        [[{ x: 0, y: 0 }, { x: 211, y: 1 }]],
        grblConfig,
      ),
    ).toThrow("рабочую область");
  });

  it("emits firmware-specific jog and safe calibration commands", () => {
    expect(createJogCommands(2, -3, grblConfig)[0]).toContain("$J=G21G91");
    expect(
      createJogCommands(2, -3, { ...grblConfig, profile: "marlin" }),
    ).toEqual(["G91", "G0X2Y-3F2500"]);
    expect(() =>
      calibrationCommands("pen-down", {
        ...grblConfig,
        penMode: "laser",
        calibrationStep: 1,
        workAreaWidth: 210,
        workAreaHeight: 297,
      }),
    ).toThrow("не активирует лазер");
  });

  it("maps a KDraw top-left page to negative controller Y", () => {
    const config = {
      ...grblConfig,
      startPosition: "left-top",
      penUpDelay: 0.1,
      penDownDelay: 0.35,
      autoSetOrigin: true,
      returnToOrigin: true,
      customStartGcode: "M8",
      customEndGcode: "M9",
    };
    const job = compilePlotJob(strokes, config);
    expect(job.commands).toContain("G10P0L20X0Y0Z0");
    expect(job.commands).toContain("G0X10Y-10F2500");
    expect(job.commands).toContain("G4P0.1");
    expect(job.commands).toContain("G4P0.35");
    expect(job.commands.at(-2)).toBe("G0X0Y0F2500");
    expect(job.commands.at(-1)).toBe("M9");
    expect(createPageJogCommands(0, 5, config)).toEqual([
      "$J=G21G91X0Y-5F2500",
    ]);
  });

  it("checks transformed coordinates against the physical work area", () => {
    const config = {
      ...grblConfig,
      workAreaWidth: 297,
      workAreaHeight: 210,
      swapAxes: true,
    };
    expect(compilePlotJob(strokes, config).withinWorkArea).toBe(true);
    expect(() =>
      createDryRunCommands(
        [[{ x: 0, y: 0 }, { x: 211, y: 1 }]],
        config,
      ),
    ).toThrow("рабочую область");
  });
});
