import { assertManualJogAllowed } from "../plotter/manualMotion";
import { COORDINATE_FRAME_VERSION } from "../plotter/coordinateFrame";
import { sameXY, textStartPoint, type XYPoint } from "../plotter/textStart";
import { layoutSections } from "../plotter/sectionLayout";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";
import { usePenControl } from "./usePenControl";
import { usePlotterSession } from "../plotter/PlotterSession";
import { usePlotterPlayback } from "./usePlotterPlayback";
import { loadBundledGFont, loadGFont } from "../plotter/gfont";
import {
  compilePlotJob,
  measurePaperAlignment,
  type PaperAlignment,
  createDryRunCommands,
  createHomingCommands,
  createPageJogCommands,
  createOriginCommands,
  createReturnToOriginCommands,
  DEFAULT_PLOTTER_CONFIG,
  isWithinWorkArea,
  layoutBlocks,
  layoutText,
  pageSettingsToMillimeters,
} from "../plotter/job";
import { PLOTTER_PAGE_BREAK } from "../plotter/richText";
import { runCalibrationAction } from "../plotter/calibrationRunner";
import { mergeTrajectoryReports } from "../font-builder/letterForms";
import {
  configFromDevicePreset,
  createPlotterProfile,
  loadPlotterProfileStore,
  normalizePlotterConfig,
  parsePlotterProfile,
  PLOTTER_PROFILES_KEY,
  ORIGIN_CONFIG_KEYS,
  updateProfileConfig,
} from "../plotter/profiles";
import { controllerFingerprint, matchesControllerCalibration } from "../plotter/controllerFingerprint";
import { hasVerifiedPenPositions } from "../plotter/penLift";
import { assessDeviceReadiness, assessPlotterPreflight } from "../plotter/preflight";
import { preparedProgramBlockers } from "../plotter/importSafety";
import { prepareImportedGcode, prepareImportedExecution } from "../plotter/gcodeImport";
import { createSheetQueue, sheetLabel } from "../plotter/sheetQueue";
import { NOTEBOOK_CELL_MM } from "../lib/notebookGrid";
import { assertRecoveryCompatible, assessRecovery } from "../plotter/recovery";
import {
  minStrokeY,
  physicalSheetIndex,
  writingStartY,
} from "../plotter/writingStart";

export function mechanicsDefaults(profile) {
  return {
    feedRate: DEFAULT_PLOTTER_CONFIG.feedRate,
    jogSpeed: DEFAULT_PLOTTER_CONFIG.jogSpeed,
    jogDistance: DEFAULT_PLOTTER_CONFIG.jogDistance,
    penMode: "servo",
    penUp: profile === "marlin" ? 50 : DEFAULT_PLOTTER_CONFIG.penUp,
    penDown: profile === "marlin" ? 0 : DEFAULT_PLOTTER_CONFIG.penDown,
    zUp: DEFAULT_PLOTTER_CONFIG.zUp,
    zDown: DEFAULT_PLOTTER_CONFIG.zDown,
    zSpeed: DEFAULT_PLOTTER_CONFIG.zSpeed,
    laserPower: DEFAULT_PLOTTER_CONFIG.laserPower,
    mmToSteps: DEFAULT_PLOTTER_CONFIG.mmToSteps,
    penDelay: DEFAULT_PLOTTER_CONFIG.penDelay,
    penUpDelay: DEFAULT_PLOTTER_CONFIG.penUpDelay,
    penDownDelay: DEFAULT_PLOTTER_CONFIG.penDownDelay,
    letterSpacing: DEFAULT_PLOTTER_CONFIG.letterSpacing,
  };
}

function pageForLogicalIndex(settings, metrics, index) {
  settings = {
    ...settings,
    marginTop: writingStartY(
      settings,
      metrics.height,
      index,
    ),
  };
  if (settings.pageSize === "NotebookSpread") {
    const right = index % 2 === 1;
    return pageSettingsToMillimeters(
      settings,
      metrics,
      right,
      right ? "right" : "left",
    );
  }
  return pageSettingsToMillimeters(settings, metrics, index % 2 === 1);
}

async function layoutBelowStart(text, font, page, config) {
  let adjustedPage = page;
  let result;
  for (let pass = 0; pass < 3; pass++) {
    result = await layoutSections(text, font, adjustedPage, config);
    const minimum = minStrokeY(result.strokes);
    if (minimum >= page.top - 0.001) return { ...result, startLineSafe: true };
    // Reflow, rather than translating a full page and clipping its last line.
    adjustedPage = {
      ...adjustedPage,
      top: adjustedPage.top + page.top - minimum + 0.05,
    };
  }
  return { ...result, startLineSafe: false };
}

const combinedSpreads = new WeakMap<object, { right: object | undefined; combined: any }>();
const LAYOUT_CACHE_LIMIT = 96;
const LAYOUT_START_DELAY = 180;

class LayoutCancelled extends Error {}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function samePageTexts(left, right) {
  return left === right || (Array.isArray(left) && Array.isArray(right) &&
    left.length === right.length && left.every((text, index) => text === right[index]));
}

function useStablePageTexts(pageTexts) {
  const stable = useRef(pageTexts);
  if (!samePageTexts(stable.current, pageTexts)) stable.current = pageTexts;
  return stable.current;
}

function combineLogicalLayouts(logicalLayouts, settings, metrics) {
  if (settings.pageSize !== "NotebookSpread") return [...logicalLayouts];
  return Array.from(
    { length: Math.ceil(logicalLayouts.length / 2) },
    (_, index) => {
      const parts = logicalLayouts.slice(index * 2, index * 2 + 2);
      const known = combinedSpreads.get(parts[0]);
      if (known && known.right === parts[1]) return known.combined;
      const combined = {
        page: pageForLogicalIndex(settings, metrics, index * 2),
        strokes: parts.flatMap((part) => part.strokes),
        leftStrokeCount: parts[0]?.strokes.length ?? 0,
        trajectoryReport: mergeTrajectoryReports(
          parts.flatMap((part) => part.trajectoryReport || []),
        ),
        missing: [...new Set(parts.flatMap((part) => part.missing))],
        clipped: parts.some((part) => part.clipped),
        startLineSafe: parts.every((part) => part.startLineSafe !== false),
        clippedItems: [
          ...new Set(parts.flatMap((part) => part.clippedItems || [])),
        ],
      };
      combinedSpreads.set(parts[0], { right: parts[1], combined });
      return combined;
    },
  );
}

