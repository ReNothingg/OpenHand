import { describe, expect, it } from "vitest";
import {
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
});
