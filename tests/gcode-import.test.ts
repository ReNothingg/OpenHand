import { describe, expect, it } from "vitest";
import { prepareImportedGcode } from "../src/plotter/gcodeImport";

describe("G-code import", () => {
  it("cleans comments, parses bounds and preserves controller commands", () => {
    const job = prepareImportedGcode(
      "G21 ; millimetres\nG90\nM3S12000\nG0 X10 Y-10\nG1 X20 Y-30 F1500\nM5\n",
      { name: "kdraw.gcode", workAreaWidth: 330, workAreaHeight: 203 },
    );
    expect(job.name).toBe("kdraw.gcode");
    expect(job.commands[0]).toBe("G21");
    expect(job.commands).toContain("M3S12000");
    expect(job.withinWorkArea).toBe(true);
    expect(job.recoverable).toBe(false);
    expect(job.warnings.join(" ")).toContain("M3/M4");
  });

  it("blocks heater, firmware and EEPROM commands", () => {
    expect(() => prepareImportedGcode("M104 S200")).toThrow("заблокирована");
    expect(() => prepareImportedGcode("$RST=*")).toThrow("заблокирована");
  });

  it("marks out-of-area jobs before sending", () => {
    const job = prepareImportedGcode("G21\nG90\nG0X500Y0", {
      workAreaWidth: 330,
      workAreaHeight: 203,
    });
    expect(job.withinWorkArea).toBe(false);
  });
});
