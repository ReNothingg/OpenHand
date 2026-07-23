import { defaultFontPool } from '../fonts.js'

export const PAGE_SIZES = {
  A4: { width: 794, height: 1123, label: 'A4', millimeters: '210 × 297 мм' },
  A5: { width: 559, height: 794, label: 'A5', millimeters: '148 × 210 мм' },
  Letter: { width: 816, height: 1056, label: 'Letter', millimeters: '216 × 279 мм' },
  NotebookSpread: { width: 768, height: 1248, label: 'Тетрадь — разворот', millimeters: '330 × 203 мм' },
}

export const DEFAULT_SETTINGS = {
  fontType: 'screen',
  fontFamily: 'Caveat',
  plotterFontId: 'ifdream-original',
  fontSize: 27,
  textWidth: 620,
  lineHeight: 1.55,
  marginTop: 74,
  marginLeft: 76,
  marginLeftEven: 94,
  marginBottom: 68,
  textRotation: 0,
  inkColor: '#1f2937',
  pageColor: '#ffffff',
  pageSize: 'NotebookSpread',
  pageOrientation: 'landscape',
  ruledPaper: true,
  directionChance: 50,
  maxWordTilt: 2,
  maxLift: 2.5,
  maxLetterSpacing: 0.65,
  fontRandomization: 0,
  maxLineDrift: 0,
  maxLineIndent: 0,
  wordFrequency: 4,
  letterFrequency: 25,
  trueHandwriting: true,
  glyphVariation: 58,
  connectionStrength: 62,
  correctionChance: 1.2,
  pressureVariation: 18,
  seed: 31847,
  zoom: 72,
  fontPool: defaultFontPool,
}

const LEGACY_EFFECTS = [
  ['randomWordTilt', 'maxWordTilt'],
  ['randomLift', 'maxLift'],
  ['randomLetterSpacing', 'maxLetterSpacing'],
  ['lineDrift', 'maxLineDrift'],
  ['randomLineIndent', 'maxLineIndent'],
]

export function normalizeSettings(incoming = {}) {
  const settings = { ...DEFAULT_SETTINGS, ...incoming }

  if (settings.pageSize === 'Notebook' || !PAGE_SIZES[settings.pageSize]) {
    settings.pageSize = 'NotebookSpread'
    settings.pageOrientation = 'landscape'
    settings.ruledPaper = true
  }

  if (settings.fontType !== 'plotter') settings.fontType = 'screen'
  if (settings.plotterFontId === 'custom') {
    settings.fontType = 'screen'
    settings.plotterFontId = DEFAULT_SETTINGS.plotterFontId
  }

  if (!Object.hasOwn(incoming, 'directionChance') && Object.hasOwn(incoming, 'randomDirection')) {
    settings.directionChance = incoming.randomDirection ? 50 : 0
  }
  if (!Object.hasOwn(incoming, 'fontRandomization') && Object.hasOwn(incoming, 'randomFonts')) {
    settings.fontRandomization = incoming.randomFonts ? 100 : 0
  }

  LEGACY_EFFECTS.forEach(([legacyToggle, valueKey]) => {
    if (Object.hasOwn(incoming, legacyToggle) && !incoming[legacyToggle]) settings[valueKey] = 0
  })

  ;['randomDirection', 'randomWordTilt', 'randomLift', 'randomLetterSpacing', 'randomFonts', 'lineDrift', 'randomLineIndent']
    .forEach((key) => delete settings[key])

  return settings
}

export const STORAGE_KEYS = {
  markdown: 'handwriter-markdown-v1',
  tex: 'handwriter-tex-v1',
  sourceMode: 'handwriter-source-mode-v1',
  settings: 'handwriter-settings-v2',
  presets: 'handwriter-presets-v2',
  manualLayout: 'handwriter-manual-layout-v1',
}
