import { useCallback, useEffect, useRef, useState } from "react";
import { createOriginCommands, createPenCommand, createPenJogCommands, createPenReferenceCommands } from "../plotter/job";
import { normalizePlotterConfig } from "../plotter/profiles";
import { clearPenSetup, hasVerifiedPenPositions, penTestDelta, PEN_TEST_STEP_MM, MAX_PEN_JOG_MM, savePenPosition } from "../plotter/penLift";

type Config = ReturnType<typeof normalizePlotterConfig>;
type Snapshot = { context: string; referenced: boolean; position: number | null };
type Options = {
  config: Config;
  profileId: string;
  connected: boolean;
  running: boolean;
  stopped: boolean;
  controllerEpoch: number;
  controllerPenKey: string | null;
  machineState?: string;
  statusReceivedAt?: number;
  setConfig: (update: (config: Config) => Config) => void;
  sendCommands: (commands: string[], options?: { waitForMotion?: boolean }) => Promise<unknown>;
};

/** Session-only pose. Profile values never imply a known physical position. */
export function usePenControl(options: Options) {
  const context = JSON.stringify([options.profileId, options.connected, options.controllerEpoch,
    options.config.profile, options.config.penMode, options.config.zUpDirection, options.controllerPenKey]);
  const current = useRef({ ...options, context });
  current.current = { ...options, context };
  const revision = useRef(0);
  const inflight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>({ context, referenced: false, position: null });
  const snapshotRef = useRef(snapshot);
  const publish = useCallback((next: Snapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
  }, []);
  const invalidate = useCallback(() => {
    ++revision.current;
    publish({ context: current.current.context, referenced: false, position: null });
  }, [publish]);
  const forgetPosition = useCallback(() => {
    ++revision.current;
    const state = snapshotRef.current;
    publish({ context: current.current.context, referenced: state.context === current.current.context && state.referenced, position: null });
  }, [publish]);
  useEffect(() => { invalidate(); }, [context, invalidate]);
  useEffect(() => {
    if (options.stopped || options.machineState === "Alarm") invalidate();
    else if (options.running) forgetPosition();
  }, [options.stopped, options.machineState, options.running, invalidate, forgetPosition]);
  useEffect(() => () => { ++revision.current; }, []);

  const state = snapshot.context === context ? snapshot : { context, referenced: false, position: null };
  const ensureIdle = useCallback((requiresConnection = true) => {
    const live = current.current;
    if (inflight.current || live.running) throw new Error("Дождитесь завершения движения или нажмите СТОП.");
    if (requiresConnection && !live.connected) throw new Error("Подключите плоттер.");
    if (requiresConnection && live.stopped) throw new Error("СТОП: сначала разрешите управление.");
    if (requiresConnection && live.config.profile === "grbl" &&
        (live.machineState !== "Idle" || !live.statusReceivedAt || Date.now() - live.statusReceivedAt > 3000))
      throw new Error("Дождитесь свежего ответа Idle от контроллера. При Alarm сначала устраните его причину.");
    return live;
  }, []);
  const pose = useCallback(() => {
    const state = snapshotRef.current;
    return state.context === current.current.context ? state : { context: current.current.context, referenced: false, position: null };
  }, []);
  const operate = useCallback(async (action: (live: typeof current.current, commit: (position: number | null) => void) => Promise<void>) => {
    const live = ensureIdle();
    const token = revision.current;
    inflight.current = true;
    setBusy(true);
    const commit = (position: number | null) => {
      if (token !== revision.current || live.context !== current.current.context || current.current.stopped)
        throw new Error("Операция отменена. Текущее положение пера неизвестно.");
      publish({ context: live.context, referenced: true, position });
    };
    try { await action(live, commit); }
    catch (error) { invalidate(); throw error; }
    finally { inflight.current = false; setBusy(false); }
  }, [ensureIdle, invalidate, publish]);

  const begin = useCallback(() => operate(async (live, commit) => {
    if (!["stepper", "estepper"].includes(live.config.penMode)) throw new Error("Выберите шаговый механизм пера.");
    if (!live.controllerPenKey) throw new Error("Дождитесь чтения параметров контроллера перед настройкой пера.");
    const setup = clearPenSetup({ ...live.config, penControllerKey: live.controllerPenKey });
    await live.sendCommands(createPenReferenceCommands(setup, "up"));
    commit(0);
    live.setConfig(() => setup);
  }), [operate]);
  const reference = useCallback((position: "up" | "down", includeSheetOrigin = false) => operate(async (live, commit) => {
    if (!hasVerifiedPenPositions(live.config, live.controllerPenKey)) throw new Error("Сначала сохраните два положения пера.");
    await live.sendCommands([
      ...createPenReferenceCommands(live.config, position),
      ...(includeSheetOrigin ? createOriginCommands(live.config) : []),
    ]);
    commit(position === "up" ? live.config.zUp : live.config.zDown);
  }), [operate]);
  const jog = useCallback((up: boolean, distance = PEN_TEST_STEP_MM) => operate(async (live, commit) => {
    if (!Number.isFinite(distance) || distance < 0.01 || distance > MAX_PEN_JOG_MM)
      throw new Error("Для настройки доступен один шаг от 0,01 до 1 мм.");
    const before = pose();
    if (!before.referenced || before.position === null) throw new Error("Сначала начните настройку в текущем положении.");
    const position = Number((before.position + distance * live.config.zUpDirection * (up ? 1 : -1)).toFixed(3));
    if (position < -50 || position > 50) throw new Error("Достигнут предел диапазона настройки пера.");
    await live.sendCommands(createPenJogCommands(up, distance, live.config), { waitForMotion: true });
    commit(position);
  }), [operate, pose]);
  const moveSaved = useCallback((up: boolean) => operate(async (live, commit) => {
    if (!hasVerifiedPenPositions(live.config, live.controllerPenKey) || !pose().referenced)
      throw new Error("Сначала сохраните две высоты и укажите текущее положение пера.");
    await live.sendCommands(createPenCommand(up, live.config), { waitForMotion: true });
    commit(up ? live.config.zUp : live.config.zDown);
  }), [operate, pose]);
  const save = useCallback((up: boolean) => {
    const live = ensureIdle();
    const before = pose();
    if (!before.referenced || before.position === null) throw new Error("Сначала начните настройку в текущем положении.");
    const next = savePenPosition(live.config, up, before.position);
    live.setConfig(() => next);
  }, [ensureIdle, pose]);
  const reset = useCallback(() => {
    const live = ensureIdle(false);
    invalidate();
    live.setConfig(clearPenSetup);
  }, [ensureIdle, invalidate]);
  const test = useCallback((up: boolean, value?: number) => operate(async (live, commit) => {
    const stepper = ["stepper", "estepper"].includes(live.config.penMode);
    const key = stepper ? (up ? "zUp" : "zDown") : (up ? "penUp" : "penDown");
    const next = normalizePlotterConfig({ ...live.config, [key]: value ?? live.config[key] });
    if (value !== undefined && (!Number.isFinite(value) || next[key] !== value)) throw new Error("Значение вне допустимого диапазона.");
    if (stepper) {
      const before = pose();
      if (!before.referenced || before.position === null) throw new Error("Сначала начните настройку в текущем положении.");
      const delta = penTestDelta(before.position, next[key]);
      if (delta) await live.sendCommands(createPenJogCommands(Math.sign(delta) === next.zUpDirection, Math.abs(delta), next), { waitForMotion: true });
      commit(Number((before.position + delta).toFixed(3)));
    } else {
      await live.sendCommands(createPenCommand(up, next), { waitForMotion: true });
      commit(null);
    }
    live.setConfig(() => next);
  }), [operate, pose]);

  return { busy, moveSaved, referenced: state.referenced, position: state.position, begin, reference, jog, save, reset, test, invalidate, forgetPosition };
}
