import { describe, expect, it } from "vitest";
import {
  loadStoredObject,
  loadStoredText,
  saveStoredValues,
} from "../src/lib/storage";

function memoryStorage(values: Record<string, string> = {}) {
  const data = new Map(Object.entries(values));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => data.set(key, value),
    removeItem: (key: string) => data.delete(key),
  };
}

describe("local storage helpers", () => {
  it("uses a fallback for malformed or non-object values", () => {
    const fallback = { pageSize: "A4", zoom: 72 };
    expect(loadStoredObject("settings", fallback, memoryStorage())).toEqual(fallback);
    expect(
      loadStoredObject("settings", fallback, memoryStorage({ settings: "[]" })),
    ).toEqual(fallback);
    expect(
      loadStoredObject("settings", fallback, memoryStorage({ settings: "broken" })),
    ).toEqual(fallback);
  });

  it("does not throw when browser storage is unavailable", () => {
    const unavailable = {
      getItem: () => {
        throw new Error("storage blocked");
      },
      setItem: () => {
        throw new Error("storage blocked");
      },
      removeItem: () => undefined,
    };
    expect(loadStoredText("document", "fallback", unavailable)).toBe("fallback");
    expect(saveStoredValues({ document: "text" }, unavailable)).toBe(false);
  });

  it("persists a group of values", () => {
    const storage = memoryStorage();
    expect(saveStoredValues({ document: "text", mode: "markdown" }, storage)).toBe(
      true,
    );
    expect(storage.getItem("document")).toBe("text");
    expect(storage.getItem("mode")).toBe("markdown");
  });
});
