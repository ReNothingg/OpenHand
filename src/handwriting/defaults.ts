export const DEFAULT_WRITING_CONFIG = Object.freeze({
  feedRate: 1800, letterSpacing: 0.1, optimizePath: false, compactPaths: true,
});

// Stable font/profile IDs preserve previously saved documents.
export const DEFAULT_HANDWRITING_SETTINGS = {
  fontType: "plotter", plotterFontId: "pavel-notes-original", trueHandwriting: true,
  // A common 4.23 mm body and 10 mm line pitch preserve notebook proportions.
  fontSize: 32, lineHeight: 1.18, inkColor: "#303f7b",
  penWidthMm: 0.32, inkVariation: 12, paperTexture: true,
  glyphVariation: 4, connectionStrength: 100, pressureVariation: 0,
  maxWordTilt: 0.7, maxLift: 0.4, maxLetterSpacing: 0.15,
  authorSlant: 0, authorWidth: 100, authorRhythm: 12, authorBaseline: 8,
  wordSpacing: 86, spaceVariation: 24, wordCoherence: 100, endCompression: 0,
  lineFitCompression: 20,
  ascenderScale: 100, descenderScale: 100, correctionChance: 0, fatigueEnabled: false,
  fontRandomization: 0, maxLineDrift: 0,
};
