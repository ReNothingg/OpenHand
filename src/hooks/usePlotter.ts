import { useCallback, useEffect, useRef, useState } from "react";
import { acknowledgementTimeout, controllerStillBusy } from "../plotter/acknowledgement";
import { GRBL_SETTINGS_REQUIRED } from "../plotter/controllerFingerprint";
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
  const machineReportRef = useRef<GrblStatus | null>(null);
  const clearMachineStatus = useCallback(() => {
    machineReportRef.current = null;
    setMachineStatus(null);
  }, []);
  const [controllerEpoch, setControllerEpoch] = useState(0);
  const operationRef = useRef(false);
  const jobActiveRef = useRef(false);
  const [operationBusy, setOperationBusy] = useState(false);
  const connectingRef = useRef(false);
  const connectionEpochRef = useRef(0);
  const cancelConnectRef = useRef(false);
  const desynchronizedRef = useRef(false);
  const [recovery, setRecovery] = useState(loadRecovery);
  const [recoveryWarning, setRecoveryWarning] = useState("");
  const portRef = useRef(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const profileRef = useRef("grbl");
  const pendingRef = useRef([]);
  const abortRef = useRef(false);
  const interruptionRef = useRef<Error | null>(null);
  const emergencyStopRef = useRef(false);
  const emergencyGenerationRef = useRef(0);
  const stopInFlightRef = useRef<Promise<{ delivered: boolean; controllerState: string | null }> | null>(null);
  const [emergencyStopped, setEmergencyStopped] = useState(false);
  const pausedRef = useRef(false);
  const pauseWaitersRef = useRef([]);
  const commandTimeoutRef = useRef(12000);
  const statusReportRef = useRef({ sequence: 0, state: "" });
  const settingsSeenRef = useRef<Set<number> | null>(null);
  const controllerSettingsRef = useRef<Record<number, number>>({});
  const [controllerSettingsComplete, setControllerSettingsComplete] = useState(false);
  const [controllerSettings, setControllerSettings] = useState<Record<number, number>>({});

  const rememberSetting = useCallback((line: string) => {
    const match = /^\$(\d+)=(-?\d+(?:\.\d+)?)$/.exec(line.trim());
    if (!match) return;
    settingsSeenRef.current?.add(Number(match[1]));
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
      const removed = removeStoredValue(RECOVERY_KEY);
      setRecoveryWarning(removed ? "" : "Не удалось очистить сохранённый прогресс. После перезапуска может появиться старая точка продолжения.");
      setRecovery(null);
      return;
    }
    const next = { ...value, updatedAt: Date.now() };
    try {
      const saved = saveStoredValues({ [RECOVERY_KEY]: JSON.stringify(next) });
      setRecoveryWarning(saved ? "" : "Не удалось сохранить новую точку продолжения. Не закрывайте приложение, если нужно продолжить это задание.");
    } catch {
      setRecoveryWarning("Не удалось сохранить новую точку продолжения. Не закрывайте приложение, если нужно продолжить это задание.");
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
    if (error) {
      if (pending.command === "$$") { settingsSeenRef.current = null; setControllerSettingsComplete(false); }
      pending.reject(new Error(line));
    } else {
      rememberSetting(pending.command);
      if (pending.command === "$$") {
        const complete = GRBL_SETTINGS_REQUIRED.every(key => settingsSeenRef.current?.has(key) && Number.isFinite(controllerSettingsRef.current[key]));
        settingsSeenRef.current = null;
        setControllerSettingsComplete(complete);
        if (!complete) { pending.reject(new Error("Контроллер не вернул полный набор параметров GRBL. Проверьте выбранную прошивку и соединение.")); return; }
      }
      pending.resolve(line);
    }
  }, [rememberSetting]);

  const readLoop = useCallback(
    async (reader, connectionEpoch: number) => {
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (connectionEpochRef.current !== connectionEpoch || readerRef.current !== reader) break;
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          if (buffer.length > 65536)
            throw new Error("Ответ контроллера превышает допустимый размер.");
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop() || "";
          for (const rawLine of lines) {
            if (connectionEpochRef.current !== connectionEpoch || readerRef.current !== reader) break;
            const line = rawLine.trim();
            if (!line) continue;
            if (line.startsWith("<")) {
              const report = parseGrblStatus(line, machineReportRef.current, (controllerSettingsRef.current[13] === 0 || controllerSettingsRef.current[13] === 1) ? controllerSettingsRef.current[13] === 1 : null);
              const previousControllerState = statusReportRef.current.state;
              const wasAlarm = previousControllerState === "Alarm";
              if (report) statusReportRef.current = {
                sequence: statusReportRef.current.sequence + 1,
                state: report.state,
              };
              if (report && jobActiveRef.current && !abortRef.current && !emergencyStopRef.current) {
                if (/^Hold(?::\d+)?$/.test(report.state)) {
                  pausedRef.current = true;
                  setStatus("paused");
                } else if (/^Hold(?::\d+)?$/.test(previousControllerState) && report.state === "Run" && pausedRef.current) {
                  pausedRef.current = false;
                  setStatus("running");
                  pauseWaitersRef.current.splice(0).forEach(resume => resume());
                }
              }
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
              if (report) {
                machineReportRef.current = report;
                setMachineStatus(report);
              }
              continue;
            }
            log("in", line);
            if (profileRef.current === "grbl") rememberSetting(line);
            if (/^(ALARM|Grbl\s)/i.test(line)) {
              setControllerEpoch((epoch) => epoch + 1);
              clearMachineStatus();
              if (/^ALARM/i.test(line)) statusReportRef.current = {
                sequence: statusReportRef.current.sequence + 1, state: "Alarm",
              };
            }
            if (/^(ALARM|Grbl\s)/i.test(line) && operationRef.current) {
              if (!emergencyStopRef.current) interruptionRef.current = new Error(`Контроллер прервал выполнение: ${line}`);
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
              settingsSeenRef.current = null;
              setControllerSettings({});
      setControllerSettingsComplete(false);
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
        if (connectionEpochRef.current === connectionEpoch && readerRef.current === reader) {
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
          clearMachineStatus();
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
        if (connectionEpochRef.current === connectionEpoch && !readerRef.current) {
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
    [cancelPaperWait, log, settlePending, rememberSetting],
  );

  const writeRaw = useCallback(
    async (value, visible = true) => {
      if (!writerRef.current) throw new Error("Плоттер не подключён.");
      const bytes = typeof value === "string" ? encoder.encode(value) : value;
      let timer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([
          writerRef.current.write(bytes),
          new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Запись в порт не завершилась. Соединение требует восстановления.")), commandTimeoutRef.current); }),
        ]);
      } finally { clearTimeout(timer!); }
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
      if (typeof command !== "string" || !command.trim() || /[^\x09\x20-\x7e]/.test(command))
        throw new Error("Команда должна быть одной строкой G-code без управляющих или не-ASCII символов.");
      if (!writerRef.current) throw new Error("Плоттер не подключён.");
      if (emergencyStopRef.current) throw new Error("СТОП: управление заблокировано.");
      if (desynchronizedRef.current)
        throw new Error(
          "Потеряна синхронизация ответов. Переподключите плоттер.",
        );
      if (profileRef.current === "grbl" && statusReportRef.current.state === "Alarm"
          && !/^\$(?:X|I|G|#|\$)$/i.test(command))
        throw new Error("GRBL в состоянии Alarm. Устраните причину и нажмите «Снять Alarm» в состоянии плоттера. Затем проверьте ноль.");
      const connectionEpoch = connectionEpochRef.current;
      if (command === "$$") settingsSeenRef.current = new Set();
      let pending = null;
      const effectiveTimeout = acknowledgementTimeout(command, profileRef.current, timeoutMs);
      const acknowledgement = new Promise((resolve, reject) => {
        let expiresAt = Date.now() + effectiveTimeout;
        const checkTimeout = () => {
          if (!pendingRef.current.includes(pending)) return;
          if (connectionEpochRef.current !== connectionEpoch) {
            reject(new Error("Предыдущее соединение закрыто."));
            return;
          }
          const now = Date.now();
          const liveBusy = profileRef.current === "grbl" && controllerStillBusy(machineReportRef.current, now);
          if (!abortRef.current && (pausedRef.current || liveBusy)) expiresAt = now + effectiveTimeout;
          if (now < expiresAt) {
            pending.timeout = setTimeout(checkTimeout, Math.min(1000, expiresAt - now));
            return;
          }
          const index = pendingRef.current.indexOf(pending);
          if (index >= 0) pendingRef.current.splice(index, 1);
          if (command === "$$") { settingsSeenRef.current = null; setControllerSettingsComplete(false); }
          desynchronizedRef.current = true;
          setControllerEpoch(epoch => epoch + 1);
          abortRef.current = true;
          if (profileRef.current === "grbl") void writeRaw(new Uint8Array([33])).catch(() => {});
          reject(new Error(`Плоттер не ответил на команду: ${command}`));
        };
        pending = { resolve, reject, timeout: setTimeout(checkTimeout, effectiveTimeout), command,
          renewDeadline: () => { expiresAt = Date.now() + effectiveTimeout; } };
        pendingRef.current.push(pending);
      });
      void acknowledgement.catch(() => {});
      try {
        await writeRaw(`${command}${lineEnding(profileRef.current)}`);
      } catch (error) {
        // A write may have delivered only a prefix. Do not append another
        // G-code line to an uncertain controller buffer, or poison a new session.
        if (connectionEpochRef.current === connectionEpoch) {
          desynchronizedRef.current = true;
          abortRef.current = true;
          setControllerEpoch(epoch => epoch + 1);
          if (profileRef.current === "grbl" && !emergencyStopRef.current)
            void writeRaw(new Uint8Array([0x21])).catch(() => {});
        }
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
      if (stopInFlightRef.current || emergencyStopRef.current)
        throw new Error("Сначала дождитесь завершения СТОП и разрешите управление.");
      if (writerRef.current || operationRef.current || connectingRef.current)
        throw new Error("Сначала закройте текущее соединение.");
      if (typeof window !== "undefined" && window.__openhandNativePlatform && (window.__openhandBridgeVersion ?? 0) < 4)
        throw new Error("Открыта старая версия OpenHand. Полностью закройте приложение и запустите новую сборку.");
      if (!supported)
        throw new Error(
          "Web Serial недоступен. Используйте Chrome или Edge по HTTPS/localhost.",
        );
      const options =
        typeof incomingOptions === "object" && incomingOptions
          ? incomingOptions
          : { baudRate: incomingOptions };
      const serialOptions = {
        profile,
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
      cancelConnectRef.current = false;
      const connectionEpoch = ++connectionEpochRef.current;
      const checkOpening = () => {
        if (cancelConnectRef.current || connectionEpochRef.current !== connectionEpoch)
          throw new DOMException("Подключение отменено.", "AbortError");
      };
      profileRef.current = profile;
      desynchronizedRef.current = false;
      clearMachineStatus();
      statusReportRef.current = { sequence: 0, state: "" };
      controllerSettingsRef.current = {};
      setControllerSettings({});
      setControllerSettingsComplete(false);
      try {
        const port = await navigator.serial.requestPort(
          connectionType === "network"
            ? { openhandNetwork: { host: networkHost, port: networkPort } }
            : undefined,
        );
        checkOpening();
        portRef.current = port;
        await port.open(serialOptions);
        checkOpening();
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
        checkOpening();
        void readLoop(readerRef.current, connectionEpoch);
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
          checkOpening();
          await sendCommand(profile === "marlin" ? "M115" : "$I");
        }
        if (!writerRef.current) throw new Error("Соединение с плоттером потеряно.");
        if (profile === "grbl") await sendCommand("$$");
        checkOpening();
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
    cancelConnectRef.current = true;
    ++connectionEpochRef.current;
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
    clearMachineStatus();
    log("system", "Соединение закрыто");
  }, [cancelPaperWait, log]);

  useEffect(() => {
    if (!supported || typeof navigator.serial.addEventListener !== "function")
      return undefined;
    const handleDeviceDisconnect = () => {
      cancelConnectRef.current = true;
      ++connectionEpochRef.current;
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
      clearMachineStatus();
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
      const requestedStart = options.startIndex ?? 0;
      if (!Number.isInteger(requestedStart) || requestedStart < 0 ||
          (requestedStart > 0 && (Array.isArray(jobOrCommands) || !jobOrCommands?.resumePoints?.includes(requestedStart))))
        throw new Error("Начать можно только с подтверждённой границы штриха.");
      if (requestedStart > 0) {
        assertRecoveryCompatible(recovery, jobOrCommands, profileRef.current);
        if (recovery?.current !== requestedStart) throw new Error("Эта точка продолжения не подтверждена контроллером.");
      }
      operationRef.current = true;
      jobActiveRef.current = true;
      setOperationBusy(true);
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
      interruptionRef.current = null;
      pausedRef.current = false;
      setStatus("running");
      setPrintingSheet(null);
      setSheetProgress(null);
      setProgress({ current: startIndex, total: commands.length });
      if (recoverable) {
        saveRecovery({
          checkpointVersion: 2,
          jobId: job.id,
          current: safeCheckpoint,
          total: commands.length,
          profile: profileRef.current,
        });
      } else saveRecovery(null);
      try {
        let sheetRangeIndex = 0;
        for (const command of options.prefix || []) {
          if (abortRef.current) throw interruptionRef.current || new DOMException("Задание остановлено.", "AbortError");
          await sendCommand(command);
          if (abortRef.current) throw interruptionRef.current || new DOMException("Задание остановлено.", "AbortError");
        }
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
            throw interruptionRef.current || new DOMException("Задание остановлено.", "AbortError");
          await waitWhilePaused();
          if (abortRef.current)
            throw interruptionRef.current || new DOMException("Задание остановлено.", "AbortError");
          await sendCommand(
            commands[index],
            barriers.has(index + 1) ? 60000 : commandTimeoutRef.current,
          );
          if (abortRef.current) throw interruptionRef.current || new DOMException("Задание остановлено.", "AbortError");
          setProgress({ current: index + 1, total: commands.length });
          if (range)
            setSheetProgress({
              current: index + 1 - range.start,
              total: range.end - range.start,
            });
          if (recoverable && checkpoints.has(index + 1)) {
            // An accepted pen-up may still be queued. Persist only after the
            // controller has drained the preceding motion, never just after ok.
            const barrier = profileRef.current === "grbl" ? "G4P0.01" : "M400";
            const alreadyBarrier = profileRef.current === "grbl"
              ? /^G0?4P/i.test(commands[index].replace(/\s/g, ""))
              : /^M400$/i.test(commands[index].trim());
            if (!alreadyBarrier) await sendCommand(barrier, 60000);
            if (abortRef.current) throw interruptionRef.current || new DOMException("Задание остановлено.", "AbortError");
            safeCheckpoint = index + 1;
            saveRecovery({
              checkpointVersion: 2,
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
          throw interruptionRef.current || new DOMException("Задание остановлено.", "AbortError");
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
          // A failed job must not leave a usable physical reference behind.
          setControllerEpoch(epoch => epoch + 1);
          if (profileRef.current === "grbl" && writerRef.current)
            void writeRaw(new Uint8Array([33])).catch(() => {});
          log("error", error.message);
        }
        throw error;
      } finally {
        jobActiveRef.current = false;
        cancelPaperWait();
        setPrintingSheet(null);
        setSheetProgress(null);
        operationRef.current = false;
        setOperationBusy(false);
      }
    },
    [
      cancelPaperWait,
      log,
      saveRecovery,
      sendCommand,
      waitWhilePaused,
      writeRaw,
      recovery,
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
    pendingRef.current.forEach(pending => pending.renewDeadline?.());
    setStatus("running");
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve());
  }, [status, writeRaw]);

  const stop = useCallback(() => {
    if (stopInFlightRef.current) return stopInFlightRef.current;
    const operation = (async () => {
      ++emergencyGenerationRef.current;
      cancelConnectRef.current = true;
      emergencyStopRef.current = true;
      setEmergencyStopped(true);
      cancelPaperWait();
      abortRef.current = true;
      interruptionRef.current = null;
      pausedRef.current = false;
      pauseWaitersRef.current.splice(0).forEach((resolve) => resolve());
      for (const pending of pendingRef.current.splice(0)) {
        clearTimeout(pending.timeout);
        pending.reject(new DOMException("Задание остановлено.", "AbortError"));
      }
      saveRecovery(null);
      desynchronizedRef.current = true;
      setControllerEpoch((epoch) => epoch + 1);
      clearMachineStatus();
      const nativeStop = typeof window !== "undefined" && window.__openhandEmergencyStop;
      let delivery: Promise<unknown>;
      if (nativeStop) {
        delivery = nativeStop(profileRef.current).then(result => {
          if (!result.sent) throw new Error("USB-мост не подтвердил отправку СТОП.");
        });
      } else {
        if (!writerRef.current) throw new Error("Нет связи с плоттером. Отключите его питание и USB.");
        const bytes = profileRef.current === "grbl" ? new Uint8Array([0x85, 0x21, 0x18])
          : profileRef.current === "marlin" ? "M410\n" : "R\r\n";
        delivery = writeRaw(bytes);
      }
      let timer: ReturnType<typeof setTimeout>;
      try {
        await Promise.race([delivery, new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Отправка СТОП не подтверждена за 4 секунды.")), 4000);
        })]);
      } finally { clearTimeout(timer!); }
      setStatus(writerRef.current ? "connected" : "disconnected");
      log("system", "Команда остановки передана. Очередь отменена; новые команды заблокированы.");
      if (profileRef.current === "grbl" && writerRef.current) {
        const sequence = statusReportRef.current.sequence;
        const deadline = Date.now() + 1800;
        while (Date.now() < deadline && writerRef.current) {
          try { await writeRaw("?", false); }
          catch { break; }
          await new Promise(resolve => setTimeout(resolve, 150));
          const report = statusReportRef.current;
          if (report.sequence > sequence && ["Idle", "Hold:0", "Alarm", "Sleep"].includes(report.state))
            return { delivered: true, controllerState: report.state };
        }
      }
      return { delivered: true, controllerState: null };
    })();
    stopInFlightRef.current = operation;
    const clear = () => { if (stopInFlightRef.current === operation) stopInFlightRef.current = null; };
    void operation.then(clear, error => { log("error", `Остановка: ${error instanceof Error ? error.message : String(error)}`); clear(); });
    return operation;
  }, [cancelPaperWait, log, saveRecovery, writeRaw]);

  const sendCommands = useCallback(
    async (commands, options: { waitForMotion?: boolean } = {}) => {
      if (emergencyStopRef.current) throw new Error("СТОП: управление заблокировано.");
      if (operationRef.current)
        throw new Error("Дождитесь завершения текущей операции.");
      operationRef.current = true;
      setOperationBusy(true);
      abortRef.current = false;
      interruptionRef.current = null;
      try {
        for (const command of commands) {
          if (abortRef.current) throw new Error("Операция прервана.");
          await sendCommand(command);
          if (abortRef.current) throw interruptionRef.current || new DOMException("Операция прервана.", "AbortError");
        }
        if (options.waitForMotion && profileRef.current === "grbl" && commands.some(command => /^\$J=/i.test(command))) {
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
        } else if (options.waitForMotion && profileRef.current === "grbl") {
          await sendCommand("G4P0.01", 120000);
        } else if (options.waitForMotion && profileRef.current === "marlin") {
          await sendCommand("M400", 120000);
        }
        if (abortRef.current) throw interruptionRef.current || new DOMException("Операция прервана.", "AbortError");
      } finally {
        operationRef.current = false;
        setOperationBusy(false);
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
    operationBusy,
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
    controllerSettingsComplete,
    realtime,
    recovery,
    recoveryWarning,
    connect,
    disconnect,
    run,
    recover,
    pause,
    resume,
    stop,
    emergencyStopped,
    releaseEmergencyStop: async () => {
      const generation = emergencyGenerationRef.current;
      if (stopInFlightRef.current || operationRef.current || connectingRef.current) throw new Error("Дождитесь завершения отмены операции.");
      if (typeof window !== "undefined" && window.__openhandReleaseEmergencyStop)
        await window.__openhandReleaseEmergencyStop();
      if (stopInFlightRef.current || generation !== emergencyGenerationRef.current) throw new Error("Запрошен новый СТОП. Управление остаётся заблокированным.");
      // A cancelled native write may have errored the WritableStream. A
      // released latch is not evidence that this old stream is usable again.
      if (desynchronizedRef.current && writerRef.current) await disconnect();
      else {
        try { await writerRef.current?.ready; }
        catch { await disconnect(); }
      }
      if (stopInFlightRef.current || generation !== emergencyGenerationRef.current) throw new Error("Запрошен новый СТОП. Управление остаётся заблокированным.");
      emergencyStopRef.current = false;
      if (writerRef.current && profileRef.current === "grbl") {
        operationRef.current = true;
      setOperationBusy(true);
        try { await sendCommand("$$"); }
        catch (error) { emergencyStopRef.current = true; throw error; }
        finally { operationRef.current = false;
        setOperationBusy(false); }
      }
      if (generation !== emergencyGenerationRef.current) throw new Error("Запрошен новый СТОП.");
      setEmergencyStopped(false);
      // Only settings were read; no job resumption or reference restoration.
    },
    sendCommands,
    resetProgress,
    clearLogs: () => setLogs([]),
    discardRecovery: () => saveRecovery(null),
  };
}
