import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("native shell contract", () => {
  it("exposes the same serial actions on macOS and Windows", async () => {
    const [mac, windows] = await Promise.all([
      readFile(path.join(root, "macos/openhand/NativeBridge.swift"), "utf8"),
      readFile(path.join(root, "windows/NativeBridge.cs"), "utf8"),
    ]);
    for (const action of ["requestPort", "open", "write", "setSignals", "close"]) {
      expect(mac).toContain(`case \"${action}\"`);
      expect(windows).toContain(`case \"${action}\"`);
    }
  });

  it("declares distinct native platforms before the web app starts", async () => {
    const [mac, windows, main] = await Promise.all([
      readFile(path.join(root, "macos/openhand/OpenHandWebView.swift"), "utf8"),
      readFile(path.join(root, "windows/NativeScripts.cs"), "utf8"),
      readFile(path.join(root, "src/main.tsx"), "utf8"),
    ]);
    expect(mac).toContain('value: "macos"');
    expect(windows).toContain('value: "windows"');
    expect(main).toContain("window.__openhandNativePlatform");
    expect(main).not.toContain("Boolean(window.webkit");
  });

  it("keeps the same large-document limit in both shells", async () => {
    const [mac, windows] = await Promise.all([
      readFile(path.join(root, "macos/openhand/OpenHandWebView.swift"), "utf8"),
      readFile(path.join(root, "windows/MainForm.cs"), "utf8"),
    ]);
    expect(mac).toContain("64 * 1024 * 1024");
    expect(windows).toContain("64L * 1024 * 1024");
  });
});
