import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDebouncedValue } from "./useDebouncedValue";
import { usePenControl } from "./usePenControl";
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
  const [stopNotice, setStopNotice] = useState("");
  const [originConfirmed, setOriginConfirmed] = useState(false);
  const calibrationProof = useRef<string | null>(null);
  const [calibrationActive, setCalibrationActive] = useState(false);
  const [importedGcode, setImportedGcode] = useState(null);
  const plotter = usePlotter();
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
  const penControl = usePenControl({
    config, profileId: activeProfile.id, connected, running,
    stopped: plotter.emergencyStopped, controllerEpoch: plotter.controllerEpoch, controllerPenKey,
    machineState: plotter.machineStatus?.state, statusReceivedAt: plotter.machineStatus?.receivedAt,
    setConfig, sendCommands: plotter.sendCommands,
  });
  const penReferenceConfirmed = penControl.referenced;
  const penSetupPosition = penControl.position;
  useEffect(() => {
    if (!connected || plotter.machineStatus?.state === "Alarm") {
      setOriginConfirmed(false);
    }
  }, [connected, plotter.machineStatus?.state]);
  useEffect(() => {
    setOriginConfirmed(false);
  }, [plotter.controllerEpoch]);
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
  const assessDevice = useCallback(() => assessDeviceReadiness({
    connected, running, busy: busy || pending || penControl.busy || plotter.operationBusy, calibrationActive,
    emergencyStopped: plotter.emergencyStopped, profile: config.profile,
    machineState: plotter.machineStatus?.state, statusReceivedAt: plotter.machineStatus?.receivedAt,
    originConfirmed, penReferenceConfirmed: !needsPenReference || penReferenceConfirmed, penPositionsVerified,
    workAreaConfirmed, controllerSettingsKnown: plotter.controllerSettingsComplete,
  }), [connected, running, busy, pending, penControl.busy, plotter.operationBusy, calibrationActive, plotter.emergencyStopped,
    config.profile, plotter.machineStatus, originConfirmed, needsPenReference, penReferenceConfirmed, penPositionsVerified, workAreaConfirmed, plotter.controllerSettingsComplete]);
  const assessJob = useCallback((layout, withinWorkArea = true, commands?: string[]) => {
    const content = assessPlotterPreflight(layout, {
      withinWorkArea,
    });
    const blockers = [...assessDevice().blockers, ...content.blockers, ...(commands ? preparedProgramBlockers(commands, config) : [])];
    return { ...content, originConfirmed, blockers, canStart: blockers.length === 0 };
  }, [assessDevice, originConfirmed, config]);
  const deviceReadiness = assessDevice();
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
      setStopNotice("Очередь отменена. Отправляю СТОП… Если движение продолжается — отключите питание и USB.");
      try {
        const result = await plotter.stop();
        setStopNotice(result.controllerState
          ? `Очередь отменена. Ответ контроллера: ${result.controllerState}. Новые движения заблокированы. Если механизм продолжает двигаться — отключите питание.`
          : "Очередь отменена. СТОП передан, но ответ о состоянии не получен. Не считайте механизм остановленным: если он движется — отключите питание и USB.");
        return true;
      } catch {
        setStopNotice("Очередь отменена. Передача СТОП не подтверждена. Если механизм движется — отключите питание плоттера и USB.");
        return false;
      }
  }, [plotter.stop, penControl.invalidate]);
  const cancelCalibration = useCallback(
    async ({ emergency = false } = {}) => {
      setCalibrationActive(false);
      if (emergency) await stop();
    },
    [stop],
  );

  const setOrigin = useCallback(async () => {
    setOriginConfirmed(false);
    const success = await safeAction(() =>
      plotter.sendCommands(createOriginCommands(config)),
    );
    if (success) setOriginConfirmed(true);
    return success;
  }, [config, plotter.sendCommands, safeAction]);

  const dryRun = useCallback(
    () =>
      safeAction(() => {
        const readiness = assessJob(activeLayout, job.withinWorkArea, job.commands);
        if (!readiness.canStart) throw new Error(readiness.blockers[0]);
        penControl.forgetPosition();
        return plotter.sendCommands(
          createDryRunCommands(activeLayout.strokes, config), { waitForMotion: true },
        );
      }),
    [activeLayout, job.withinWorkArea, job.commands, assessJob, config, plotter.sendCommands, safeAction, penControl.forgetPosition],
  );

  const recover = useCallback(() => safeAction(() => {
    const prepared = createJob();
    const readiness = assessJob(activeLayout, prepared.withinWorkArea, prepared.commands);
    if (!readiness.canStart) throw new Error(readiness.blockers[0]);
    return plotter.recover(prepared);
  }), [safeAction, assessJob, activeLayout, plotter.recover, createJob]);

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
    preflight,
    originConfirmed,
    penReferenceConfirmed,
    penSetupPosition,
    penPositionsVerified,
    controllerPenKey,
    controllerAxisKey,
    workAreaConfirmed,
    penSetupBusy: penControl.busy,
    moveSavedPen: (up: boolean) => safeAction(() => penControl.moveSaved(up)),
    beginPenSetup: () => safeAction(penControl.begin),
    resetPenSetup: () => safeAction(penControl.reset),
    rememberPenPosition: (up: boolean) => safeAction(() => penControl.save(up)),
    setPenReference: (position: "up" | "down" = "up") => safeAction(() => penControl.reference(position)),
    jogPen: (up: boolean, distance: number) => safeAction(() => penControl.jog(up, distance)),
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
      if (!workAreaConfirmed) throw new Error("Сначала проверьте направления и размеры рабочей области.");
      return plotter.sendCommands(createPageJogCommands(dx, dy, config), { waitForMotion: true });
    }),
    pen: (up, value?: number) => safeAction(() => {
      if (calibrationActive) throw new Error("Завершите мастер настройки.");
      return penControl.test(up, value);
    }),
    setOrigin,
    home: async () => {
      penControl.invalidate();
      const success = await safeAction(() =>
        plotter.sendCommands(createHomingCommands(config)),
      );
      if (success) setOriginConfirmed(false);
      return success;
    },
    returnToOrigin: () => safeAction(() => {
      assertDeviceReady();
      penControl.forgetPosition();
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
      return plotter.run(preparedJob);
    }),
    runPreparedFrame: (strokes, withinPaper = true) => safeAction(() => {
      const prepared = compilePlotJob(strokes, config);
      const readiness = assessJob({ strokes, clipped: !withinPaper }, prepared.withinWorkArea);
      if (!readiness.canStart) throw new Error(readiness.blockers[0]);
      penControl.forgetPosition();
      return plotter.sendCommands(createDryRunCommands(strokes, config), { waitForMotion: true });
    }),
    runPenCalibration: (sheet) => safeAction(() => {
      const readiness = assessJob({ strokes: sheet.strokes }, sheet.withinWorkArea, sheet.commands);
      if (!readiness.canStart) throw new Error(readiness.blockers[0]);
      return plotter.run(sheet);
    }),
    runImportedGcode: () => safeAction(() => {
      assertDeviceReady();
      if (!importedGcode) throw new Error("Сначала откройте файл G-code.");
      if (config.profile === "ebb") throw new Error("Обычный G-code доступен для GRBL и Marlin.");
      if (importedLaunchBlockers.length) throw new Error(importedLaunchBlockers[0]);
      if (!importedWithinWorkArea) throw new Error("Импортированная траектория выходит за рабочую область.");
      penControl.forgetPosition();
      return plotter.run({ ...importedGcode, commands: ["G21", "G90", ...createPenCommand(true, config), ...importedGcode.commands] });
    }),
    run: () => safeAction(() => {
      const prepared = createJob();
      const readiness = assessJob(activeLayout, prepared.withinWorkArea, prepared.commands);
      if (!readiness.canStart) throw new Error(readiness.blockers[0]);
      return plotter.run(prepared);
    }),
    runSheets: (indices) => safeAction(() => {
      assertDeviceReady();
      if (!Array.isArray(indices) || !indices.length || indices.some(i => !Number.isInteger(i) || i < 0 || i >= layouts.length))
        throw new Error("Выберите существующие листы для запуска.");
      const selected = indices.filter(i => layouts[i]?.strokes.length);
      if (!selected.length) throw new Error("В выбранных листах нет траекторий.");
      const jobs = createJobs();
      for (const index of selected) {
        const readiness = assessJob(layouts[index], jobs[index].withinWorkArea, jobs[index].commands);
        if (!readiness.canStart) throw new Error(`Лист ${index + 1}: ${readiness.blockers[0]}`);
      }
      const queue = createSheetQueue(jobs, selected, config, settings.pageSize === "NotebookSpread");
      const blockers = preparedProgramBlockers(queue.commands, config);
      if (blockers.length) throw new Error(blockers[0]);
      return plotter.run(queue);
    }),
    recover,
    discardRecovery: plotter.discardRecovery,
    pause: () => safeAction(plotter.pause),
    resume: () => safeAction(plotter.resume),
    stopNotice,
    emergencyStopped: plotter.emergencyStopped,
    releaseEmergencyStop: async () => {
      try { await plotter.releaseEmergencyStop(); setStopNotice(""); }
      catch (reason) { setStopNotice(reason.message); }
    },
    stop,
  };
}
