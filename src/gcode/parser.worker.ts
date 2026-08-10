/// <reference lib="webworker" />

import { parseGCode } from "./parser";
import { MAX_GCODE_SEGMENTS_PER_KIND } from "./limits";

self.addEventListener("message", (event: MessageEvent<{ id: number; source: string }>) => {
  const { id, source } = event.data;
  try {
    const result = parseGCode(source, {
      includeLines: false,
      maxSegmentsPerKind: MAX_GCODE_SEGMENTS_PER_KIND,
    });
    self.postMessage(
      { id, result },
      [result.lineOffsets.buffer as ArrayBuffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export {};
