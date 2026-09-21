import { useCallback, useEffect, useRef, useState } from "react";
import { notifyPlotter } from "../lib/notifications";
import type { PaperChange } from "../plotter/sheetQueue";
import {
  GRBL_REALTIME,
  parseGrblStatus,
  type GrblStatus,
} from "../plotter/grbl";
import {
  loadStoredObject,
  removeStoredValue,
  saveStoredValues,
} from "../lib/storage";
import {
  assertRecoveryCompatible,
  normalizeRecoveryState,
  type PlotterRecoveryState,
} from "../plotter/recovery";

const encoder = new TextEncoder();
const RECOVERY_KEY = "openhand.plotter.recovery.v1";

function loadRecovery(): PlotterRecoveryState | null {
  const value = loadStoredObject<Partial<PlotterRecoveryState>>(
    RECOVERY_KEY,
    {},
  );
  return normalizeRecoveryState(value);
}

function lineEnding(profile) {
  // GRBL accepts CR and LF separately; CRLF can yield two acknowledgements
  // (the second for an empty line), incorrectly completing the next command.
  return profile === "ebb" ? "\r\n" : "\n";
}

export function usePlotter() {
  const supported = typeof navigator !== "undefined" && "serial" in navigator;
  const networkSupported =
    typeof window !== "undefined" && Boolean(window.__openhandNativePlatform);
  const [status, setStatus] = useState("disconnected");
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [paperChange, setPaperChange] = useState<PaperChange | null>(null);
  const [printingSheet, setPrintingSheet] = useState<number | null>(null);
  const [sheetProgress, setSheetProgress] = useState<{
    current: number;
    total: number;
  } | null>(null);
  const paperWaiterRef = useRef<{
    resolve: () => void;
    reject: (reason: Error) => void;
  } | null>(null);
  const [machineStatus, setMachineStatus] = useState<GrblStatus | null>(null);
  const [controllerEpoch, setControllerEpoch] = useState(0);
  const operationRef = useRef(false);
  const connectingRef = useRef(false);
  const desynchronizedRef = useRef(false);
  const [recovery, setRecovery] = useState(loadRecovery);
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const profileRef = useRef("grbl");
  const pendingRef = useRef([]);
  const abortRef = useRef(false);
  const emergencyStopRef = useRef(false);
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const pausedRef = useRef(false);
  const pauseWaitersRef = useRef([]);
  const commandTimeoutRef = useRef(12000);
  const statusReportRef = useRef({ sequence: 0, state: "" });
  const controllerSettingsRef = useRef<Record<number, number>>({});
  const [controllerSettings, setControllerSettings] = useState<Record<number, number>>({});

  const rememberSetting = useCallback((line: string) => {
    const match = /^\$(\d+)=(-?\d+(?:\.\d+)?)$/.exec(line.trim());
    if (!match) return;
    const next = { ...controllerSettingsRef.current, [Number(match[1])]: Number(match[2]) };
    controllerSettingsRef.current = next;
    setControllerSettings(next);
  }, []);

  const cancelPaperWait = useCallback(
    (message = "Очередь листов остановлена.") => {
      const waiter = paperWaiterRef.current;
      paperWaiterRef.current = null;
      setPaperChange(null);
      waiter?.reject(new DOMException(message, "AbortError"));
    },
    [],
  );

  const continuePaper = useCallback(() => {
    if (!writerRef.current || abortRef.current || desynchronizedRef.current)
      return;
    const waiter = paperWaiterRef.current;
    if (!waiter) return;
    paperWaiterRef.current = null;
    setPaperChange(null);
    setStatus("running");
    waiter.resolve();
  }, []);

  const saveRecovery = useCallback((value) => {
    if (!value) {
      removeStoredValue(RECOVERY_KEY);
      setRecovery(null);
      return;
    }
    const next = { ...value, updatedAt: Date.now() };
    try {
      saveStoredValues({ [RECOVERY_KEY]: JSON.stringify(next) });
    } catch {
      /* storage may be full */
    }
    setRecovery(next);
  }, []);

  const log = useCallback((direction, message) => {
    const time = new Date().toLocaleTimeString("ru-RU", { hour12: false });
    setLogs((current) => [
      ...current.slice(-149),
      { time, direction, message },
    ]);
  }, []);

  const settlePending = useCallback((line, error = false) => {
    const pending = pendingRef.current.shift();
    if (!pending) return;
    clearTimeout(pending.timeout);
    if (error) pending.reject(new Error(line));
    else {
      rememberSetting(pending.command);
      pending.resolve(line);
    }
  }, [rememberSetting]);

  const readLoop = useCallback(
    async (reader) => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 65536)
            throw new Error("Ответ контроллера превышает допустимый размер.");
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) continue;
            if (line.startsWith("<")) {
              const report = parseGrblStatus(line, undefined, controllerSettingsRef.current[13] === 1);
              const wasAlarm = statusReportRef.current.state === "Alarm";
              if (report) statusReportRef.current = {
                sequence: statusReportRef.current.sequence + 1,
                state: report.state,
              };
              if (report?.state === "Alarm" && !wasAlarm) {
                abortRef.current = true;
                setControllerEpoch((epoch) => epoch + 1);
                log("error", "GRBL сообщает Alarm. Устраните причину аварии, затем снимите блокировку. Движения остановлены.");
                cancelPaperWait("Авария контроллера.");
                pausedRef.current = false;
                pauseWaitersRef.current.splice(0).forEach((resume) => resume());
                const interrupted = pendingRef.current.filter((pending) => !/^\$(?:X|I|G|#|\$)$/i.test(pending.command));
                pendingRef.current = pendingRef.current.filter((pending) => !interrupted.includes(pending));
                for (const pending of interrupted) {
                  clearTimeout(pending.timeout);
                  pending.reject(new Error("Авария контроллера."));
                }
              }
              setMachineStatus(
                (previous) => parseGrblStatus(line, previous, controllerSettingsRef.current[13] === 1) || previous,
              );
              continue;
            }
            log("in", line);
            if (profileRef.current === "grbl") rememberSetting(line);
            if (/^(ALARM|Grbl\s)/i.test(line)) {
              setControllerEpoch((epoch) => epoch + 1);
              setMachineStatus(null);
              if (/^ALARM/i.test(line)) statusReportRef.current = {
                sequence: statusReportRef.current.sequence + 1, state: "Alarm",
              };
            }
            if (/^(ALARM|Grbl\s)/i.test(line) && operationRef.current) {
              cancelPaperWait("Контроллер сброшен или сообщил об аварии.");
              abortRef.current = true;
              if (/^Grbl\s/i.test(line)) desynchronizedRef.current = true;
              pausedRef.current = false;
              pauseWaitersRef.current.splice(0).forEach((resume) => resume());
              for (const pending of pendingRef.current.splice(0)) {
                clearTimeout(pending.timeout);
                pending.reject(
                  new Error(`Контроллер прервал выполнение: ${line}`),
                );
              }
            }
            if (/^Grbl\s/i.test(line)) {
              controllerSettingsRef.current = {};
              setControllerSettings({});
              // The startup banner is a stream boundary: reset discarded the
              // old command queue. Reject its waiters BEFORE accepting new
              // commands. Keep the operation aborted and physical zeros lost;
              // Alarm still requires the user's explicit $X, never auto-resume.
              for (const pending of pendingRef.current.splice(0)) {
                clearTimeout(pending.timeout);
                pending.reject(new Error("Контроллер перезапущен. Предыдущая команда отменена."));
              }
              desynchronizedRef.current = false;
            }
            if (/^(ok|OK)\b/.test(line)) settlePending(line);
            else if (/^(error|ALARM)/i.test(line)) settlePending(line, true);
          }
        }
      } catch (error) {
        if (readerRef.current === reader) log("error", error.message);
      } finally {
        if (readerRef.current === reader) {
          cancelPaperWait("Соединение с плоттером потеряно.");
          abortRef.current = true;
          pausedRef.current = false;
          pauseWaitersRef.current.splice(0).forEach((resume) => resume());
          for (const pending of pendingRef.current.splice(0)) {
            clearTimeout(pending.timeout);
            pending.reject(
              new Error("Поток устройства закрыт. Переподключите плоттер."),
            );
          }
          setStatus("disconnected");
          setMachineStatus(null);
          try {
            writerRef.current?.releaseLock();
          } catch {
            /* already closed */
          }
          writerRef.current = null;
          readerRef.current = null;
        }
        try {
          reader.releaseLock();
        } catch {
          /* already released */
        }
        if (!readerRef.current) {
          const closedPort = portRef.current;
          portRef.current = null;
          try {
            await closedPort?.close();
          } catch {
            /* already closed */
          }
        }
      }
    },
    [cancelPaperWait, log, settlePending, rememberSetting, status],
  );

  const writeRaw = useCallback(
    async (value, visible = true) => {
      if (!writerRef.current) throw new Error("Плоттер не подключён.");
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      await writerRef.current.write(bytes);
      if (visible)
        log(
          "out",
          typeof value === "string"
            ? value.trim()
            : `[${Array.from(bytes).join(", ")}]`,
        );
    },
    [log],
  );

  const sendCommand = useCallback(
    async (command, timeoutMs = commandTimeoutRef.current) => {
      if (!writerRef.current) throw new Error("Плоттер не подключён.");
      if (emergencyStopRef.current) throw new Error("СТОП: управление заблокировано.");
      if (desynchronizedRef.current)
        throw new Error(
          "Потеряна синхронизация ответов. Переподключите плоттер.",
        );
      if (profileRef.current === "grbl" && statusReportRef.current.state === "Alarm"
          && !/^\$(?:X|I|G|#|\$)$/i.test(command))
        throw new Error("GRBL в состоянии Alarm. Устраните причину и нажмите «Снять Alarm» в состоянии плоттера. Затем проверьте ноль.");
      let pending = null;
      const acknowledgement = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          const index = pendingRef.current.findIndex(
            (item) => item.timeout === timeout,
          );
          if (index >= 0) pendingRef.current.splice(index, 1);
          desynchronizedRef.current = true;
          setControllerEpoch((epoch) => epoch + 1);
          abortRef.current = true;
          if (profileRef.current === "grbl")
            void writeRaw(new Uint8Array([33])).catch(() => {});
          reject(new Error(`Плоттер не ответил на команду: ${command}`));
        }, timeoutMs);
        pending = { resolve, reject, timeout, command };
        pendingRef.current.push(pending);
      });
      void acknowledgement.catch(() => {});
      try {
        await writeRaw(`${command}${lineEnding(profileRef.current)}`);
      } catch (error) {
        const index = pendingRef.current.indexOf(pending);
        if (index >= 0) pendingRef.current.splice(index, 1);
        clearTimeout(pending.timeout);
        pending.reject(error);
        // The acknowledgement promise is deliberately handled here: the write
        // failure is the error the caller needs, not a delayed timeout.
        await acknowledgement.catch(() => {});
        throw error;
      }
      return acknowledgement;
    },
    [writeRaw],
  );

  const connect = useCallback(
    async (profile, incomingOptions) => {
      if (writerRef.current || operationRef.current || connectingRef.current)
        throw new Error("Сначала закройте текущее соединение.");
      if (!supported)
        throw new Error(
          "Web Serial недоступен. Используйте Chrome или Edge по HTTPS/localhost.",
        );
      const options =
        typeof incomingOptions === "object" && incomingOptions
          ? incomingOptions
          : { baudRate: incomingOptions };
      const serialOptions = {
        baudRate: Number(options.baudRate),
        dataBits: Number(options.dataBits) === 7 ? 7 : 8,
        stopBits: Number(options.stopBits) === 2 ? 2 : 1,
        parity: ["even", "odd"].includes(options.parity)
          ? options.parity
          : "none",
        flowControl: options.flowControl === "hardware" ? "hardware" : "none",
      };
      const connectionType =
        options.connectionType === "network" ? "network" : "serial";
      const networkHost = String(options.networkHost || "").trim();
      const networkPort = Number(options.networkPort);
      if (connectionType === "network") {
        if (!networkSupported)
          throw new Error(
            "Прямое TCP-подключение доступно в приложениях OpenHand для macOS и Windows.",
          );
        if (
          !networkHost ||
          networkHost.length > 253 ||
          /[\s/\\]/.test(networkHost) ||
          !Number.isInteger(networkPort) ||
          networkPort < 1 ||
          networkPort > 65535
        )
          throw new Error("Введите корректный IP/хост и TCP-порт плоттера.");
      }
      commandTimeoutRef.current = Math.max(
        1000,
        Math.min(60000, Number(options.connectionTimeoutMs) || 12000),
      );
      setStatus("connecting");
      connectingRef.current = true;
      profileRef.current = profile;
      desynchronizedRef.current = false;
      setMachineStatus(null);
      statusReportRef.current = { sequence: 0, state: "" };
      controllerSettingsRef.current = {};
      setControllerSettings({});
      try {
        const port = await navigator.serial.requestPort(
          connectionType === "network"
            ? { openhandNetwork: { host: networkHost, port: networkPort } }
            : undefined,
        );
        portRef.current = port;
        await port.open(serialOptions);
        try {
          await port.setSignals({
            dataTerminalReady: true,
            requestToSend: true,
          });
        } catch {
          /* optional */
        }
        portRef.current = port;
        writerRef.current = port.writable.getWriter();
        readerRef.current = port.readable.getReader();
        void readLoop(readerRef.current);
        log(
          "system",
          connectionType === "network"
            ? `${profile.toUpperCase()} · TCP ${networkHost}:${networkPort}`
            : `${profile.toUpperCase()} · ${serialOptions.baudRate} бод · ${serialOptions.dataBits}${serialOptions.parity === "none" ? "N" : serialOptions.parity === "even" ? "E" : "O"}${serialOptions.stopBits}`,
        );
        // Opening USB serial/DTR can reboot the controller. Do not expose
        // controls or leave an untracked M115 acknowledgement in the stream.
        // Identification must not soft-reset GRBL: reset discards G92 and the
        // planner state even when the user only reconnects to an idle machine.
        if (profile !== "ebb") {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          await sendCommand(profile === "marlin" ? "M115" : "$I");
        }
        if (!writerRef.current) throw new Error("Соединение с плоттером потеряно.");
        if (profile === "grbl") {
          await sendCommand("$$");

        }
        setStatus("connected");
      } catch (error) {
        try {
          await readerRef.current?.cancel();
        } catch {
          /* incomplete connection */
        }
        try {
          writerRef.current?.releaseLock();
        } catch {
          /* incomplete connection */
        }
        readerRef.current = null;
        writerRef.current = null;
        try {
          await portRef.current?.close();
        } catch {
          /* incomplete connection */
        }
        portRef.current = null;
        setStatus("disconnected");
        throw error;
      } finally {
        connectingRef.current = false;
      }
    },
    [log, networkSupported, readLoop, sendCommand, supported, writeRaw],
  );

  const realtime = useCallback(
    async (action: keyof typeof GRBL_REALTIME) => {
      if (profileRef.current !== "grbl")
        throw new Error("Realtime-команды доступны для GRBL.");
      const byte = GRBL_REALTIME[action];
      if (byte === undefined) throw new Error("Неизвестная realtime-команда.");
      await writeRaw(new Uint8Array([byte]), action !== "status");
    },
    [writeRaw],
  );

  useEffect(() => {
    if (
      status === "disconnected" ||
      status === "connecting" ||
      profileRef.current !== "grbl"
    )
      return;
    let pending = false;
    const poll = async () => {
      if (pending) return;
      pending = true;
      try {
        await realtime("status");
      } catch {
        /* read loop reports disconnect */
      } finally {
        pending = false;
      }
    };
    void poll();
    const timer = setInterval(poll, 500);
    return () => clearInterval(timer);
  }, [realtime, status]);

  const disconnect = useCallback(async () => {
    cancelPaperWait();
    abortRef.current = true;
    pausedRef.current = false;
    pauseWaitersRef.current.splice(0).forEach((resume) => resume());
    for (const pending of pendingRef.current.splice(0)) {
      clearTimeout(pending.timeout);
      pending.reject(new Error("Соединение закрыто."));
    }
    try {
      await readerRef.current?.cancel();
    } catch {
      /* already closed */
    }
    try {
      writerRef.current?.releaseLock();
    } catch {
      /* already released */
    }
    readerRef.current = null;
    writerRef.current = null;
    try {
      await portRef.current?.close();
    } catch {
      /* already closed */
    }
    portRef.current = null;
    setStatus("disconnected");
    setMachineStatus(null);
    log("system", "Соединение закрыто");
  }, [cancelPaperWait, log]);

  useEffect(() => {
    if (!supported || typeof navigator.serial.addEventListener !== "function")
      return undefined;
    const handleDeviceDisconnect = () => {
      cancelPaperWait("Устройство отключено.");
      abortRef.current = true;
      pausedRef.current = false;
      pauseWaitersRef.current.splice(0).forEach((resume) => resume());
      for (const pending of pendingRef.current.splice(0)) {
        clearTimeout(pending.timeout);
        pending.reject(new Error("Устройство отключено."));
      }
      try {
        void readerRef.current?.cancel();
      } catch {
        /* already closed */
      }
      try {
        writerRef.current?.releaseLock();
      } catch {
        /* already released */
      }
      readerRef.current = null;
      writerRef.current = null;
      portRef.current = null;
      setStatus("disconnected");
      setMachineStatus(null);
      log("error", "Устройство отключено");
    };
    navigator.serial.addEventListener("disconnect", handleDeviceDisconnect);
    return () =>
      navigator.serial.removeEventListener(
        "disconnect",
        handleDeviceDisconnect,
      );
  }, [cancelPaperWait, log, supported]);

  const waitWhilePaused = useCallback(() => {
    if (!pausedRef.current) return Promise.resolve();
    return new Promise((resolve) => pauseWaitersRef.current.push(resolve));
  }, []);

  const run = useCallback(
    async (
      jobOrCommands,
      options: { startIndex?: number; prefix?: string[] } = {},
    ) => {
      if (emergencyStopRef.current) throw new Error("СТОП: управление заблокировано.");
      if (operationRef.current)
        throw new Error("Дождитесь завершения текущей операции.");
      if (!writerRef.current) throw new Error("Плоттер не подключён.");
      operationRef.current = true;
      const job = Array.isArray(jobOrCommands)
        ? {
            id: `legacy-${jobOrCommands.length}`,
            commands: jobOrCommands,
            resumePoints: [],
            resumePrefix: [],
            recoverable: false,
          }
        : jobOrCommands;
      const commands = job?.commands || [];
      const paperChanges = new Map<number, PaperChange>(
        (job.paperChanges || []).map((item) => [item.after, item.change]),
      );
      const barriers = new Set<number>(job.barriers || []);
      const recoverable = job?.recoverable !== false;
      const startIndex = Math.max(
        0,
        Math.min(commands.length, Number(options.startIndex) || 0),
      );
      const checkpoints = new Set(job?.resumePoints || []);
      let safeCheckpoint = startIndex;
      abortRef.current = false;
      pausedRef.current = false;
      setStatus("running");
      setPrintingSheet(null);
      setSheetProgress(null);
      setProgress({ current: startIndex, total: commands.length });
      if (recoverable) {
        saveRecovery({
          jobId: job.id,
          current: safeCheckpoint,
          total: commands.length,
          profile: profileRef.current,
        });
      } else saveRecovery(null);
      try {
        let sheetRangeIndex = 0;
        for (const command of options.prefix || []) await sendCommand(command);
        for (let index = startIndex; index < commands.length; index += 1) {
          const ranges = job.sheetRanges || [];
          while (
            ranges[sheetRangeIndex] &&
            index >= ranges[sheetRangeIndex].end
          )
            sheetRangeIndex++;
          const range = ranges[sheetRangeIndex];
          if (range) {
            setPrintingSheet(range.sheet);
            setSheetProgress({
              current: index - range.start,
              total: range.end - range.start,
            });
          }
          if (abortRef.current)
            throw new DOMException("Задание остановлено.", "AbortError");
          await waitWhilePaused();
          if (abortRef.current)
            throw new DOMException("Задание остановлено.", "AbortError");
          await sendCommand(
            commands[index],
            barriers.has(index + 1) ? 60000 : commandTimeoutRef.current,
          );
          setProgress({ current: index + 1, total: commands.length });
          if (range)
            setSheetProgress({
              current: index + 1 - range.start,
              total: range.end - range.start,
            });
          if (recoverable && checkpoints.has(index + 1)) {
            safeCheckpoint = index + 1;
            saveRecovery({
              jobId: job.id,
              current: safeCheckpoint,
              total: commands.length,
              profile: profileRef.current,
            });
          }
          const change = paperChanges.get(index + 1);
          if (change) {
            await waitWhilePaused();
            if (abortRef.current)
              throw new DOMException("Очередь остановлена.", "AbortError");
            // The boundary command is a planner barrier after lifting the pen.
            // Keep exclusive ownership of the stream throughout the paper swap.
            const waiting = new Promise<void>((resolve, reject) => {
              paperWaiterRef.current = { resolve, reject };
            });
            setPaperChange(change);
            setStatus("waiting-paper");
            log(
              "system",
              `Завершено: ${change.completedLabel.toLowerCase()}. Переверните бумагу: далее ${change.nextLabel.toLowerCase()}.`,
            );
            void notifyPlotter(
              "Переверните страницу",
              `Завершено: ${change.completedLabel.toLowerCase()}. Подготовьте ${change.nextLabel.toLowerCase()} и нажмите «Продолжить» в OpenHand.`,
            ).catch(() => {});
            await waiting;
            if (abortRef.current)
              throw new DOMException("Очередь остановлена.", "AbortError");
          }
        }
        // An ok acknowledges parsing, not completed motion. Drain the planner
        // before exposing the next operation or declaring the job complete.
        if (profileRef.current === "grbl") await sendCommand("G4P0.01", 60000);
        else if (profileRef.current === "marlin")
          await sendCommand("M400", 60000);
        if (abortRef.current)
          throw new DOMException("Задание остановлено.", "AbortError");
        setStatus("connected");
        log("system", "Задание завершено");
        saveRecovery(null);
        if (job.totalSheets)
          void notifyPlotter(
            "Конспект готов",
            `Все выбранные листы (${job.totalSheets}) завершены. Перо поднято.`,
          ).catch(() => {});
      } catch (error) {
        setStatus(writerRef.current ? "connected" : "disconnected");
        if (error.name !== "AbortError") {
          if (profileRef.current === "grbl" && writerRef.current)
            await writeRaw(new Uint8Array([33])).catch(() => {});
          log("error", error.message);
          throw error;
        }
      } finally {
        cancelPaperWait();
        setPrintingSheet(null);
        setSheetProgress(null);
        operationRef.current = false;
      }
    },
    [
      cancelPaperWait,
      log,
      saveRecovery,
      sendCommand,
      waitWhilePaused,
      writeRaw,
    ],
  );

  const recover = useCallback(
    async (job) => {
      assertRecoveryCompatible(recovery, job, profileRef.current);
      if (!recovery) return;
      log(
        "system",
        `Продолжение с безопасного штриха: ${recovery.current} / ${recovery.total}`,
      );
      return run(job, {
        startIndex: recovery.current,
        prefix: job.resumePrefix || [],
      });
    },
    [log, recovery, run],
  );

  const pause = useCallback(async () => {
    if (status !== "running") return;
    pausedRef.current = true;
    setStatus("paused");
    if (profileRef.current === "grbl") await writeRaw(new Uint8Array([33]));
  }, [status, writeRaw]);

  const resume = useCallback(async () => {
    if (emergencyStopRef.current || status !== "paused") return;
    if (profileRef.current === "grbl") await writeRaw(new Uint8Array([126]));
    pausedRef.current = false;
    setStatus("running");
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve());
  }, [status, writeRaw]);

  const stop = useCallback(async () => {
    emergencyStopRef.current = true;
    setEmergencyStopped(true);
    cancelPaperWait();
    abortRef.current = true;
    pausedRef.current = false;
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve());
    for (const pending of pendingRef.current.splice(0)) {
      clearTimeout(pending.timeout);
      pending.reject(new DOMException("Задание остановлено.", "AbortError"));
    }
    saveRecovery(null);
    desynchronizedRef.current = true;
    setControllerEpoch((epoch) => epoch + 1);
    setMachineStatus(null);
    if (!writerRef.current) throw new Error("Нет связи с плоттером. Отключите его питание и USB.");
    // Realtime bytes bypass acknowledgement waits and the G-code queue.
    // Cancel jogging as well as buffered program moves, then reset GRBL.
    if (profileRef.current === "grbl") await writeRaw(new Uint8Array([0x85, 0x21, 0x18]));
    else if (profileRef.current === "marlin") await writeRaw("M410\n");
    else await writeRaw("R\r\n");
    setStatus("connected");
    log(
      "system",
      "Отправлена аварийная остановка. После ответа о перезапуске снимите Alarm в состоянии плоттера. Задание не возобновится автоматически; физический ноль нужно проверить.",
    );
  }, [cancelPaperWait, log, saveRecovery, writeRaw]);

  const sendCommands = useCallback(
    async (commands, options: { waitForMotion?: boolean } = {}) => {
      if (emergencyStopRef.current) throw new Error("СТОП: управление заблокировано.");
      if (operationRef.current)
        throw new Error("Дождитесь завершения текущей операции.");
      operationRef.current = true;
      abortRef.current = false;
      try {
        for (const command of commands) {
          if (abortRef.current) throw new Error("Операция прервана.");
          await sendCommand(command);
        }
        if (options.waitForMotion && profileRef.current === "grbl") {
          // Jog's ok means queued. Wait for a NEW Idle report; the previous
          // cached Idle can predate the movement. G-code barriers cannot be
          // sent while GRBL is in Jog state.
          const deadline = Date.now() + 120000;
          const sequence = statusReportRef.current.sequence;
          await writeRaw("?", false);
          while (true) {
            if (abortRef.current || !writerRef.current)
              throw new Error("Операция прервана.");
            const report = statusReportRef.current;
            if (report.sequence > sequence && report.state === "Idle") break;
            if (Date.now() >= deadline) {
              desynchronizedRef.current = true;
              setControllerEpoch((epoch) => epoch + 1);
              await writeRaw(new Uint8Array([33]));
              throw new Error("Движение не завершено. Переподключите плоттер и проверьте ноль перед повтором.");
            }
            await new Promise((resolve) => setTimeout(resolve, 100));
            // Keep the initial sequence so fast replies are not skipped.
            await writeRaw("?", false);
          }
        } else if (options.waitForMotion && profileRef.current === "marlin") {
          await sendCommand("M400", 120000);
        }
      } finally {
        operationRef.current = false;
      }
    },
    [sendCommand, writeRaw],
  );

  const resetProgress = useCallback(() => {
    if (operationRef.current || connectingRef.current)
      throw new Error("Сначала остановите текущее задание и дождитесь завершения операции.");
    setProgress({ current: 0, total: 0 });
    setPrintingSheet(null);
    setSheetProgress(null);
    setPaperChange(null);
    saveRecovery(null);
  }, [saveRecovery]);

  useEffect(
    () => () => {
      cancelPaperWait();
      abortRef.current = true;
      try {
        readerRef.current?.cancel();
      } catch {
        /* unmount */
      }
      try {
        writerRef.current?.releaseLock();
      } catch {
        /* unmount */
      }
      try {
        portRef.current?.close();
      } catch {
        /* unmount */
      }
    },
    [],
  );

  return {
    supported,
    networkSupported,
    status,
    logs,
    progress,
    paperChange,
    printingSheet,
    sheetProgress,
    continuePaper,
    machineStatus,
    controllerEpoch,
    controllerSettings,
    realtime,
    recovery,
    connect,
    disconnect,
    run,
    recover,
    pause,
    resume,
    stop,
    emergencyStopped,
    releaseEmergencyStop: () => {
      if (operationRef.current || connectingRef.current) throw new Error("Дождитесь завершения отмены операции.");
      emergencyStopRef.current = false;
      setEmergencyStopped(false);
      // No writes, no resumption and no automatic reference restoration.
    },
    sendCommands,
    resetProgress,
    clearLogs: () => setLogs([]),
    discardRecovery: () => saveRecovery(null),
  };
}
