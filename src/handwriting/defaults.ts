export const DEFAULT_WRITING_CONFIG = Object.freeze({
  feedRate: 1800, letterSpacing: 0.1, optimizePath: false, compactPaths: true,
});

// Stable font/profile IDs preserve previously saved documents.
export const DEFAULT_HANDWRITING_SETTINGS = {
  fontType: "plotter", plotterFontId: "pavel-notes-original", trueHandwriting: true,
  // About 4.7 mm x-height and 10 mm baseline pitch on the photographed 5 mm grid.
  fontSize: 32, lineHeight: 1.18, inkColor: "#304d87",
  glyphVariation: 14, connectionStrength: 90, pressureVariation: 0,
  maxWordTilt: 0.7, maxLift: 0.4, maxLetterSpacing: 0.15,
  authorSlant: 0, authorWidth: 82, authorRhythm: 26, authorBaseline: 12,
  wordSpacing: 86, spaceVariation: 24, wordCoherence: 100, endCompression: 6,
  lineFitCompression: 20,
  ascenderScale: 100, descenderScale: 100, correctionChance: 0, fatigueEnabled: false,
  fontRandomization: 0, maxLineDrift: 0,
};
