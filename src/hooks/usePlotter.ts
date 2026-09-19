import { useCallback, useEffect, useRef, useState } from "react";
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
  return profile === "marlin" ? "\n" : "\r\n";
}

export function usePlotter() {
  const supported = typeof navigator !== "undefined" && "serial" in navigator;
  const networkSupported =
    typeof window !== "undefined" && Boolean(window.__openhandNativePlatform);
  const [status, setStatus] = useState("disconnected");
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
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
  const pausedRef = useRef(false);
  const pauseWaitersRef = useRef([]);
  const commandTimeoutRef = useRef(12000);

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
    else pending.resolve(line);
  }, []);

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
              setMachineStatus(
                (previous) => parseGrblStatus(line, previous) || previous,
              );
              continue;
            }
            log("in", line);
            if (/^(ALARM|Grbl\s)/i.test(line)) {
              setControllerEpoch((epoch) => epoch + 1);
              setMachineStatus(null);
            }
            if (/^(ALARM|Grbl\s)/i.test(line) && operationRef.current) {
              abortRef.current = true;
              desynchronizedRef.current = true;
              pausedRef.current = false;
              pauseWaitersRef.current.splice(0).forEach((resume) => resume());
              for (const pending of pendingRef.current.splice(0)) {
                clearTimeout(pending.timeout);
                pending.reject(
                  new Error(`Контроллер прервал выполнение: ${line}`),
                );
              }
            }
            if (/^(ok|OK)\b/.test(line)) settlePending(line);
            else if (/^(error|ALARM)/i.test(line)) settlePending(line, true);
          }
        }
      } catch (error) {
        if (readerRef.current === reader) log("error", error.message);
      } finally {
        if (readerRef.current === reader) {
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
    [log, settlePending, status],
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
      if (desynchronizedRef.current)
        throw new Error(
          "Потеряна синхронизация ответов. Переподключите плоттер.",
        );
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
        pending = { resolve, reject, timeout };
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
        setStatus("connected");
        log(
          "system",
          connectionType === "network"
            ? `${profile.toUpperCase()} · TCP ${networkHost}:${networkPort}`
            : `${profile.toUpperCase()} · ${serialOptions.baudRate} бод · ${serialOptions.dataBits}${serialOptions.parity === "none" ? "N" : serialOptions.parity === "even" ? "E" : "O"}${serialOptions.stopBits}`,
        );
        if (profile === "marlin") await writeRaw("M115\n");
        else await writeRaw(new Uint8Array([24]));
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
    [log, networkSupported, readLoop, supported, writeRaw],
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
  }, [log]);

  useEffect(() => {
    if (!supported || typeof navigator.serial.addEventListener !== "function")
      return undefined;
    const handleDeviceDisconnect = () => {
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
  }, [log, supported]);

  const waitWhilePaused = useCallback(() => {
    if (!pausedRef.current) return Promise.resolve();
    return new Promise((resolve) => pauseWaitersRef.current.push(resolve));
  }, []);

  const run = useCallback(
    async (
      jobOrCommands,
      options: { startIndex?: number; prefix?: string[] } = {},
    ) => {
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
      setProgress({ current: startIndex, total: commands.length });
      if (recoverable) {
        saveRecovery({
          jobId: job.id,
          current: safeCheckpoint,
          total: commands.length,
          profile: profileRef.current,
        });
      }
      try {
        for (const command of options.prefix || []) await sendCommand(command);
        for (let index = startIndex; index < commands.length; index += 1) {
          if (abortRef.current)
            throw new DOMException("Задание остановлено.", "AbortError");
          await waitWhilePaused();
          if (abortRef.current)
            throw new DOMException("Задание остановлено.", "AbortError");
          await sendCommand(commands[index]);
          setProgress({ current: index + 1, total: commands.length });
          if (recoverable && checkpoints.has(index + 1)) {
            safeCheckpoint = index + 1;
            saveRecovery({
              jobId: job.id,
              current: safeCheckpoint,
              total: commands.length,
              profile: profileRef.current,
            });
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
      } catch (error) {
        setStatus(writerRef.current ? "connected" : "disconnected");
        if (error.name !== "AbortError") {
          if (profileRef.current === "grbl" && writerRef.current)
            await writeRaw(new Uint8Array([33])).catch(() => {});
          log("error", error.message);
          throw error;
        }
      } finally {
        operationRef.current = false;
      }
    },
    [log, saveRecovery, sendCommand, waitWhilePaused, writeRaw],
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
    if (status !== "paused") return;
    if (profileRef.current === "grbl") await writeRaw(new Uint8Array([126]));
    pausedRef.current = false;
    setStatus("running");
    pauseWaitersRef.current.splice(0).forEach((resolve) => resolve());
  }, [status, writeRaw]);

  const stop = useCallback(async () => {
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
    if (!writerRef.current) return;
    if (profileRef.current === "grbl") await writeRaw(new Uint8Array([33, 24]));
    else if (profileRef.current === "marlin") await writeRaw("M410\n");
    else await writeRaw("R\r\n");
    setStatus("connected");
    log(
      "system",
      "Отправлена аварийная остановка. Перед следующим заданием переподключите плоттер и проверьте ноль.",
    );
  }, [log, saveRecovery, writeRaw]);

  const sendCommands = useCallback(
    async (commands) => {
      if (operationRef.current)
        throw new Error("Дождитесь завершения текущей операции.");
      operationRef.current = true;
      abortRef.current = false;
      try {
        for (const command of commands) {
          if (abortRef.current) throw new Error("Операция прервана.");
          await sendCommand(command);
        }
      } finally {
        operationRef.current = false;
      }
    },
    [sendCommand],
  );

  useEffect(
    () => () => {
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
    machineStatus,
    controllerEpoch,
    realtime,
    recovery,
    connect,
    disconnect,
    run,
    recover,
    pause,
    resume,
    stop,
    sendCommands,
    clearLogs: () => setLogs([]),
    discardRecovery: () => saveRecovery(null),
  };
}
