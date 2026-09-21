import { useCallback, useEffect, useMemo, useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";
import { usePlotter } from "./usePlotter";
import { usePlotterPlayback } from "./usePlotterPlayback";
import { loadBundledGFont, loadGFont } from "../plotter/gfont";
import {
  compilePlotJob,
  createDryRunCommands,
  createHomingCommands,
  createPageJogCommands,
  createOriginCommands,
  createPenCommand,
  createPenJogCommands,
  createPenReferenceCommands,
  createReturnToOriginCommands,
  DEFAULT_PLOTTER_CONFIG,
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
import { assessPlotterPreflight } from "../plotter/preflight";
import { prepareImportedGcode } from "../plotter/gcodeImport";
import { createSheetQueue } from "../plotter/sheetQueue";
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
    result = await layoutText(text, font, adjustedPage, config);
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

function combineLogicalLayouts(logicalLayouts, settings, metrics) {
  if (settings.pageSize !== "NotebookSpread") return logicalLayouts;
  return Array.from(
    { length: Math.ceil(logicalLayouts.length / 2) },
    (_, index) => {
      const parts = logicalLayouts.slice(index * 2, index * 2 + 2);
      return {
        page: pageForLogicalIndex(settings, metrics, index * 2),
        strokes: parts.flatMap((part) => part.strokes),
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
    },
  );
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
  onResetProgress = () => {},
  pending = false,
}) {
  const [profileStore, setProfileStore] = useState(loadPlotterProfileStore);
  const [font, setFont] = useState(null);
  const [fontStatus, setFontStatus] = useState("Выберите однолинейный GFont");
  const [layouts, setLayouts] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [armed, setArmed] = useState(false);
  const [originConfirmed, setOriginConfirmed] = useState(false);
  const [penReferenceConfirmed, setPenReferenceConfirmed] = useState(false);
  const [calibrationActive, setCalibrationActive] = useState(false);
  const [importedGcode, setImportedGcode] = useState(null);
  const plotter = usePlotter();
  const activeProfile =
    profileStore.profiles.find(
      (profile) => profile.id === profileStore.activeProfileId,
    ) || profileStore.profiles[0];
  const config = activeProfile.config;
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
      setArmed(false);
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
        ascenderScale: settings.ascenderScale,
        descenderScale: settings.descenderScale,
        fatigueEnabled: settings.fatigueEnabled,
        fatigueStrength: settings.fatigueStrength,
      };
      const logicalLayouts = [];
      // Manually placed pages already include their leading blank pages.
      if (settings.writingStartEnabled && !pageBlocks.some(blocks => blocks.some(block => block.defaultLayout || block.layout?.dirty))) {
        for (let i = 0; i < settings.writingStartPage; i++) logicalLayouts.push({
          page: pageForLogicalIndex(settings, metrics, i), strokes: [], missing: [], clipped: false, startLineSafe: true,
        });
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
          const result = await layoutBlocks(blocks, font, page, layoutConfig);
          logicalLayouts.push({
            page,
            ...result,
            startLineSafe: minStrokeY(result.strokes) >= page.top - 0.001,
          });
          setLayouts(combineLogicalLayouts(logicalLayouts, settings, metrics));
          await new Promise((resolve) => window.setTimeout(resolve, 0));
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
              const result = await layoutBelowStart(remaining, font, page, {
                ...layoutConfig,
                seed: Number(layoutConfig.seed) + logicalLayouts.length * 9973,
              });
              const nextText = result.overflowText || "";
              const stalled = Boolean(nextText) && nextText === remaining;
              logicalLayouts.push({
                page,
                ...result,
                clipped:
                  result.clipped && (!nextText || stalled || guard >= 99),
              });
              setLayouts(
                combineLogicalLayouts(logicalLayouts, settings, metrics),
              );
              await new Promise((resolve) => window.setTimeout(resolve, 0));
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
    };
    calculate()
      .catch((reason) => !cancelled && setError(reason.message))
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
    previewConfig.letterSpacing,
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
    settings.ascenderScale,
    settings.descenderScale,
    settings.fatigueEnabled,
    settings.fatigueStrength,
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
  const job = useMemo(
    () => compilePlotJob(activeLayout.strokes, previewConfig),
    [activeLayout.strokes, previewConfig],
  );
  const createJob = useCallback(
    (index = activeIndex) => {
      const layout = layouts[index];
      return compilePlotJob(layout?.strokes || [], config);
    },
    [activeIndex, config, layouts],
  );
  const createJobs = useCallback(
    () =>
      layouts.map((layout) => compilePlotJob(layout?.strokes || [], config)),
    [config, layouts],
  );
  const connected =
    plotter.status !== "disconnected" && plotter.status !== "connecting";
  const running = ["running", "paused", "waiting-paper"].includes(
    plotter.status,
  );
  useEffect(() => {
    if (!connected || plotter.machineStatus?.state === "Alarm") {
      setOriginConfirmed(false);
      setArmed(false);
    }
  }, [connected, plotter.machineStatus?.state]);
  useEffect(() => {
    setOriginConfirmed(false);
    setArmed(false);
  }, [plotter.controllerEpoch]);
  useEffect(() => {
    setPenReferenceConfirmed(false);
  }, [connected, plotter.controllerEpoch, activeProfile.id, config.profile, config.penMode]);
  const progressPercent = plotter.progress.total
    ? (plotter.progress.current / plotter.progress.total) * 100
    : 0;
  const recoveryAvailable = Boolean(
    job.recoverable &&
      plotter.recovery &&
      plotter.recovery.jobId === job.id &&
      plotter.recovery.total === job.commands.length &&
      plotter.recovery.current < plotter.recovery.total,
  );
  const preflight = assessPlotterPreflight(activeLayout, {
    calibrated: Boolean(activeProfile.calibratedAt),
    originConfirmed,
    withinWorkArea: job.withinWorkArea,
    penReferenceConfirmed: !needsPenReference || penReferenceConfirmed,
  });
  const playback = usePlotterPlayback(job, {
    status: plotter.status,
    progress: plotter.sheetProgress || plotter.progress,
  });
  const importedWithinWorkArea = useMemo(() => {
    if (!importedGcode) return true;
    const { bounds } = importedGcode.parsed;
    return (
      Math.max(Math.abs(bounds.minX), Math.abs(bounds.maxX)) <=
        Number(config.workAreaWidth) + 0.01 &&
      Math.max(Math.abs(bounds.minY), Math.abs(bounds.maxY)) <=
        Number(config.workAreaHeight) + 0.01
    );
  }, [config.workAreaHeight, config.workAreaWidth, importedGcode]);

  const updateConfig = useCallback(
    (key, value) => {
      if (calibrationActive) return;
      setConfig((current) => ({ ...current, [key]: value }));
      setArmed(false);
      if (ORIGIN_CONFIG_KEYS.includes(key)) setOriginConfirmed(false);
    },
    [calibrationActive, setConfig],
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
      setArmed(false);
      setOriginConfirmed(false);
    },
    [calibrationActive, setConfig],
  );
  const applyDevicePreset = useCallback(
    (presetId) => {
      if (calibrationActive || connected || running) return false;
      setConfig((current) => configFromDevicePreset(presetId, current));
      setArmed(false);
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
    setArmed(false);
  }, [calibrationActive, setConfig]);
  const safeAction = useCallback(async (action) => {
    setError("");
    try {
      await action();
      return true;
    } catch (reason) {
      setError(reason.message);
      return false;
    }
  }, []);
  const ensurePenHolding = useCallback(async () => {
    if (config.profile !== "grbl" || config.penMode !== "stepper") return false;
    const changed = await plotter.ensureStepperHolding();
    if (changed) {
      setPenReferenceConfirmed(false);
      setOriginConfirmed(false);
      setArmed(false);
    }
    return changed;
  }, [config.profile, config.penMode, plotter.ensureStepperHolding]);
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
      setArmed(false);
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
        setArmed(false);
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
      setArmed(false);
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
      setArmed(false);
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
      );
      setProfileStore((current) => ({
        ...current,
        activeProfileId: profile.id,
        profiles: [...current.profiles, profile],
      }));
      setArmed(false);
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
      setArmed(false);
      return true;
    },
    [calibrationActive, connected, profileStore.profiles.length],
  );
  const importDeviceProfile = useCallback(async (file) => {
    const profile = parsePlotterProfile(await file.text());
    setProfileStore((current) => ({
      ...current,
      activeProfileId: profile.id,
      profiles: [...current.profiles, profile],
    }));
    setArmed(false);
    return profile;
  }, []);
  const completeCalibration = useCallback(() => {
    const calibratedAt = Date.now();
    setProfileStore((current) => ({
      ...current,
      profiles: current.profiles.map((profile) =>
        profile.id === current.activeProfileId
          ? { ...profile, calibratedAt, calibrationRevision: 2, updatedAt: calibratedAt }
          : profile,
      ),
    }));
    setCalibrationActive(false);
    setArmed(false);
    setOriginConfirmed(true);
  }, []);
  const updateCalibrationConfig = useCallback((key, value) => {
    if (!calibrationActive) return;
    const allowed = ["invertX", "invertY", "swapAxes", "penUp", "penDown", "zUp", "zDown", "calibrationStep", "workAreaWidth", "workAreaHeight"];
    if (!allowed.includes(key)) return;
    setConfig((current) => normalizePlotterConfig({ ...current, [key]: value }));
    setOriginConfirmed(false);
    setArmed(false);
  }, [calibrationActive, setConfig]);
  const performCalibrationAction = useCallback(
    async (action) => {
      setError("");
      try {
        const holdingChanged = action.startsWith("pen-") && await ensurePenHolding();
        if (holdingChanged && action !== "pen-reference")
          throw new Error("Удержание моторов включено. Укажите текущее положение пера перед проверкой.");
        if (action.startsWith("pen-") && action !== "pen-reference" && needsPenReference && !penReferenceConfirmed)
          throw new Error("Сначала задайте ноль поднятого пера.");
        if (action === "pen-reference" && penReferenceConfirmed && !holdingChanged) return [];
        const result = await runCalibrationAction(action, config, plotter.sendCommands);
        if (action === "pen-reference") setPenReferenceConfirmed(true);
        return result;
      } catch (reason) {
        setError(reason.message);
        throw reason;
      }
    },
    [config, plotter.sendCommands, needsPenReference, penReferenceConfirmed, ensurePenHolding],
  );
  const startCalibration = useCallback(() => {
    if (running) return false;
    setCalibrationActive(true);
    setArmed(false);
    setOriginConfirmed(false);
    return true;
  }, [running]);
  const cancelCalibration = useCallback(
    async ({ emergency = false } = {}) => {
      if (emergency) await safeAction(plotter.stop);
      setCalibrationActive(false);
      setArmed(false);
    },
    [plotter.stop, safeAction],
  );

  const setOrigin = useCallback(async () => {
    const success = await safeAction(() =>
      plotter.sendCommands(createOriginCommands(config)),
    );
    if (success) setOriginConfirmed(true);
    return success;
  }, [config, plotter.sendCommands, safeAction]);

  const dryRun = useCallback(
    () =>
      safeAction(() => {
        if (!originConfirmed || (needsPenReference && !penReferenceConfirmed))
          throw new Error("Перед рамкой задайте ноль листа и ноль поднятого пера.");
        return plotter.sendCommands(
          createDryRunCommands(activeLayout.strokes, config),
        );
      }),
    [activeLayout.strokes, config, plotter.sendCommands, safeAction, originConfirmed, needsPenReference, penReferenceConfirmed],
  );

  const recover = useCallback(() => {
    if (!originConfirmed || (needsPenReference && !penReferenceConfirmed)) {
      setError(
        "Перед продолжением выполните homing на контроллере, верните перо к исходной точке листа и нажмите «Установить ноль».",
      );
      return Promise.resolve(false);
    }
    return calibrationActive
      ? Promise.resolve(false)
      : safeAction(() => plotter.recover(createJob()));
  }, [
    calibrationActive,
    createJob,
    originConfirmed,
    plotter.recover,
    needsPenReference,
    penReferenceConfirmed,
    safeAction,
  ]);

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
    importGcode,
    clearImportedGcode: () => {
      setImportedGcode(null);
      setArmed(false);
    },
    layouts,
    activeIndex,
    activeLayout,
    job,
    createJob,
    createJobs,
    busy: busy || pending,
    error,
    armed,
    setArmed: (value) => {
      if (!calibrationActive) setArmed(value);
    },
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
    preflight,
    originConfirmed,
    penReferenceConfirmed,
    setPenReference: (position: "up" | "down" = "up") => safeAction(async () => {
      if (!needsPenReference || running || calibrationActive)
        throw new Error("Дождитесь завершения операции и выберите шаговый механизм пера.");
      if (penReferenceConfirmed) return;
      await ensurePenHolding();
      await plotter.sendCommands(createPenReferenceCommands(config, position));
      setPenReferenceConfirmed(true);
    }),
    jogPen: (up, distance) => safeAction(async () => {
      if (running || calibrationActive) throw new Error("Дождитесь завершения текущей операции.");
      setArmed(false);
      await ensurePenHolding();
      await plotter.sendCommands(createPenJogCommands(up, distance, config), { waitForMotion: true });
    }),
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
      setArmed(false);
      setOriginConfirmed(false);
      setPenReferenceConfirmed(false);
      await plotter.sendCommands(["$X"]);
      await plotter.realtime("status");
    }),
    jog: (dx, dy) =>
      safeAction(() =>
        plotter.sendCommands(createPageJogCommands(dx, dy, config)),
      ),
    pen: (up, value?: number) => safeAction(async () => {
      if (needsPenReference && !penReferenceConfirmed)
        throw new Error("Укажите текущее положение пера во вкладке «Плоттер»: поднято или опущено.");
      if (running || calibrationActive) throw new Error("Дождитесь завершения текущей операции.");
      const key = needsPenReference ? (up ? "zUp" : "zDown") : (up ? "penUp" : "penDown");
      if (value !== undefined && !Number.isFinite(value)) throw new Error("Введите числовое положение пера.");
      const next = normalizePlotterConfig({ ...config, [key]: value ?? config[key] });
      if (value !== undefined && next[key] !== value)
        throw new Error("Положение вне допустимого диапазона. Команда не отправлена.");
      if (await ensurePenHolding())
        throw new Error("Удержание моторов включено. Укажите текущее положение пера перед проверкой.");
      setConfig((current) => ({ ...current, [key]: next[key] }));
      setArmed(false);
      await plotter.sendCommands(createPenCommand(up, next), { waitForMotion: true });
    }),
    setOrigin,
    home: async () => {
      setPenReferenceConfirmed(false);
      const success = await safeAction(() =>
        plotter.sendCommands(createHomingCommands(config)),
      );
      if (success) setOriginConfirmed(false);
      return success;
    },
    returnToOrigin: () => safeAction(() => {
      if (!originConfirmed || (needsPenReference && !penReferenceConfirmed))
        throw new Error("Сначала задайте ноль листа и ноль поднятого пера.");
      return plotter.sendCommands(createReturnToOriginCommands(config));
    }),
    sendManualCommand: (value) => {
      const command = String(value || "").trim();
      if (
        !command ||
        command.length > 256 ||
        /[\r\n\u0000-\u001f]/.test(command)
      ) {
        setError("Введите одну корректную команду длиной до 256 символов.");
        return Promise.resolve(false);
      }
      if (!/^\$(?:\$|I|G|#)$/i.test(command)) {
        setPenReferenceConfirmed(false);
        setOriginConfirmed(false);
        setArmed(false);
      }
      return safeAction(() => plotter.sendCommands([command]));
    },
    dryRun,
    runPenCalibration: (sheet) => {
      if (calibrationActive || running || !connected) return Promise.resolve(false);
      if (!armed || !originConfirmed) {
        setError("Перед пробой пера установите ноль и подтвердите готовность пера.");
        return Promise.resolve(false);
      }
      if (needsPenReference && !penReferenceConfirmed) {
        setError("Сначала задайте ноль поднятого пера.");
        return Promise.resolve(false);
      }
      if (!sheet.withinWorkArea) {
        setError("Проба пера выходит за рабочую область.");
        return Promise.resolve(false);
      }
      return safeAction(() => plotter.run(sheet));
    },
    runImportedGcode: () => {
      if (!importedGcode) {
        setError("Сначала откройте файл G-code.");
        return Promise.resolve(false);
      }
      if (config.profile === "ebb") {
        setError("Импорт обычного G-code доступен для GRBL и Marlin.");
        return Promise.resolve(false);
      }
      if (!armed || !originConfirmed || (needsPenReference && !penReferenceConfirmed)) {
        setError("Перед отправкой файла подтвердите перо и нулевую точку.");
        return Promise.resolve(false);
      }
      if (!importedWithinWorkArea) {
        setError("Импортированная траектория выходит за рабочую область.");
        return Promise.resolve(false);
      }
      return safeAction(() => plotter.run(importedGcode));
    },
    run: () => {
      if (
        calibrationActive ||
        running ||
        !connected ||
        !armed ||
        busy ||
        pending
      )
        return Promise.resolve(false);
      if (!preflight.canStart) {
        setError(preflight.blockers[0]);
        return Promise.resolve(false);
      }
      return safeAction(() => plotter.run(createJob()));
    },
    runSheets: (indices) => {
      if (
        calibrationActive ||
        running ||
        !connected ||
        !armed ||
        busy ||
        pending
      )
        return Promise.resolve(false);
      if (!Array.isArray(indices) || !indices.length) {
        setError("Выберите хотя бы один лист для запуска.");
        return Promise.resolve(false);
      }
      indices = indices.filter(index => layouts[index]?.strokes.length);
      const unsafeLayout = indices
        .map((index) => layouts[index])
        .map((layout) =>
          assessPlotterPreflight(layout, {
            calibrated: Boolean(activeProfile.calibratedAt),
            originConfirmed,
            penReferenceConfirmed: !needsPenReference || penReferenceConfirmed,
            withinWorkArea: compilePlotJob(layout?.strokes || [], config)
              .withinWorkArea,
          }),
        )
        .find((assessment) => !assessment.canStart);
      if (unsafeLayout) {
        setError(unsafeLayout.blockers[0]);
        return Promise.resolve(false);
      }
      return safeAction(() => {
        return plotter.run(
          createSheetQueue(
            createJobs(),
            indices,
            config,
            settings.pageSize === "NotebookSpread",
          ),
        );
      });
    },
    recover,
    discardRecovery: plotter.discardRecovery,
    pause: () => safeAction(plotter.pause),
    resume: () => safeAction(plotter.resume),
    stop: () => {
      setOriginConfirmed(false);
      setArmed(false);
      return safeAction(plotter.stop);
    },
  };
}
