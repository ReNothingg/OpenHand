import { describe, expect, it } from "vitest";
import {
  assertRecoveryCompatible,
  normalizeRecoveryState,
} from "../src/plotter/recovery";

describe("plotter recovery", () => {
  const recovery = {
    jobId: "job-1",
    current: 4,
    total: 10,
    profile: "grbl",
  };
  const job = { id: "job-1", commands: Array(10).fill("G1"), recoverable: true };

  it("accepts bounded persisted checkpoints", () => {
    expect(normalizeRecoveryState(recovery)).toEqual(recovery);
    expect(normalizeRecoveryState({ ...recovery, current: 11 })).toBeNull();
    expect(normalizeRecoveryState({ ...recovery, current: -1 })).toBeNull();
  });

  it("accepts only the same job, length and controller profile", () => {
    expect(() => assertRecoveryCompatible(recovery, job, "grbl")).not.toThrow();
    expect(() =>
      assertRecoveryCompatible(recovery, { ...job, id: "changed" }, "grbl"),
    ).toThrow("Текст или настройки изменились");
    expect(() => assertRecoveryCompatible(recovery, job, "marlin")).toThrow(
      "Профиль контроллера изменился",
    );
  });

  it("rejects relative jobs", () => {
    expect(() =>
      assertRecoveryCompatible(recovery, { ...job, recoverable: false }, "grbl"),
    ).toThrow("относительные координаты");
  });
});
