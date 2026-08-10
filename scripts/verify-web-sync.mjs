import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const projectDirectory = process.cwd();
const sourceDirectory = path.join(projectDirectory, "docs");
const macosDirectory = path.join(projectDirectory, "macos", "Web");
const ignoredNames = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

function shouldInclude(name) {
  return !ignoredNames.has(name) && !name.startsWith("._");
}

async function listFiles(directory, relative = "") {
  const entries = await readdir(path.join(directory, relative), {
    withFileTypes: true,
  });
  const files = await Promise.all(
    entries.filter((entry) => shouldInclude(entry.name)).map(async (entry) => {
      const entryPath = path.join(relative, entry.name);
      if (entry.isDirectory()) return listFiles(directory, entryPath);
      if (entry.isFile()) return [entryPath];
      return [];
    }),
  );
  return files.flat();
}

await Promise.all([stat(sourceDirectory), stat(macosDirectory)]);
const [sourceFiles, macosFiles] = await Promise.all([
  listFiles(sourceDirectory),
  listFiles(macosDirectory),
]);
const sourceSet = new Set(sourceFiles);
const macosSet = new Set(macosFiles);
const mismatches = [
  ...sourceFiles.filter((file) => !macosSet.has(file)).map((file) => `missing in macOS: ${file}`),
  ...macosFiles.filter((file) => !sourceSet.has(file)).map((file) => `extra in macOS: ${file}`),
];

for (const file of sourceFiles.filter((entry) => macosSet.has(entry))) {
  const [source, macos] = await Promise.all([
    readFile(path.join(sourceDirectory, file)),
    readFile(path.join(macosDirectory, file)),
  ]);
  if (!source.equals(macos)) mismatches.push(`different contents: ${file}`);
}

if (mismatches.length) {
  throw new Error(`Web bundles are out of sync:\n${mismatches.join("\n")}`);
}

console.log(`Web bundles match (${sourceFiles.length} files).`);
