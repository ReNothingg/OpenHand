import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CALIBRATION_CHECKS,
  calibrationReducer,
  calibrationSteps,
  createCalibrationState,
  currentCalibrationStep,
} from '../src/plotter/calibrationModel.js'
import {
  calibrationCommands,
  runCalibrationAction,
} from '../src/plotter/calibrationRunner.js'
import { normalizePlotterConfig } from '../src/plotter/profiles.js'

test('does not advance a movement until the explicit result confirmation', () => {
  let state = createCalibrationState(normalizePlotterConfig())
  state = calibrationReducer(state, { type: 'action-start' })
  state = calibrationReducer(state, { type: 'action-success' })

  assert.equal(currentCalibrationStep(state).id, 'connect')
  state = calibrationReducer(state, { type: 'continue' })
  assert.equal(currentCalibrationStep(state).id, 'connect')

  state = calibrationReducer(state, { type: 'verify-pass' })
  state = calibrationReducer(state, { type: 'continue' })
  assert.equal(currentCalibrationStep(state).id, 'safety')

  for (const check of CALIBRATION_CHECKS) {
    state = calibrationReducer(state, { type: 'toggle-check', id: check.id, checked: true })
  }
  state = calibrationReducer(state, { type: 'continue' })
  assert.equal(currentCalibrationStep(state).id, 'axis-x-negative')

  state = calibrationReducer(state, { type: 'action-start' })
  state = calibrationReducer(state, { type: 'action-success' })
  assert.equal(currentCalibrationStep(state).id, 'axis-x-negative')
  state = calibrationReducer(state, { type: 'verify-pass' })
  state = calibrationReducer(state, { type: 'continue' })
  assert.equal(currentCalibrationStep(state).id, 'axis-x-positive')
})

test('a wrong axis blocks completion and disconnect restarts checks', () => {
  let state = createCalibrationState(normalizePlotterConfig())
  state = { ...state, index: 2, phase: 'awaiting-verification' }
  state = calibrationReducer(state, { type: 'verify-fail' })

  assert.equal(currentCalibrationStep(state).id, 'axis-x-negative')
  assert.deepEqual(state.failedDirections, ['axis-x-negative'])
  assert.match(state.error, /Исправьте настройки контроллера/)

  state = calibrationReducer(state, { type: 'disconnect' })
  assert.equal(currentCalibrationStep(state).id, 'connect')
  assert.match(state.error, /начните проверки заново/)
})

test('laser profiles never contain pen activation steps', () => {
  const config = normalizePlotterConfig({ profile: 'grbl', penMode: 'laser' })
  const steps = calibrationSteps(config)

  assert.equal(steps.some((step) => step.id.startsWith('pen-')), false)
  assert.throws(() => calibrationCommands('pen-down', config), /не активирует лазер/)
})

test('builds one separately confirmed movement for GRBL, Marlin and EBB', async () => {
  const profiles = ['grbl', 'marlin', 'ebb']
  for (const profile of profiles) {
    const config = normalizePlotterConfig({
      profile,
      calibrationStep: 1,
      workAreaWidth: 300,
      workAreaHeight: 200,
    })
    const batches = []
    const commands = await runCalibrationAction(
      'axis-x-positive',
      config,
      async (batch) => batches.push(batch),
    )

    assert.equal(batches.length, 1)
    assert.deepEqual(batches[0], commands)
    assert.equal(commands.length > 0, true)
  }
})

test('boundary commands use the configured area and never enqueue the next side', async () => {
  const config = normalizePlotterConfig({
    profile: 'grbl',
    workAreaWidth: 321,
    workAreaHeight: 198,
  })
  const batches = []

  await runCalibrationAction('boundary-right', config, async (commands) => batches.push(commands))

  assert.equal(batches.length, 1)
  assert.deepEqual(batches[0], ['$J=G21G91X321Y0F2500'])
  assert.equal(batches.flat().some((command) => command.includes('Y198')), false)
})

test('serial errors, timeouts and disconnects stop the current action', async () => {
  const config = normalizePlotterConfig()
  for (const message of ['error:2', 'Плоттер не ответил', 'Устройство отключено']) {
    let calls = 0
    await assert.rejects(
      runCalibrationAction('probe', config, async () => {
        calls += 1
        throw new Error(message)
      }),
      new RegExp(message.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    )
    assert.equal(calls, 1)
  }
})
