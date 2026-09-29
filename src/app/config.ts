import { DEFAULT_HANDWRITING_SETTINGS } from "../handwriting/defaults";
import { STRUCTURE_CONTROLS, structureValue } from "../handwriting/structure";
import { defaultFontPool } from "../fonts";

export const PAGE_SIZES = {
  A4: { width: 794, height: 1123, label: "A4", millimeters: "210 × 297 мм" },
  A5: { width: 559, height: 794, label: "A5", millimeters: "148 × 210 мм" },
  Letter: {
    width: 816,
    height: 1056,
    label: "Letter",
    millimeters: "216 × 279 мм",
  },
  NotebookSpread: {
    width: 768,
    height: 1248,
    label: "Тетрадь — разворот",
    millimeters: "330 × 203 мм",
  },
};

export const DEFAULT_SETTINGS = {
  fontFamily: "Caveat",
  textWidth: 620,
  compactLayout: true,
  marginTop: 74,
  writingStartEnabled: false,
  writingStartPage: 0,
  writingStartPositions: {} as Record<string, number>,
  marginLeft: 76,
  marginLeftEven: 94,
  marginBottom: 0,
  textRotation: 0,
  pageColor: "#ffffff",
  pageSize: "NotebookSpread",
  pageOrientation: "landscape",
  ruledPaper: true,
  directionChance: 50,
  maxLineIndent: 0,
  wordFrequency: 4,
  letterFrequency: 25,
  handwritingProfile: "pavelNotes",
  paragraphIndent: 0,
  paragraphGap: 0,
  fatigueStrength: 38,
  seed: 31847,
  zoom: 72,
  fontPool: defaultFontPool,
  ...DEFAULT_HANDWRITING_SETTINGS,
};

const LEGACY_EFFECTS = [
  ["randomWordTilt", "maxWordTilt"],
  ["randomLift", "maxLift"],
  ["randomLetterSpacing", "maxLetterSpacing"],
  ["lineDrift", "maxLineDrift"],
  ["randomLineIndent", "maxLineIndent"],
];

export type AppSettings = typeof DEFAULT_SETTINGS & Record<string, unknown>;

export function normalizeSettings(
  incoming: Record<string, any> = {},
): AppSettings {
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...incoming };
  // Update an untouched earlier reconstruction while preserving individual
  // handwriting adjustments and document layout choices.
  const formerPavelNotes = {
    inkColor: "#233266", glyphVariation: 18, connectionStrength: 72,
    authorRhythm: 22, authorBaseline: 12, spaceVariation: 16, endCompression: 4,
    authorWidth: 100,
  };
  const previousPavelNotes = {
    fontSize: 27, lineHeight: 1.4, inkColor: "#28518f", glyphVariation: 35,
    connectionStrength: 82, authorRhythm: 32, authorBaseline: 26,
    wordSpacing: 82, spaceVariation: 22, wordCoherence: 85, endCompression: 5,
    authorWidth: 100,
  };
  if (settings.handwritingProfile === "pavelNotes" &&
      settings.plotterFontId === "pavel-notes-original") {
    const previousMotion = { authorRhythm: 38, authorBaseline: 18, wordCoherence: 90, lineFitCompression: 8 };
    const photoDraft = { ...DEFAULT_HANDWRITING_SETTINGS, ...previousMotion, fontSize: 25, lineHeight: 1.45, authorWidth: 100 };
    const previousDefault = { ...DEFAULT_HANDWRITING_SETTINGS, ...previousMotion };
    if ([photoDraft, previousDefault].some(previous => Object.entries(previous).every(([key, value]) =>
        !Object.hasOwn(incoming, key) || incoming[key] === value))) {
      // Upgrade only a complete untouched profile; explicit custom values win.
      settings.fontSize = DEFAULT_HANDWRITING_SETTINGS.fontSize;
      settings.lineHeight = DEFAULT_HANDWRITING_SETTINGS.lineHeight;
      settings.authorWidth = DEFAULT_HANDWRITING_SETTINGS.authorWidth;
      for (const key of Object.keys(previousMotion)) settings[key] = DEFAULT_HANDWRITING_SETTINGS[key];
    }
    for (const previous of [{ ...previousPavelNotes, ...formerPavelNotes }, previousPavelNotes]) {
      if (Object.entries(previous).every(([key, value]) =>
          !Object.hasOwn(incoming, key) || incoming[key] === value)) {
        for (const key of Object.keys(previous))
          settings[key] = DEFAULT_HANDWRITING_SETTINGS[key];
        break;
      }
    }
  }
  settings.compactLayout = incoming.compactLayout !== false;
  settings.writingStartEnabled = incoming.writingStartEnabled === true;
  settings.writingStartPage = Math.max(0, Math.min(99, Math.floor(Number(incoming.writingStartPage) || 0)));
  const starts = incoming.writingStartPositions;
  settings.writingStartPositions = {};
  if (starts && typeof starts === "object" && !Array.isArray(starts)) {
    for (const [key, value] of Object.entries(starts).slice(0, 1000)) {
      if (
        /^\d{1,3}$/.test(key) &&
        typeof value === "number" &&
        Number.isFinite(value)
      )
        settings.writingStartPositions[key] = Math.max(
          0,
          Math.min(5000, value),
        );
    }
  }

  if (settings.pageSize === "Notebook" || !PAGE_SIZES[settings.pageSize]) {
    settings.pageSize = "NotebookSpread";
    settings.pageOrientation = "landscape";
    settings.ruledPaper = true;
  }
  if (
    settings.pageSize === "NotebookSpread" &&
    [44, 68].includes(Number(incoming.marginBottom))
  ) {
    settings.marginBottom = 0;
  }

  if (settings.fontType !== "plotter") settings.fontType = "screen";
  if (settings.plotterFontId === "custom") {
    settings.fontType = "screen";
    settings.plotterFontId = DEFAULT_SETTINGS.plotterFontId;
  }

  if (
    !Object.hasOwn(incoming, "directionChance") &&
    Object.hasOwn(incoming, "randomDirection")
  ) {
    settings.directionChance = incoming.randomDirection ? 50 : 0;
  }
  if (
    !Object.hasOwn(incoming, "fontRandomization") &&
    Object.hasOwn(incoming, "randomFonts")
  ) {
    settings.fontRandomization = incoming.randomFonts ? 100 : 0;
  }

  LEGACY_EFFECTS.forEach(([legacyToggle, valueKey]) => {
    if (Object.hasOwn(incoming, legacyToggle) && !incoming[legacyToggle])
      settings[valueKey] = 0;
  });
  [
    "randomDirection",
    "randomWordTilt",
    "randomLift",
    "randomLetterSpacing",
    "randomFonts",
    "lineDrift",
    "randomLineIndent",
  ].forEach((key) => delete settings[key]);

  for (const control of STRUCTURE_CONTROLS)
    settings[control.key] = structureValue(settings, control.key);
  return settings;
}

export const STORAGE_KEYS = {
  markdown: "handwriter-markdown-v1",
  tex: "handwriter-tex-v1",
  sourceMode: "handwriter-source-mode-v1",
  settings: "handwriter-settings-v2",
  presets: "handwriter-presets-v2",
  manualLayout: "handwriter-manual-layout-v1",
};
