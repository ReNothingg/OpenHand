import test from 'node:test'
import assert from 'node:assert/strict'
import { createDryRunCommands, plotBounds } from '../src/plotter/job.js'
import { normalizePlotterConfig } from '../src/plotter/profiles.js'

const strokes = [
  [{ x: 12, y: 18 }, { x: 24, y: 30 }],
  [{ x: 60, y: 44 }, { x: 48, y: 70 }],
]

test('calculates plot bounds and runs a closed pen-up frame', () => {
  const config = normalizePlotterConfig({
    profile: 'grbl', workAreaWidth: 100, workAreaHeight: 100, jogSpeed: 1200,
  })

  assert.deepEqual(plotBounds(strokes), { minX: 12, minY: 18, maxX: 60, maxY: 70 })
  assert.deepEqual(createDryRunCommands(strokes, config), [
    'G21', 'G90', 'M3S12000',
    'G0X12Y18F1200', 'G0X60Y18F1200', 'G0X60Y70F1200',
    'G0X12Y70F1200', 'G0X12Y18F1200',
  ])
})

test('refuses a dry run outside the configured area or for relative EBB coordinates', () => {
  assert.throws(
    () => createDryRunCommands(strokes, normalizePlotterConfig({ profile: 'grbl', workAreaWidth: 50, workAreaHeight: 100 })),
    /выходит за настроенную рабочую область/,
  )
  assert.throws(
    () => createDryRunCommands(strokes, normalizePlotterConfig({ profile: 'ebb', workAreaWidth: 100, workAreaHeight: 100 })),
    /для EBB/,
  )
})
