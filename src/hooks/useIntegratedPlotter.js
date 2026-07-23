import { useCallback, useEffect, useMemo, useState } from 'react'
import { useDebouncedValue } from './useDebouncedValue.js'
import { usePlotter } from './usePlotter.js'
import { loadBundledGFont, loadGFont } from '../plotter/gfont.js'
import {
  compilePlotJob,
  createJogCommands,
  createOriginCommands,
  createPenCommand,
  DEFAULT_PLOTTER_CONFIG,
  layoutBlocks,
  layoutText,
  pageSettingsToMillimeters,
} from '../plotter/job.js'

const STORAGE_KEY = 'openhand.plotter.settings.v1'

function clamp(value, min, max, fallback) {
  const number = Number(value)
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback
}

function loadConfig() {
  try {
    const config = { ...DEFAULT_PLOTTER_CONFIG, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') }
    const servoMax = config.profile === 'marlin' ? 180 : 32767
    return {
      ...config,
      feedRate: clamp(config.feedRate, 1, 10000, DEFAULT_PLOTTER_CONFIG.feedRate),
      jogSpeed: clamp(config.jogSpeed, 1, 10000, DEFAULT_PLOTTER_CONFIG.jogSpeed),
      jogDistance: clamp(config.jogDistance, 0.1, 50, DEFAULT_PLOTTER_CONFIG.jogDistance),
      penUp: clamp(config.penUp, 0, servoMax, config.profile === 'marlin' ? 50 : DEFAULT_PLOTTER_CONFIG.penUp),
      penDown: clamp(config.penDown, 0, servoMax, config.profile === 'marlin' ? 0 : DEFAULT_PLOTTER_CONFIG.penDown),
      zUp: clamp(config.zUp, -50, 50, DEFAULT_PLOTTER_CONFIG.zUp),
      zDown: clamp(config.zDown, -50, 50, DEFAULT_PLOTTER_CONFIG.zDown),
      laserPower: clamp(config.laserPower, 0, 1000, DEFAULT_PLOTTER_CONFIG.laserPower),
      mmToSteps: clamp(config.mmToSteps, 1, 1000, DEFAULT_PLOTTER_CONFIG.mmToSteps),
      penDelay: clamp(config.penDelay, 0, 10, DEFAULT_PLOTTER_CONFIG.penDelay),
      letterSpacing: clamp(config.letterSpacing, 0, 20, DEFAULT_PLOTTER_CONFIG.letterSpacing),
    }
  } catch {
    return { ...DEFAULT_PLOTTER_CONFIG }
  }
}

export function mechanicsDefaults(profile) {
  return {
    feedRate: DEFAULT_PLOTTER_CONFIG.feedRate,
    jogSpeed: DEFAULT_PLOTTER_CONFIG.jogSpeed,
    jogDistance: DEFAULT_PLOTTER_CONFIG.jogDistance,
    penMode: 'servo',
    penUp: profile === 'marlin' ? 50 : DEFAULT_PLOTTER_CONFIG.penUp,
    penDown: profile === 'marlin' ? 0 : DEFAULT_PLOTTER_CONFIG.penDown,
    zUp: DEFAULT_PLOTTER_CONFIG.zUp,
    zDown: DEFAULT_PLOTTER_CONFIG.zDown,
    zSpeed: DEFAULT_PLOTTER_CONFIG.zSpeed,
    laserPower: DEFAULT_PLOTTER_CONFIG.laserPower,
    mmToSteps: DEFAULT_PLOTTER_CONFIG.mmToSteps,
    penDelay: DEFAULT_PLOTTER_CONFIG.penDelay,
    letterSpacing: DEFAULT_PLOTTER_CONFIG.letterSpacing,
  }
}

function buildSheets(pageTexts, pageBlocks, settings, metrics) {
  if (settings.pageSize === 'NotebookSpread') {
    return Array.from({ length: Math.ceil(pageTexts.length / 2) }, (_, index) => ({
      page: pageSettingsToMillimeters(settings, metrics, false, 'left'),
      parts: [
        { text: pageTexts[index * 2] || '', blocks: pageBlocks[index * 2] || [], page: pageSettingsToMillimeters(settings, metrics, false, 'left') },
        { text: pageTexts[index * 2 + 1] || '', blocks: pageBlocks[index * 2 + 1] || [], page: pageSettingsToMillimeters(settings, metrics, true, 'right') },
      ],
    }))
  }
  return pageTexts.map((text, index) => ({
    page: pageSettingsToMillimeters(settings, metrics, index % 2 === 1),
    parts: [{ text, blocks: pageBlocks[index] || [], page: pageSettingsToMillimeters(settings, metrics, index % 2 === 1) }],
  }))
}

export function useIntegratedPlotter({
  enabled,
  fontId,
  customFont,
  pageTexts,
  pageBlocks = [],
  settings,
  metrics,
  activeSheetIndex,
  pending = false,
}) {
  const [config, setConfig] = useState(() => ({ ...loadConfig(), fontId: fontId || DEFAULT_PLOTTER_CONFIG.fontId }))
  const [font, setFont] = useState(null)
  const [fontStatus, setFontStatus] = useState('Выберите однолинейный GFont')
  const [layouts, setLayouts] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [armed, setArmed] = useState(false)
  const plotter = usePlotter()
  const previewConfig = useDebouncedValue(config)
  const sheets = useMemo(() => buildSheets(pageTexts, pageBlocks, settings, metrics), [
    pageTexts,
    pageBlocks,
    metrics,
    settings.pageSize,
    settings.marginTop,
    settings.marginLeft,
    settings.marginLeftEven,
    settings.marginBottom,
    settings.fontSize,
    settings.lineHeight,
  ])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }, [config])

  useEffect(() => {
    if (!enabled) {
      setFont(null)
      setLayouts([])
      setFontStatus('Выберите однолинейный GFont')
      setArmed(false)
      return undefined
    }
    let cancelled = false
    setBusy(true)
    setError('')
    setConfig((current) => ({ ...current, fontId }))
    const isCustomFont = fontId === 'custom' || fontId.startsWith('custom:')
    setFontStatus(isCustomFont ? 'Загрузка своего шрифта…' : 'Загрузка встроенного шрифта…')
    const pendingFont = isCustomFont
      ? customFont?.font
        ? Promise.resolve(customFont.font)
        : Promise.reject(new Error('Загрузите файл .gfont рядом с выбором шрифта.'))
      : loadBundledGFont(fontId)
    pendingFont
      .then((loaded) => {
        if (cancelled) return
        setFont(loaded)
        setFontStatus(`${customFont?.name || loaded.name} · ${loaded.entries.size.toLocaleString('ru-RU')} символов`)
      })
      .catch((reason) => {
        if (!cancelled) {
          setFontStatus(isCustomFont ? 'Свой шрифт не загружен' : 'Встроенный шрифт не загрузился')
          setError(reason.message)
        }
      })
      .finally(() => !cancelled && setBusy(false))
    return () => { cancelled = true }
  }, [enabled, fontId, customFont])

  useEffect(() => {
    if (!enabled || !font) return undefined
    let cancelled = false
    setBusy(true)
    setError('')
    const layoutSheet = async (sheet) => {
      const layoutConfig = {
        ...previewConfig,
        seed: settings.seed,
        trueHandwriting: settings.trueHandwriting,
        glyphVariation: settings.glyphVariation,
        connectionStrength: settings.connectionStrength,
        correctionChance: settings.correctionChance,
        pressureVariation: settings.pressureVariation,
      }
      const parts = await Promise.all(sheet.parts.map((part) => (
        part.blocks.some((block) => block.layout)
          ? layoutBlocks(part.blocks, font, part.page, layoutConfig)
          : layoutText(part.text, font, part.page, layoutConfig)
      )))
      return {
        page: sheet.page,
        strokes: parts.flatMap((part) => part.strokes),
        missing: [...new Set(parts.flatMap((part) => part.missing))],
        clipped: parts.some((part) => part.clipped),
        clippedItems: [...new Set(parts.flatMap((part) => part.clippedItems || []))],
      }
    }
    const calculate = async () => {
      const preferredIndex = Math.min(
        Math.max(0, activeSheetIndex || 0),
        Math.max(0, sheets.length - 1),
      )
      const order = [
        preferredIndex,
        ...sheets.map((_, index) => index).filter((index) => index !== preferredIndex),
      ]
      for (const index of order) {
        if (cancelled || !sheets[index]) return
        const nextLayout = await layoutSheet(sheets[index])
        if (cancelled) return
        setLayouts((current) => {
          const next = current.slice(0, sheets.length)
          next[index] = nextLayout
          return next
        })
        await new Promise((resolve) => window.setTimeout(resolve, 0))
      }
    }
    calculate()
      .catch((reason) => !cancelled && setError(reason.message))
      .finally(() => !cancelled && setBusy(false))
    return () => { cancelled = true }
  }, [
    enabled,
    font,
    sheets,
    previewConfig.letterSpacing,
    settings.seed,
    settings.trueHandwriting,
    settings.glyphVariation,
    settings.connectionStrength,
    settings.correctionChance,
    settings.pressureVariation,
  ])

  const activeIndex = Math.min(Math.max(0, activeSheetIndex || 0), Math.max(0, layouts.length - 1))
  const activeLayout = layouts[activeIndex] || { strokes: [], missing: [], clipped: false, clippedItems: [], page: sheets[activeIndex]?.page }
  const job = useMemo(
    () => compilePlotJob(activeLayout.strokes, previewConfig),
    [activeLayout.strokes, previewConfig],
  )
  const createJob = useCallback((index = activeIndex) => {
    const layout = layouts[index]
    return compilePlotJob(layout?.strokes || [], config)
  }, [activeIndex, config, layouts])
  const createJobs = useCallback(
    () => layouts.map((layout) => compilePlotJob(layout?.strokes || [], config)),
    [config, layouts],
  )
  const connected = plotter.status !== 'disconnected' && plotter.status !== 'connecting'
  const running = plotter.status === 'running' || plotter.status === 'paused'
  const progressPercent = plotter.progress.total ? plotter.progress.current / plotter.progress.total * 100 : 0

  const updateConfig = useCallback((key, value) => {
    setConfig((current) => ({ ...current, [key]: value }))
    setArmed(false)
  }, [])
  const boundedConfig = useCallback((key, value, min, max) => {
    if (!Number.isFinite(Number(value))) return
    updateConfig(key, Math.min(max, Math.max(min, Number(value))))
  }, [updateConfig])
  const changeProfile = useCallback((profile) => {
    setConfig((current) => profile === 'marlin'
      ? { ...current, profile, penMode: 'servo', penUp: 50, penDown: 0 }
      : profile === 'grbl'
        ? { ...current, profile, penMode: 'servo', penUp: 12000, penDown: 18000 }
        : { ...current, profile })
    setArmed(false)
  }, [])
  const resetMechanics = useCallback(() => {
    setConfig((current) => ({ ...current, ...mechanicsDefaults(current.profile) }))
    setArmed(false)
  }, [])
  const safeAction = useCallback(async (action) => {
    setError('')
    try { await action() } catch (reason) { setError(reason.message) }
  }, [])
  const importFont = useCallback(async (file) => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const loaded = await loadGFont(file)
      setFont(loaded)
      setFontStatus(`${file.name} · ${loaded.entries.size.toLocaleString('ru-RU')} символов`)
      setArmed(false)
    } catch (reason) {
      setError(reason.message)
    } finally {
      setBusy(false)
    }
  }, [])

  return {
    enabled,
    config,
    updateConfig,
    boundedConfig,
    changeProfile,
    resetMechanics,
    fontStatus,
    importFont,
    layouts,
    activeIndex,
    activeLayout,
    job,
    createJob,
    createJobs,
    busy: busy || pending,
    error,
    armed,
    setArmed,
    plotter,
    connected,
    running,
    progressPercent,
    connect: () => safeAction(() => plotter.connect(config.profile, config.baudRate)),
    disconnect: () => safeAction(plotter.disconnect),
    jog: (dx, dy) => safeAction(() => plotter.sendCommands(createJogCommands(dx, dy, config))),
    pen: (up) => safeAction(() => plotter.sendCommands(createPenCommand(up, config))),
    setOrigin: () => safeAction(() => plotter.sendCommands(createOriginCommands(config))),
    run: () => safeAction(() => plotter.run(createJob().commands)),
    runSheets: (indices) => safeAction(() => {
      const commands = indices.flatMap((index) => createJob(index).commands)
      return plotter.run(commands)
    }),
    pause: () => safeAction(plotter.pause),
    resume: () => safeAction(plotter.resume),
    stop: () => safeAction(plotter.stop),
  }
}
