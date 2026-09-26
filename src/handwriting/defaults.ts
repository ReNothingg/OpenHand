export const DEFAULT_WRITING_CONFIG = Object.freeze({
  feedRate: 1800, letterSpacing: 0.1, optimizePath: false, compactPaths: true,
});

// Stable font/profile IDs preserve previously saved documents.
export const DEFAULT_HANDWRITING_SETTINGS = {
  fontType: "plotter", plotterFontId: "pavel-notes-original", trueHandwriting: true,
  fontSize: 27, lineHeight: 1.4, inkColor: "#233266",
  glyphVariation: 18, connectionStrength: 72, pressureVariation: 0,
  maxWordTilt: 0.7, maxLift: 0.4, maxLetterSpacing: 0.15,
  authorSlant: 0, authorWidth: 100, authorRhythm: 22, authorBaseline: 12,
  wordSpacing: 82, spaceVariation: 16, wordCoherence: 85, endCompression: 4,
  ascenderScale: 100, descenderScale: 100, correctionChance: 0, fatigueEnabled: false,
  fontRandomization: 0, maxLineDrift: 0,
};
