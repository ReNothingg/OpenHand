import { spawn } from 'node:child_process'
import process from 'node:process'

const npmCli = process.env.npm_execpath

if (!npmCli) {
  throw new Error('npm_execpath is unavailable. Run this script through npm run build.')
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: 'inherit',
      ...options,
    })

    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(
        signal
          ? `${command} stopped by signal ${signal}.`
          : `${command} exited with code ${code}.`,
      ))
    })
  })
}

console.log('\n[1/3] Building the website…')
await run(process.execPath, [npmCli, 'run', 'build:web'])

console.log('\n[2/3] Syncing the macOS web bundle…')
await run(process.execPath, ['scripts/sync-macos-web.mjs'])

if (process.platform === 'win32') {
  console.log('\n[3/3] Building the Windows x64 application…')
  await run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    'windows/scripts/build-release.ps1',
    '-SkipWebBuild',
  ])
  console.log('\nAll available targets are ready: website, macOS web bundle, Windows x64 ZIP.')
} else if (process.platform === 'darwin') {
  console.log('\n[3/3] Building the macOS application…')
  await run('sh', ['macos/scripts/build-release.sh'], {
    env: {
      ...process.env,
      OPENHAND_SKIP_WEB_BUILD: '1',
    },
  })
  console.log('\nAll available targets are ready: website and OpenHand.app.')
} else {
  console.log('\n[3/3] Native packaging skipped: this platform has no OpenHand packager.')
  console.log('\nWebsite and macOS web bundle are ready.')
}
