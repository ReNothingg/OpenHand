import { defaultFontPool } from '../fonts.js'

export const PAGE_SIZES = {
  A4: { width: 794, height: 1123, label: 'A4' },
  A5: { width: 559, height: 794, label: 'A5' },
  Letter: { width: 816, height: 1056, label: 'Letter' },
  Notebook: { width: 624, height: 768, label: 'Ученическая тетрадь' },
}

export const DEFAULT_SETTINGS = {
  fontFamily: 'Caveat',
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
  pageSize: 'A4',
  ruledPaper: false,
  directionChance: 50,
  maxWordTilt: 2,
  maxLift: 2.5,
  maxLetterSpacing: 0.65,
  fontRandomization: 0,
  maxLineDrift: 0,
  maxLineIndent: 0,
  wordFrequency: 4,
  letterFrequency: 25,
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
}
