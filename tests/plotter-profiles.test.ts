import { describe, expect, it } from "vitest";
import {
  configFromDevicePreset,
  normalizePlotterConfig,
  parsePlotterProfile,
  serializePlotterProfile,
} from "../src/plotter/profiles";

describe("plotter profile validation", () => {
  it("clamps imported mechanics values to safe bounds", () => {
    const config = normalizePlotterConfig({
      profile: "marlin",
      feedRate: -100,
      jogDistance: 999,
      penUp: 1000,
      penDown: -1,
    });
    expect(config.feedRate).toBe(1);
    expect(config.jogDistance).toBe(50);
    expect(config.penUp).toBe(180);
    expect(config.penDown).toBe(0);
  });

  it("round-trips only recognised profile documents", () => {
    const profile = { id: "one", name: "Desk plotter", config: { profile: "grbl" } };
    expect(parsePlotterProfile(serializePlotterProfile(profile)).name).toBe(
      "Desk plotter",
    );
    expect(() => parsePlotterProfile("{}" as string)).toThrow(
      "Это не профиль плоттера",
    );
  });

  it("applies the locally reconstructed Ozon KDraw preset", () => {
    const config = configFromDevicePreset("ozon-kdraw-grbl", {
      fontId: "custom:mine",
    });
    expect(config.fontId).toBe("custom:mine");
    expect(config.profile).toBe("grbl");
    expect(config.baudRate).toBe(115200);
    expect(config.startPosition).toBe("left-top");
    expect(config.penUp).toBe(12000);
    expect(config.penDown).toBe(18000);
    expect(config.returnToOrigin).toBe(true);
  });

  it("migrates the old shared pen delay to both directions", () => {
    const config = normalizePlotterConfig({ penDelay: 0.7 });
    expect(config.penUpDelay).toBe(0.7);
    expect(config.penDownDelay).toBe(0.7);
  });
});
