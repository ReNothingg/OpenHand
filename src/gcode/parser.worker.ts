/// <reference lib="webworker" />

import { parseGCode } from "./parser";
import { MAX_GCODE_SEGMENTS_PER_KIND } from "./limits";
import type { GCodePenModel } from "./penModel";

self.addEventListener("message", (event: MessageEvent<{ id: number; source: string; penModel?: GCodePenModel }>) => {
  const { id, source, penModel } = event.data;
  try {
    const result = parseGCode(source, {
      penModel,
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