/** Strokes of the pages written in this pass: one page of a spread or the whole sheet. */
function sideStrokes(layout, side: string) {
  const strokes = layout?.strokes || [];
  if (side === "both" || !Number.isInteger(layout?.leftStrokeCount)) return strokes;
  return side === "left" ? strokes.slice(0, layout.leftStrokeCount) : strokes.slice(layout.leftStrokeCount);
}

export function useIntegratedPlotter({
  enabled,
  fontId,
  customFont,
  pageTexts: incomingPageTexts,
  pageBlocks = [],
  settings,
  metrics,
  activeSheetIndex,
  onResetProgress = () => {},
  pending = false,
}) {
  const pageTexts = useStablePageTexts(incomingPageTexts);
  const layoutCache = useRef(new Map());
  const layoutCacheFont = useRef(null);
  const [profileStore, setProfileStore] = useState(loadPlotterProfileStore);
  const [font, setFont] = useState(null);
  const [fontStatus, setFontStatus] = useState("Выберите однолинейный GFont");
  const [layouts, setLayouts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [originEstablished, setOriginConfirmed] = useState(false);
  const [textStartBinding, setTextStartBinding] = useState<{ sheet: number; point: XYPoint } | null>(null);
  const [paperAlignment, setPaperAlignment] = useState<PaperAlignment | null>(null);
  const [alignmentStart, setAlignmentStart] = useState<XYPoint | null>(null);
  // Pen offset from the sheet origin in page directions, known only while the
  // pen has moved by manual steps since the origin was set.
  const jogTrail = useRef<XYPoint | null>(null);
  const [jogTrailKnown, setJogTrailKnown] = useState(false);
  const forgetJogTrail = useCallback(() => {
    jogTrail.current = null;
    setJogTrailKnown(false);
    setAlignmentStart(null);
  }, []);
  const calibrationProof = useRef<string | null>(null);
  const [calibrationActive, setCalibrationActive] = useState(false);
  const [importedGcode, setImportedGcode] = useState(null);
  const plotter = usePlotterSession();
  const activeProfile =
    profileStore.profiles.find(
      (profile) => profile.id === profileStore.activeProfileId,
    ) || profileStore.profiles[0];
  const config = activeProfile.config;
  const controllerAxisKey = controllerFingerprint(config.profile, plotter.controllerSettings, plotter.controllerSettingsComplete, "axes");
  const controllerPenKey = controllerFingerprint(config.profile, plotter.controllerSettings, plotter.controllerSettingsComplete, "pen");
  const workAreaConfirmed = matchesControllerCalibration(activeProfile, controllerAxisKey);
  const penPositionsVerified = hasVerifiedPenPositions(config, controllerPenKey);
  const needsPenReference = ["stepper", "estepper"].includes(config.penMode);
  const setConfig = useCallback((updater) => {
    setProfileStore((current) => {
      const activeId = current.activeProfileId;
      return {
        ...current,
        profiles: current.profiles.map((profile) => {
          if (profile.id !== activeId) return profile;
          const incoming =
            typeof updater === "function" ? updater(profile.config) : updater;
          return updateProfileConfig(profile, incoming);
        }),
      };
    });
  }, []);
  const previewConfig = useDebouncedValue(config);
  useEffect(() => {
    try {
      localStorage.setItem(PLOTTER_PROFILES_KEY, JSON.stringify(profileStore));
    } catch {
      setError("Профили плоттера не удалось сохранить локально.");
    }
  }, [profileStore]);

  useEffect(() => {
    if (!enabled) {
      setFont(null);
      setLayouts([]);
      setFontStatus("Выберите однолинейный GFont");
      return undefined;
    }
    let cancelled = false;
    setBusy(true);
    setError("");
    setConfig((current) => ({ ...current, fontId }));
    const isCustomFont = fontId === "custom" || fontId.startsWith("custom:");
    setFontStatus(
      isCustomFont ? "Загрузка своего шрифта…" : "Загрузка встроенного шрифта…",
    );
    const pendingFont = isCustomFont
      ? customFont?.font
        ? Promise.resolve(customFont.font)
        : Promise.reject(
            new Error("Загрузите файл .gfont рядом с выбором шрифта."),
          )
      : loadBundledGFont(fontId);
    pendingFont
      .then((loaded) => {
        if (cancelled) return;
        setFont(loaded);
        setFontStatus(
          `${customFont?.name || loaded.name} · ${loaded.entries.size.toLocaleString("ru-RU")} символов`,
        );
      })
      .catch((reason) => {
        if (!cancelled) {
          setFontStatus(
            isCustomFont
              ? "Свой шрифт не загружен"
              : "Встроенный шрифт не загрузился",
          );
          setError(reason.message);
        }
      })
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [enabled, fontId, customFont]);

  useEffect(() => {
    if (!enabled || !font) return undefined;
    let cancelled = false;
    setBusy(true);
    setError("");
    const calculate = async () => {
      const layoutConfig = {
        ...previewConfig,
        // A page written on its own is moved to the machine origin, so its
        // place on the spread says nothing about the machine width.
        ...(settings.pageSize === "NotebookSpread" && previewConfig.spreadPages !== "both" ? { workAreaWidth: 0 } : {}),
        compactLayout: settings.compactLayout,
        seed: settings.seed,
        trueHandwriting: settings.trueHandwriting,
        glyphVariation: settings.glyphVariation,
        connectionStrength: settings.connectionStrength,
        correctionChance: settings.correctionChance,
        pressureVariation: settings.pressureVariation,
        handwritingProfile: settings.handwritingProfile,
        authorSlant: settings.authorSlant,
        authorWidth: settings.authorWidth,
        authorRhythm: settings.authorRhythm,
        authorBaseline: settings.authorBaseline,
        wordSpacing: settings.wordSpacing,
        paragraphIndent: settings.paragraphIndent,
        paragraphGap: settings.paragraphGap,
        spaceVariation: settings.spaceVariation,
        wordCoherence: settings.wordCoherence,
        endCompression: settings.endCompression,
        lineFitCompression: settings.lineFitCompression,
        ascenderScale: settings.ascenderScale,
        descenderScale: settings.descenderScale,
        fatigueEnabled: settings.fatigueEnabled,
        fatigueStrength: settings.fatigueStrength,
        lineLife: settings.lineLife,
      };
      if (layoutCacheFont.current !== font) {
        layoutCache.current.clear();
        layoutCacheFont.current = font;
      }
      const cache = layoutCache.current;
      const cachedLayout = async (key, compute) => {
        const known = cache.get(key);
        if (known) {
          cache.delete(key);
          cache.set(key, known);
          return { entry: known, computed: false };
        }
        const entry = await compute();
        cache.set(key, entry);
        if (cache.size > LAYOUT_CACHE_LIMIT) cache.delete(cache.keys().next().value);
        return { entry, computed: true };
      };
      const liveConfig = {
        ...layoutConfig,
        yieldToMain: async () => {
          if (cancelled) throw new LayoutCancelled();
          await yieldToBrowser();
          if (cancelled) throw new LayoutCancelled();
        },
      };
      await new Promise((resolve) => window.setTimeout(resolve, LAYOUT_START_DELAY));
      if (cancelled) return;
      const logicalLayouts = [];
      let unpublished = false;
      const publish = async (computed) => {
        if (!computed) {
          unpublished = true;
          return;
        }
        unpublished = false;
        setLayouts(combineLogicalLayouts(logicalLayouts, settings, metrics));
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      };
      // Manually placed pages already include their leading blank pages.
      if (settings.writingStartEnabled && !pageBlocks.some(blocks => blocks.some(block => block.defaultLayout || block.layout?.dirty))) {
        for (let i = 0; i < settings.writingStartPage; i++) {
          const page = pageForLogicalIndex(settings, metrics, i);
          const { entry } = await cachedLayout(JSON.stringify(["blank", page]), async () => ({
            page, strokes: [], missing: [], clipped: false, startLineSafe: true,
          }));
          logicalLayouts.push(entry);
        }
      }
      for (
        let sourceIndex = 0;
        sourceIndex < pageTexts.length;
        sourceIndex += 1
      ) {
        if (cancelled) return;
        const blocks = pageBlocks[sourceIndex] || [];
        const hasIntentionalPlacement = blocks.some(
          (block) => block.defaultLayout || block.layout?.dirty,
        );
        if (hasIntentionalPlacement) {
          const page = pageForLogicalIndex(
            settings,
            metrics,
            logicalLayouts.length,
          );
          const { entry, computed } = await cachedLayout(
            JSON.stringify(["blocks", blocks, page, layoutConfig]),
            async () => {
              const result = await layoutBlocks(blocks, font, page, liveConfig);
              return {
                page,
                ...result,
                startLineSafe: minStrokeY(result.strokes) >= page.top - 0.001,
              };
            },
          );
          logicalLayouts.push(entry);
          await publish(computed);
        } else {
          const sections = (pageTexts[sourceIndex] || "").split(
            PLOTTER_PAGE_BREAK,
          );
          for (const section of sections) {
            let remaining = section.replace(/^\n+|\n+$/g, "");
            let guard = 0;
            do {
              const page = pageForLogicalIndex(
                settings,
                metrics,
                logicalLayouts.length,
              );
              const pageConfig = {
                ...layoutConfig,
                seed: Number(layoutConfig.seed) + logicalLayouts.length * 9973,
              };
              const text = remaining;
              const lastTry = guard >= 99;
              const { entry, computed } = await cachedLayout(
                JSON.stringify(["text", text, page, pageConfig, lastTry]),
                async () => {
                  const result = await layoutBelowStart(text, font, page, {
                    ...pageConfig,
                    yieldToMain: liveConfig.yieldToMain,
                  });
                  const overflow = result.overflowText || "";
                  return {
                    page,
                    ...result,
                    clipped:
                      result.clipped && (!overflow || overflow === text || lastTry),
                  };
                },
              );
              const nextText = entry.overflowText || "";
              const stalled = Boolean(nextText) && nextText === remaining;
              logicalLayouts.push(entry);
              await publish(computed);
              if (cancelled) return;
              guard += 1;
              if (!nextText || stalled || guard >= 100) break;
              remaining = nextText;
            } while (!cancelled);
            if (cancelled) return;
          }
        }
        if (cancelled) return;
      }
      if (unpublished)
        setLayouts(combineLogicalLayouts(logicalLayouts, settings, metrics));
    };
    calculate()
      .catch((reason) => !cancelled && !(reason instanceof LayoutCancelled) && setError(reason.message))
      .finally(() => !cancelled && setBusy(false));
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    font,
    pageTexts,
    pageBlocks,
    metrics,
    settings.pageSize,
    settings.marginTop,
    settings.writingStartEnabled,
    settings.writingStartPage,
    settings.writingStartPositions,
    settings.marginLeft,
    settings.marginLeftEven,
    settings.marginBottom,
    settings.fontSize,
    settings.lineHeight,
    settings.compactLayout,
    previewConfig.letterSpacing,
    previewConfig.spreadPages,
    settings.seed,
    settings.trueHandwriting,
    settings.glyphVariation,
    settings.connectionStrength,
    settings.correctionChance,
    settings.pressureVariation,
    settings.handwritingProfile,
    settings.authorSlant,
    settings.authorWidth,
    settings.authorRhythm,
    settings.authorBaseline,
    settings.wordSpacing,
    settings.paragraphIndent,
    settings.paragraphGap,
    settings.spaceVariation,
    settings.wordCoherence,
    settings.endCompression,
    settings.lineFitCompression,
    settings.ascenderScale,
    settings.descenderScale,
    settings.fatigueEnabled,
    settings.fatigueStrength,
    settings.lineLife,
  ]);

  const activeIndex = Math.min(
    Math.max(0, plotter.printingSheet ?? activeSheetIndex ?? 0),
    Math.max(0, layouts.length - 1),
  );
  const activeLayout = layouts[activeIndex] || {
    strokes: [],
    missing: [],
    clipped: false,
    clippedItems: [],
    page: pageForLogicalIndex(settings, metrics, activeIndex),
  };
  const spreadSide = settings.pageSize === "NotebookSpread" ? config.spreadPages || "both" : "both";
  const spreadLabel = settings.pageSize === "NotebookSpread" ? spreadSide === "both" ? true : spreadSide : false;
  const placement = useMemo(() => ({
    pageOffsetX: spreadSide === "right" ? (metrics.width * 25.4) / 96 / 2 : 0,
    paperAlignment,
  }), [spreadSide, metrics.width, paperAlignment]);
  const jobConfig = useMemo(() => ({ ...config, ...placement }), [config, placement]);
  const previewJobConfig = useMemo(() => ({ ...previewConfig, ...placement }), [previewConfig, placement]);
  const activeStrokes = useMemo(() => sideStrokes(activeLayout, spreadSide), [activeLayout, spreadSide]);
  const job = useMemo(
    () => compilePlotJob(activeStrokes, previewJobConfig),
    [activeStrokes, previewJobConfig],
  );
  const createJob = useCallback(
    (index = activeIndex) => {
      const layout = layouts[index];
      return compilePlotJob(sideStrokes(layout, spreadSide), jobConfig);
    },
    [activeIndex, jobConfig, layouts, spreadSide],
  );
  const createJobs = useCallback(
    () =>
      layouts.map((layout) => compilePlotJob(sideStrokes(layout, spreadSide), jobConfig)),
    [jobConfig, layouts, spreadSide],
  );
  const liveCreateJob = useRef(createJob);
  liveCreateJob.current = createJob;
  const boundTextPoint = useMemo(() => textStartBinding ? createJob(textStartBinding.sheet).firstPoint : null,
    [textStartBinding, createJob]);
  const textStartChanged = Boolean(textStartBinding && (!sameXY(textStartBinding.point, boundTextPoint)
    || config.customStartGcode?.trim() || !["grbl", "marlin"].includes(config.profile)));
  const originConfirmed = originEstablished && !textStartChanged;
  const connected =
    plotter.status !== "disconnected" && plotter.status !== "connecting";
  const running = ["running", "paused", "waiting-paper"].includes(
    plotter.status,
  );
  const penControl = usePenControl({
    config, profileId: activeProfile.id, connected, running,
    stopped: plotter.emergencyStopped, controllerEpoch: plotter.controllerEpoch, controllerPenKey,
    machineState: plotter.machineStatus?.state, statusReceivedAt: plotter.machineStatus?.receivedAt,
    setConfig, sendCommands: plotter.sendCommands,
  });
  const penReferenceConfirmed = penControl.referenced;
  const penSetupPosition = penControl.position;
  useEffect(() => {
    if (!originConfirmed || running) forgetJogTrail();
  }, [originConfirmed, running, forgetJogTrail]);
  useEffect(() => {
    if (!connected || plotter.machineStatus?.state === "Alarm") {
      setOriginConfirmed(false);
    }
  }, [connected, plotter.machineStatus?.state]);
  useEffect(() => {
    setOriginConfirmed(false);
  }, [`${plotter.controllerEpoch}:${COORDINATE_FRAME_VERSION}`]);
  const progressPercent = plotter.progress.total
    ? (plotter.progress.current / plotter.progress.total) * 100
    : 0;
  const recoveryIndices = plotter.recovery?.sheetIndices;
  const recoveryCandidate = useMemo(() => {
    if (!plotter.recovery || plotter.recovery.source === "workshop") return { job: null, problem: "" };
    try {
      return { job: recoveryIndices
        ? createSheetQueue(createJobs(), recoveryIndices, config, spreadLabel)
        : { ...createJob(), source: "document" }, problem: "" };
    } catch (reason) {
      return { job: null, problem: reason instanceof Error ? reason.message : "Не удалось восстановить очередь." };
    }
  }, [plotter.recovery?.jobId, plotter.recovery?.source, recoveryIndices, recoveryIndices ? createJobs : createJob, config, settings.pageSize]);
  const documentRecovery = assessRecovery(plotter.recovery, recoveryCandidate.job, config.profile, "document");
  const recoveryProblem = recoveryCandidate.problem || documentRecovery.problem;
  const recoveryAvailable = documentRecovery.available && !recoveryProblem;
  const recoverySheet = recoveryCandidate.job?.sheetRanges?.find(range => plotter.recovery && plotter.recovery.current < range.end)?.sheet;
  const recoveryLabel = recoverySheet === undefined ? "" : sheetLabel(recoverySheet, spreadLabel);
  const assessDevice = useCallback((placingSheet = false) => assessDeviceReadiness({
    connected, running, busy: busy || pending || penControl.busy || plotter.operationBusy, calibrationActive,
    emergencyStopped: plotter.emergencyStopped, profile: config.profile,
    machineState: plotter.machineStatus?.state, statusReceivedAt: plotter.machineStatus?.receivedAt,
    originConfirmed: placingSheet || originConfirmed,
    penReferenceConfirmed: placingSheet || !needsPenReference || penReferenceConfirmed,
    penPositionsVerified: placingSheet || penPositionsVerified,
    controllerSettingsKnown: plotter.controllerSettingsComplete,
  }), [connected, running, busy, pending, penControl.busy, plotter.operationBusy, calibrationActive, plotter.emergencyStopped,
    config.profile, plotter.machineStatus, originConfirmed, needsPenReference, penReferenceConfirmed, penPositionsVerified, plotter.controllerSettingsComplete]);
  const assessJob = useCallback((layout, withinWorkArea = true, commands?: string[]) => {
    const content = assessPlotterPreflight(layout, {
      withinWorkArea,
    });
    const blockers = [...assessDevice().blockers, ...content.blockers, ...(commands ? preparedProgramBlockers(commands, config) : [])];
    return { ...content, originConfirmed, blockers, canStart: blockers.length === 0 };
  }, [assessDevice, originConfirmed, config]);
  const deviceReadiness = assessDevice();
  const placementReadiness = assessDevice(true);
  const preflight = assessJob(activeLayout, job.withinWorkArea, job.commands);
  const assertDeviceReady = useCallback(() => {
    const readiness = assessDevice();
    if (!readiness.canStart) throw new Error(readiness.blockers[0]);
  }, [assessDevice]);
  const playback = usePlotterPlayback(job, {
    status: plotter.status,
    progress: plotter.sheetProgress || plotter.progress,
  });
  const importedWithinWorkArea = useMemo(() => {
    if (!importedGcode) return true;
    const { bounds } = importedGcode.parsed;
    return isWithinWorkArea([[{ x: bounds.minX, y: bounds.minY }, { x: bounds.maxX, y: bounds.maxY }]], config);
  }, [config, importedGcode]);
  const importedLaunchBlockers = importedGcode
    ? [...new Set([...importedGcode.launchBlockers, ...preparedProgramBlockers(importedGcode.commands, config)])] : [];


  const updateConfig = useCallback(
    (key, value) => {
      if (calibrationActive || running || plotter.operationBusy || plotter.status === "connecting") return;
      setConfig((current) => ({ ...current, [key]: value }));
      if (ORIGIN_CONFIG_KEYS.includes(key)) setOriginConfirmed(false);
    },
    [calibrationActive, running, plotter.operationBusy, plotter.status, setConfig],
  );
  const boundedConfig = useCallback(
    (key, value, min, max) => {
      if (!Number.isFinite(Number(value))) return;
      updateConfig(key, Math.min(max, Math.max(min, Number(value))));
    },
    [updateConfig],
  );
  const changeProfile = useCallback(
    (profile) => {
      if (calibrationActive) return;
      setConfig((current) =>
        profile === "marlin"
          ? { ...current, profile, penMode: "servo", penUp: 50, penDown: 0 }
          : profile === "grbl"
            ? {
                ...current,
                profile,
                penMode: "servo",
                penUp: 12000,
                penDown: 18000,
              }
            : { ...current, profile },
      );
      setOriginConfirmed(false);
    },
    [calibrationActive, setConfig],
  );
  const applyDevicePreset = useCallback(
    (presetId) => {
      if (calibrationActive || connected || running) return false;
      setConfig((current) => configFromDevicePreset(presetId, current));
      setOriginConfirmed(false);
      return true;
    },
    [calibrationActive, connected, running, setConfig],
  );
  const resetMechanics = useCallback(() => {
    if (calibrationActive) return;
    setConfig((current) => ({
      ...current,
      ...mechanicsDefaults(current.profile),
    }));
  }, [calibrationActive, setConfig]);
  const safeAction = useCallback(async (action) => {
    setError("");
    try {
      await action();
      return true;
    } catch (reason) {
      if (reason?.name !== "AbortError") setError(reason.message);
      return false;
    }
  }, []);
  const importFont = useCallback(async (file) => {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const loaded = await loadGFont(file);
      setFont(loaded);
      setFontStatus(
        `${file.name} · ${loaded.entries.size.toLocaleString("ru-RU")} символов`,
      );
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }, []);
  const importGcode = useCallback(
    async (file) => {
      if (!file) return null;
      setError("");
      try {
        const imported = prepareImportedGcode(await file.text(), {
          name: file.name,
          byteLength: file.size,
          workAreaWidth: config.workAreaWidth,
          workAreaHeight: config.workAreaHeight,
        });
        setImportedGcode(imported);
        return imported;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : String(reason));
        return null;
      }
    },
    [config.workAreaHeight, config.workAreaWidth],
  );

  const createDeviceProfile = useCallback(
    (name) => {
      const profile = createPlotterProfile(name, config);
      setProfileStore((current) => ({
        ...current,
        activeProfileId: profile.id,
        profiles: [...current.profiles, profile],
      }));
      return profile.id;
    },
    [config],
  );
  const selectDeviceProfile = useCallback(
    (id) => {
      if (calibrationActive || connected || running) return false;
      if (!profileStore.profiles.some((profile) => profile.id === id))
        return false;
      setProfileStore((current) => ({ ...current, activeProfileId: id }));
      return true;
    },
    [calibrationActive, connected, profileStore.profiles, running],
  );
  const renameDeviceProfile = useCallback((id, name) => {
    const clean = String(name || "")
      .trim()
      .slice(0, 64);
    if (!clean) return;
    setProfileStore((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === id
          ? { ...profile, name: clean, updatedAt: Date.now() }
          : profile,
      ),
    }));
  }, []);
  const duplicateDeviceProfile = useCallback(
    (id, name) => {
      const source = profileStore.profiles.find((profile) => profile.id === id);
      if (!source) return null;
      const profile = createPlotterProfile(
        name || `${source.name} — копия`,
        source.config,
        { calibratedAt: source.calibratedAt, calibrationRevision: source.calibrationRevision, calibrationControllerKey: source.calibrationControllerKey },
      );
      setProfileStore((current) => ({
        ...current,
        activeProfileId: profile.id,
        profiles: [...current.profiles, profile],
      }));
      return profile.id;
    },
    [profileStore.profiles],
  );
  const deleteDeviceProfile = useCallback(
    (id) => {
      if (profileStore.profiles.length < 2 || calibrationActive || connected)
        return false;
      setProfileStore((current) => {
        const profiles = current.profiles.filter(
          (profile) => profile.id !== id,
        );
        return {
          ...current,
          activeProfileId:
            current.activeProfileId === id
              ? profiles[0].id
              : current.activeProfileId,
          profiles,
        };
      });
      return true;
    },
    [calibrationActive, connected, profileStore.profiles.length],
  );
  const importDeviceProfile = useCallback(async (file) => {
    const profile = parsePlotterProfile(await file.text());
    setOriginConfirmed(false);
    setProfileStore((current) => ({
      ...current,
      activeProfileId: profile.id,
      profiles: [...current.profiles, profile],
    }));
    return profile;
  }, []);
  const completeCalibration = useCallback(() => {
    if (!connected || !controllerAxisKey || calibrationProof.current !== `${activeProfile.id}:${plotter.controllerEpoch}:${controllerAxisKey}`) {
      setError("Проверка области устарела или параметры платы ещё не прочитаны. Повторите проверку направлений.");
      return false;
    }
    const calibratedAt = Date.now();
    setProfileStore((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === current.activeProfileId
          ? { ...profile, calibratedAt, calibrationRevision: 2, calibrationControllerKey: controllerAxisKey, updatedAt: calibratedAt }
          : profile,
      ),
    }));
    setCalibrationActive(false);
    setOriginConfirmed(true);
    return true;
  }, [controllerAxisKey, connected, activeProfile.id, plotter.controllerEpoch]);
  const updateCalibrationConfig = useCallback((key, value) => {
    if (!calibrationActive) return;
    const allowed = ["invertX", "invertY", "swapAxes", "calibrationStep", "workAreaWidth", "workAreaHeight"];
    if (!allowed.includes(key)) return;
    setConfig((current) => normalizePlotterConfig({ ...current, [key]: value }));
    setOriginConfirmed(false);
  }, [calibrationActive, setConfig]);
  const performCalibrationAction = useCallback(
    async (action) => {
      setError("");
      try {
        if (action !== "probe") {
          if (!controllerAxisKey) throw new Error("Дождитесь чтения параметров контроллера.");
          const proof = `${activeProfile.id}:${plotter.controllerEpoch}:${controllerAxisKey}`;
          if (calibrationProof.current && calibrationProof.current !== proof)
            throw new Error("Контроллер изменился во время проверки. Закройте мастер и начните заново.");
          calibrationProof.current = proof;
        }
        const result = await runCalibrationAction(action, config, plotter.sendCommands);
        return result;
      } catch (reason) {
        setError(reason.message);
        throw reason;
      }
    },
    [config, plotter.sendCommands, controllerAxisKey, activeProfile.id, plotter.controllerEpoch],
  );
  const startCalibration = useCallback(() => {
    if (running || plotter.emergencyStopped) return false;
    calibrationProof.current = null;
    setCalibrationActive(true);
    setOriginConfirmed(false);
    return true;
  }, [running, plotter.emergencyStopped]);
  const stop = useCallback(async () => {
      setOriginConfirmed(false);
      penControl.invalidate();
      try { await plotter.stop(); return true; }
      catch { return false; }
  }, [plotter.stop, penControl.invalidate]);
  const cancelCalibration = useCallback(
    async ({ emergency = false } = {}) => {
      setCalibrationActive(false);
      if (emergency) await stop();
    },
    [stop],
  );

  const placementInFlight = useRef(false);
  const placementContext = JSON.stringify([activeProfile.id, connected, plotter.controllerEpoch,
    config.profile, config.penMode, config.zUp, config.zDown, config.zUpDirection,
    config.startPosition, config.swapAxes, config.invertX, config.invertY, config.workAreaWidth, config.workAreaHeight, controllerPenKey]);
  const livePlacementContext = useRef(placementContext);
  livePlacementContext.current = placementContext;
  const establishSheetOrigin = useCallback(async (upperLeft: boolean, textStart?: { sheet: number; point: XYPoint }) => {
    if (placementInFlight.current) return false;
    const readiness = assessDevice(true);
    if (!readiness.canStart) { setError(readiness.blockers[0]); return false; }
    placementInFlight.current = true;
    setBusy(true);
    setOriginConfirmed(false);
    try {
      return await safeAction(async () => {
        // XY placement must never relabel the current physical Z/E height.
        await plotter.sendCommands(createOriginCommands(config, textStart?.point), { requireIdle: true });
        if (livePlacementContext.current !== placementContext)
          throw new DOMException("Установка начала листа отменена.", "AbortError");
        if (textStart && !sameXY(textStart.point, liveCreateJob.current(textStart.sheet).firstPoint))
          throw new Error("Начало текста изменилось. Дождитесь предпросмотра и задайте точку заново.");
        // A manually placed sheet always starts at its own upper-left corner,
        // independent of the configured machine travel dimensions.
        if (upperLeft) setConfig(current => ({ ...current, startPosition: "left-top" }));
        setTextStartBinding(textStart || null);
        // New paper: an earlier alignment belonged to the old placement.
        setPaperAlignment(null);
        setOriginConfirmed(true);
        jogTrail.current = { x: 0, y: 0 };
        setJogTrailKnown(true);
        setAlignmentStart(null);
      });
    } finally { placementInFlight.current = false; setBusy(false); }
  }, [assessDevice, plotter.sendCommands, config, placementContext, safeAction, setConfig]);

  const setManualStart = useCallback(() => establishSheetOrigin(true), [establishSheetOrigin]);
  const setTextStart = useCallback(async () => {
    try {
      const point = textStartPoint(createJob(), config);
      return await establishSheetOrigin(false, { sheet: activeIndex, point });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось задать начало текста.");
      return false;
    }
  }, [createJob, config, establishSheetOrigin, activeIndex]);
  const assertTextStart = useCallback((prepared) => {
    if (textStartBinding && !sameXY(textStartBinding.point, textStartPoint(prepared, config)))
      throw new Error("У выбранного задания другая начальная точка. Откройте его первый лист, выберите «Первый штрих текста» и запомните точку.");
  }, [textStartBinding, config]);
  const setOrigin = useCallback(() => establishSheetOrigin(false), [establishSheetOrigin]);

  const dryRun = useCallback(
    () =>
      safeAction(() => {
        const readiness = assessJob(activeLayout, job.withinWorkArea, job.commands);
        if (!readiness.canStart) throw new Error(readiness.blockers[0]);
        penControl.forgetPosition();
        forgetJogTrail();
        return plotter.sendCommands(
          createDryRunCommands(activeStrokes, jobConfig), { waitForMotion: true },
        );
      }),
    [activeLayout, activeStrokes, job.withinWorkArea, job.commands, assessJob, jobConfig, plotter.sendCommands, safeAction, penControl.forgetPosition, forgetJogTrail],
  );

  const alignmentAvailable = originConfirmed && !textStartBinding && jogTrailKnown;
  const markAlignmentPoint = useCallback(() => {
    setError("");
    const point = jogTrail.current;
    if (!alignmentAvailable || !point) {
      setError("Запомните угол листа и подводите перо только ручными шагами.");
      return false;
    }
    if (!alignmentStart) {
      setAlignmentStart({ ...point });
      return true;
    }
    try {
      setPaperAlignment(measurePaperAlignment(alignmentStart, point, { ...config, ...placement }, NOTEBOOK_CELL_MM));
      setAlignmentStart(null);
      return true;
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось выровнять тетрадь.");
      return false;
    }
  }, [alignmentAvailable, alignmentStart, config, placement]);
  const resetAlignment = useCallback(() => {
    setPaperAlignment(null);
    setAlignmentStart(null);
  }, []);

  const recover = useCallback(() => safeAction(() => {
    assertDeviceReady();
    assertTextStart(createJob(plotter.recovery?.sheetIndices?.[0] ?? activeIndex));
    const prepared = recoveryCandidate.job;
    assertRecoveryCompatible(plotter.recovery, prepared, config.profile);
    if (!prepared) throw new Error(recoveryProblem || "Нет задания для продолжения.");
    for (const index of plotter.recovery?.sheetIndices || [activeIndex]) {
      const readiness = assessJob(layouts[index], prepared.withinWorkArea !== false);
      if (!readiness.canStart) throw new Error(`${sheetLabel(index, spreadLabel)}: ${readiness.blockers[0]}`);
    }
    const blockers = preparedProgramBlockers(prepared.commands, config);
    if (blockers.length) throw new Error(blockers[0]);
    return plotter.recover(prepared);
  }), [safeAction, assertDeviceReady, assertTextStart, createJob, assessJob, layouts, activeIndex, recoveryCandidate, recoveryProblem,
    plotter.recover, plotter.recovery, config, settings.pageSize]);

  return {
    enabled,
    config,
    profileStore,
    activeProfile,
    createDeviceProfile,
    selectDeviceProfile,
    renameDeviceProfile,
    duplicateDeviceProfile,
    deleteDeviceProfile,
    importDeviceProfile,
    updateConfig,
    boundedConfig,
    changeProfile,
    applyDevicePreset,
    resetMechanics,
    fontStatus,
    importFont,
    importedGcode,
    importedWithinWorkArea,
    importedLaunchBlockers,
    importGcode,
    clearImportedGcode: () => {
      setImportedGcode(null);
    },
    layouts,
    activeIndex,
    activeLayout,
    job,
    createJob,
    createJobs,
    busy: busy || pending,
    error,
    deviceReadiness,
    assessJob,
    calibrationActive,
    startCalibration,
    cancelCalibration,
    completeCalibration,
    performCalibrationAction,
    updateCalibrationConfig,
    connectCalibration: () => plotter.connect(config.profile, config),
    calibrationJog: (dx, dy) =>
      plotter.sendCommands(createPageJogCommands(dx, dy, config), { waitForMotion: true }),
    plotter,
    connected,
    running,
    progressPercent,
    recoveryAvailable,
    recoveryProblem,
    recoveryLabel,
    recoveryOtherSource: documentRecovery.otherSource,
    assessPreparedRecovery: prepared => assessRecovery(plotter.recovery, { ...prepared, source: "workshop" }, config.profile, "workshop"),
    preflight,
    originConfirmed,
    originMode: originConfirmed ? (textStartBinding ? "text" : "sheet") : null,
    notebookSpread: settings.pageSize === "NotebookSpread",
    spreadSide,
    paperAlignment,
    alignmentAvailable,
    alignmentStarted: Boolean(alignmentStart),
    markAlignmentPoint,
    resetAlignment,
    textStartChanged,
    penReferenceConfirmed,
    penSetupPosition,
    penPositionsVerified,
    controllerPenKey,
    controllerAxisKey,
    workAreaConfirmed,
    placementReadiness,
    setManualStart,
    setTextStart,
    penSetupBusy: penControl.busy,
    moveSavedPen: (up: boolean) => safeAction(() => penControl.moveSaved(up)),
    beginPenSetup: () => safeAction(penControl.begin),
    resetPenSetup: () => safeAction(penControl.reset),
    rememberPenPosition: (up: boolean) => safeAction(() => penControl.save(up)),
    setPenReference: (position: "up" | "down" = "up") => safeAction(() => penControl.reference(position)),
    jogPen: (up: boolean, distance: number) => safeAction(() => penControl.jog(up, distance)),
    confirmPenContact: () => safeAction(penControl.confirmContact),
    runPenLadder: (step: number) => safeAction(() => penControl.runLadder(step)),
    applyPenLadder: (index: number) => safeAction(() => penControl.applyLadder(index)),
    adjustPenGeometry: (patch) => safeAction(async () => penControl.adjustGeometry(patch)),
    testPenStroke: () => safeAction(penControl.testStroke),
    penLadderStep: penControl.ladderStep,
    resetProgress: () => safeAction(() => {
      if (running || calibrationActive) throw new Error("Сначала завершите текущую операцию.");
      plotter.resetProgress();
      playback.reset();
      onResetProgress();
    }),
    playback,
    connect: () => safeAction(() => plotter.connect(config.profile, config)),
    disconnect: async () => {
      const success = await safeAction(plotter.disconnect);
      if (success) setOriginConfirmed(false);
      return success;
    },
    unlockAlarm: () => safeAction(async () => {
      setOriginConfirmed(false);
      penControl.invalidate();
      await plotter.sendCommands(["$X"]);
      await plotter.realtime("status");
    }),
    jog: (dx, dy) => safeAction(() => {
      if (calibrationActive || running) throw new Error("Дождитесь завершения текущей операции.");
      if (config.profile === "grbl" && !plotter.controllerSettingsComplete)
        throw new Error("Прочитайте параметры платы в блоке подключения перед ручным движением.");
      const trail = jogTrail.current;
      jogTrail.current = null;
      return plotter.sendCommands(createPageJogCommands(dx, dy, config), {
        waitForMotion: true,
        requireWorkPosition: config.profile === "grbl" && originConfirmed,
        beforeSend: report => assertManualJogAllowed(dx, dy, config, originConfirmed, report),
      }).then(() => {
        if (trail) jogTrail.current = { x: trail.x + dx, y: trail.y + dy };
      }, reason => {
        // A step that may have run partly leaves the pen somewhere unknown.
        forgetJogTrail();
        throw reason;
      });
    }),
    clearSheetOrigin: () => {
      if (running || calibrationActive || plotter.operationBusy || busy) return;
      setOriginConfirmed(false);
      setError("");
    },
    pen: (up, value?: number) => safeAction(() => {
      if (calibrationActive) throw new Error("Завершите мастер настройки.");
      return penControl.test(up, value);
    }),
    setOrigin,
    home: async () => {
      setOriginConfirmed(false);
      penControl.invalidate();
      return safeAction(() =>
        plotter.sendCommands(createHomingCommands(config), { waitForMotion: true }),
      );
    },
    returnToOrigin: () => safeAction(() => {
      assertDeviceReady();
      penControl.forgetPosition();
      return plotter.sendCommands(createReturnToOriginCommands(config), { waitForMotion: true });
    }),
    sendManualCommand: (value) => {
      const command = String(value || "").trim();
      if (
        !command ||
        command.length > 256 ||
        /[^\x09\x20-\x7e]/.test(command)
      ) {
        setError("Введите одну корректную команду длиной до 256 символов.");
        return Promise.resolve(false);
      }
      if (!/^\$(?:\$|I|G|#)$/i.test(command)) {
        penControl.invalidate();
        setOriginConfirmed(false);
      }
      return safeAction(() => plotter.sendCommands([command]));
    },
    dryRun,
    runPreparedJob: (preparedJob, layout) => safeAction(() => {
      const readiness = assessJob(layout, preparedJob.withinWorkArea !== false, preparedJob.commands);
      if (!readiness.canStart) throw new Error(readiness.blockers[0]);
      if (!preparedJob.commands?.length) throw new Error("В задании нет команд.");
      return plotter.run({ ...preparedJob, source: "workshop" });
    }),
    recoverPreparedJob: (preparedJob, layout) => safeAction(() => {
      const readiness = assessJob(layout, preparedJob.withinWorkArea !== false, preparedJob.commands);
      if (!readiness.canStart) throw new Error(readiness.blockers[0]);
      const prepared = { ...preparedJob, source: "workshop" };
      assertRecoveryCompatible(plotter.recovery, prepared, config.profile);
      return plotter.recover(prepared);
    }),
    runPreparedFrame: (strokes, withinPaper = true) => safeAction(() => {
      const prepared = compilePlotJob(strokes, config);
      const readiness = assessJob({ strokes, clipped: !withinPaper }, prepared.withinWorkArea);
      if (!readiness.canStart) throw new Error(readiness.blockers[0]);
      penControl.forgetPosition();
      return plotter.sendCommands(createDryRunCommands(strokes, config), { waitForMotion: true });
    }),
    runPenCalibration: (sheet) => safeAction(() => {
      const content = assessPlotterPreflight({ strokes: sheet.strokes }, { withinWorkArea: sheet.withinWorkArea });
      const blockers = [...assessDevice().blockers, ...content.blockers, ...preparedProgramBlockers(sheet.commands, sheet.checkConfig || config)];
      if (blockers.length) throw new Error(blockers[0]);
      return plotter.run({ ...sheet, recoverable: false });
    }),
    runImportedGcode: () => safeAction(() => {
      assertDeviceReady();
      if (!importedGcode) throw new Error("Сначала откройте файл G-code.");
      if (config.profile === "ebb") throw new Error("Обычный G-code доступен для GRBL и Marlin.");
      if (importedLaunchBlockers.length) throw new Error(importedLaunchBlockers[0]);
      if (!importedWithinWorkArea) throw new Error("Импортированная траектория выходит за рабочую область.");
      const execution = prepareImportedExecution(importedGcode, config);
      penControl.forgetPosition();
      return plotter.run(execution.job, { prefix: execution.prefix, suffix: execution.suffix });
    }),
    run: () => safeAction(() => {
      const prepared = createJob();
      assertTextStart(prepared);
      const readiness = assessJob(activeLayout, prepared.withinWorkArea, prepared.commands);
      if (!readiness.canStart) throw new Error(readiness.blockers[0]);
      return plotter.run({ ...prepared, source: "document" });
    }),
    runSheets: (indices) => safeAction(() => {
      assertDeviceReady();
      if (!Array.isArray(indices) || !indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= layouts.length))
        throw new Error("Выберите существующие листы для запуска.");
      const selected = indices.filter(i => layouts[i]?.strokes.length);
      if (!selected.length) throw new Error("В выбранных листах нет траекторий.");
      const jobs = createJobs();
      assertTextStart(jobs[selected[0]]);
      for (const index of selected) {
        const readiness = assessJob(layouts[index], jobs[index].withinWorkArea, jobs[index].commands);
        if (!readiness.canStart) throw new Error(`Лист ${index + 1}: ${readiness.blockers[0]}`);
      }
      const queue = createSheetQueue(jobs, selected, config, spreadLabel);
      const blockers = preparedProgramBlockers(queue.commands, config);
      if (blockers.length) throw new Error(blockers[0]);
      return plotter.run(queue);
    }),
    recover,
    discardRecovery: plotter.discardRecovery,
    pause: () => safeAction(plotter.pause),
    resume: () => safeAction(plotter.resume),
    stopNotice: plotter.stopNotice,
    emergencyStopped: plotter.emergencyStopped,
    releaseEmergencyStop: async () => {
      try { await plotter.releaseEmergencyStop(); }
      catch { /* The shared STOP notice owns the delivery/release error. */ }
    },
    stop,
  };
}
