import test from 'node:test'
import assert from 'node:assert/strict'
import {
  LEGACY_PLOTTER_SETTINGS_KEY,
  loadPlotterProfileStore,
  normalizePlotterConfig,
  parsePlotterProfile,
  PLOTTER_PROFILES_KEY,
  serializePlotterProfile,
} from '../src/plotter/profiles.js'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    has: (key) => values.has(key),
  }
}

test('migrates the legacy global settings into the only active profile', () => {
  const storage = memoryStorage({
    [LEGACY_PLOTTER_SETTINGS_KEY]: JSON.stringify({
      profile: 'marlin',
      baudRate: 250000,
      feedRate: 900,
      penUp: 42,
    }),
  })

  const store = loadPlotterProfileStore(storage)

  assert.equal(store.version, 1)
  assert.equal(store.profiles.length, 1)
  assert.equal(store.profiles[0].name, 'Текущий плоттер')
  assert.equal(store.profiles[0].config.profile, 'marlin')
  assert.equal(store.profiles[0].config.penUp, 42)
  assert.equal(store.activeProfileId, store.profiles[0].id)
  assert.equal(storage.has(LEGACY_PLOTTER_SETTINGS_KEY), false)
  assert.equal(storage.has(PLOTTER_PROFILES_KEY), true)
})

test('clamps imported mechanics to safe supported ranges', () => {
  const config = normalizePlotterConfig({
    profile: 'marlin',
    baudRate: 123,
    feedRate: -50,
    jogSpeed: 999999,
    jogDistance: 0,
    penMode: 'laser',
    penUp: 9999,
    zDown: -100,
    workAreaWidth: 5000,
    workAreaHeight: 1,
    calibrationStep: 20,
  })

  assert.equal(config.baudRate, 115200)
  assert.equal(config.feedRate, 1)
  assert.equal(config.jogSpeed, 10000)
  assert.equal(config.jogDistance, 0.1)
  assert.equal(config.penMode, 'servo')
  assert.equal(config.penUp, 180)
  assert.equal(config.zDown, -50)
  assert.equal(config.workAreaWidth, 2000)
  assert.equal(config.workAreaHeight, 20)
  assert.equal(config.calibrationStep, 5)
})

test('round-trips an exported profile and rejects unrelated JSON', () => {
  const profile = {
    id: 'source-id',
    name: 'Стол A',
    config: normalizePlotterConfig({ profile: 'grbl', workAreaWidth: 420 }),
    calibratedAt: 123,
    createdAt: 100,
    updatedAt: 123,
  }
  const imported = parsePlotterProfile(serializePlotterProfile(profile))

  assert.equal(imported.name, 'Стол A')
  assert.equal(imported.config.workAreaWidth, 420)
  assert.equal(imported.calibratedAt, 123)
  assert.notEqual(imported.id, 'source-id')
  assert.throws(
    () => parsePlotterProfile('{"profile":{}}'),
    /не профиль плоттера OpenHand/,
  )
})
