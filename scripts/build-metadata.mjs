import { execFileSync } from "node:child_process";

let revision = "local";
let modified = true;
try {
  revision = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  modified = Boolean(execFileSync("git", ["status", "--porcelain", "--", "src", "macos/openhand", "windows", "vite.config.ts", "scripts/build-metadata.mjs"], { encoding: "utf8" }).trim());
} catch { /* Source archives can be built without a Git checkout. */ }
export const buildMetadata = { revision, modified, builtAt: new Date().toISOString() };
