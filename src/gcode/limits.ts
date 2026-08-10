export const MAX_GCODE_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_GCODE_PREVIEW_SEGMENTS = 250_000;
export const MAX_GCODE_SEGMENTS_PER_KIND =
  MAX_GCODE_PREVIEW_SEGMENTS / 2;

export function base64DecodedSize(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((value.length * 3) / 4) - padding);
}

export function validateGCodeFileSize(size: number) {
  if (!Number.isFinite(size) || size < 0) {
    throw new Error("Не удалось определить размер файла G-code.");
  }
  if (size > MAX_GCODE_FILE_BYTES) {
    throw new Error(
      `Файл G-code больше ${MAX_GCODE_FILE_BYTES / 1024 / 1024} МБ. Разделите задание на несколько файлов.`,
    );
  }
}

export function previewSegments<T>(segments: T[]) {
  if (segments.length <= MAX_GCODE_PREVIEW_SEGMENTS) return segments;
  const stride = Math.ceil(segments.length / MAX_GCODE_PREVIEW_SEGMENTS);
  return segments.filter((_, index) => index % stride === 0);
}
