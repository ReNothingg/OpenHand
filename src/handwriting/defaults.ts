export const DEFAULT_WRITING_CONFIG = Object.freeze({
  feedRate: 1800, letterSpacing: 0.1, optimizePath: false, compactPaths: true,
});

// Stable font/profile IDs preserve previously saved documents.
export const DEFAULT_HANDWRITING_SETTINGS = {
  fontType: "plotter", plotterFontId: "pavel-notes-original", trueHandwriting: true,
  // Measured on the notebook photos: a 3.7 mm x-height, one line per two
  // 5 mm cells, word gaps of about one x-height (half to one and a half) and
  // a bold line of dark blue ballpoint ink.
  fontSize: 28, lineHeight: 1.35, inkColor: "#2c2e72",
  penWidthMm: 0.58, inkVariation: 12, paperTexture: true,
  glyphVariation: 4, connectionStrength: 100, pressureVariation: 0,
  maxWordTilt: 0.7, maxLift: 0.4, maxLetterSpacing: 0.15,
  authorSlant: 0, authorWidth: 100, authorRhythm: 12, authorBaseline: 8,
  wordSpacing: 100, spaceVariation: 50, wordCoherence: 100, endCompression: 0,
  lineFitCompression: 20,
  ascenderScale: 100, descenderScale: 100, correctionChance: 0, fatigueEnabled: false,
  fontRandomization: 0, maxLineDrift: 0,
};

// Earlier defaults (2026-10-04 and the first letter-tracing build). Untouched
// settings saved with these values, or with older drafts derived from them,
// are upgraded.
export const PREVIOUS_NOTEBOOK_DEFAULTS = Object.freeze({
  ...DEFAULT_HANDWRITING_SETTINGS, inkColor: "#303f7b",
  fontSize: 32, lineHeight: 1.18, penWidthMm: 0.32, wordSpacing: 86, spaceVariation: 24,
});
export const TRACED_NOTEBOOK_DEFAULTS = Object.freeze({
  ...DEFAULT_HANDWRITING_SETTINGS, inkColor: "#303f7b", penWidthMm: 0.42,
  wordSpacing: 105, spaceVariation: 40,
});
