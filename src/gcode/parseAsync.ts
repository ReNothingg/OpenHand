import { parseGCode, type GCodeParseResult } from "./parser";
import { MAX_GCODE_SEGMENTS_PER_KIND } from "./limits";

type PendingRequest = {
  resolve: (result: GCodeParseResult) => void;
  reject: (error: Error) => void;
};

let parserWorker: Worker | null = null;
let workerUnavailable = false;
let nextRequestId = 1;
const pending = new Map<number, PendingRequest>();

function rejectPending(message: string) {
  for (const request of pending.values()) request.reject(new Error(message));
  pending.clear();
}

function getWorker() {
  if (workerUnavailable || typeof Worker === "undefined") return null;
  if (parserWorker) return parserWorker;
  try {
    parserWorker = new Worker(new URL("./parser.worker.ts", import.meta.url), {
      type: "module",
      name: "openhand-gcode-parser",
    });
    parserWorker.addEventListener("message", (event) => {
      const message = event.data as {
        id?: number;
        result?: GCodeParseResult;
        error?: string;
      };
      if (typeof message.id !== "number") return;
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error));
      else if (message.result) request.resolve(message.result);
      else request.reject(new Error("Парсер G-code вернул пустой результат."));
    });
    parserWorker.addEventListener("error", () => {
      workerUnavailable = true;
      parserWorker?.terminate();
      parserWorker = null;
      rejectPending("Фоновый парсер G-code завершился с ошибкой.");
    });
    return parserWorker;
  } catch {
    workerUnavailable = true;
    parserWorker = null;
    return null;
  }
}

export async function parseGCodeAsync(source: string) {
  const worker = getWorker();
  if (!worker) {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return parseGCode(source, {
      includeLines: false,
      maxSegmentsPerKind: MAX_GCODE_SEGMENTS_PER_KIND,
    });
  }
  const id = nextRequestId++;
  return new Promise<GCodeParseResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, source });
  }).catch(async (error) => {
    if (!workerUnavailable) throw error;
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    return parseGCode(source, {
      includeLines: false,
      maxSegmentsPerKind: MAX_GCODE_SEGMENTS_PER_KIND,
    });
  });
}
