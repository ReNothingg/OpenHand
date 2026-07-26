import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

const projectDirectory = process.cwd()
const sourceDirectory = path.resolve(projectDirectory, 'docs')
const targetDirectory = path.resolve(projectDirectory, 'macos', 'Web')
const expectedTargetRoot = `${path.resolve(projectDirectory, 'macos')}${path.sep}`

if (!targetDirectory.startsWith(expectedTargetRoot)) {
  throw new Error(`Unsafe macOS web target: ${targetDirectory}`)
}

await stat(path.join(sourceDirectory, 'index.html'))
await mkdir(targetDirectory, { recursive: true })

for (const entry of await readdir(targetDirectory)) {
  await rm(path.join(targetDirectory, entry), {
    recursive: true,
    force: true,
  })
}

await cp(sourceDirectory, targetDirectory, {
  recursive: true,
  force: true,
})

console.log(`macOS resources synced: ${targetDirectory}`)
