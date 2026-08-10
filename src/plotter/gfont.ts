const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
export const MAX_GFONT_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_GFONT_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export interface GFontPoint {
  x: number;
  y: number;
}

export interface GFontGlyph {
  codePoint: number;
  points: GFontPoint[];
  flags: number[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

interface GFontEntry {
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
}

export const BUILTIN_GFONT_FAMILIES = [
  {
    id: "ifdream",
    label: "Если Мечта",
    description: "живой школьный почерк",
    source: "ifdream-unicode.gfont",
    variants: [
      { id: "ifdream-original", label: "оригинал" },
      {
        id: "ifdream-slanted",
        label: "наклонный",
        transform: { slant: 0.2, width: 0.98 },
      },
      {
        id: "ifdream-notes",
        label: "конспектный",
        transform: { slant: 0.11, width: 0.82 },
      },
      {
        id: "ifdream-wide",
        label: "размашистый",
        transform: { slant: 0.08, width: 1.15 },
      },
      {
        id: "ifdream-live",
        label: "живой",
        transform: { slant: 0.05, width: 1.03, wobble: 4.5 },
      },
    ],
  },
  {
    id: "iso",
    label: "ISO 3098",
    description: "ровный технический почерк",
    source: "iso-3098-cyrillic.gfont",
    variants: [
      { id: "iso-original", label: "технический" },
      {
        id: "iso-italic",
        label: "наклонный",
        transform: { slant: 0.2, width: 0.96 },
      },
      {
        id: "iso-narrow",
        label: "узкий",
        transform: { slant: 0.08, width: 0.78 },
      },
    ],
  },
  {
    id: "opengost-a",
    label: "OpenGost A",
    description: "узкий чертёжный ГОСТ с полной кириллицей",
    source: "opengost-a.gfont",
    variants: [
      { id: "opengost-a-original", label: "оригинал" },
      {
        id: "opengost-a-slanted",
        label: "наклонный",
        transform: { slant: 0.2, width: 0.98 },
      },
      {
        id: "opengost-a-notes",
        label: "конспектный",
        transform: { slant: 0.1, width: 0.84 },
      },
    ],
  },
  {
    id: "opengost-b",
    label: "OpenGost B",
    description: "широкий ровный ГОСТ с полной кириллицей",
    source: "opengost-b.gfont",
    variants: [
      { id: "opengost-b-original", label: "оригинал" },
      {
        id: "opengost-b-slanted",
        label: "наклонный",
        transform: { slant: 0.18, width: 0.98 },
      },
      {
        id: "opengost-b-wide",
        label: "размашистый",
        transform: { slant: 0.06, width: 1.14 },
      },
    ],
  },
  {
    id: "unicode-stroke",
    label: "Unicode Stroke",
    description: "универсальный однолинейный шрифт LibreCAD",
    source: "unicode-stroke.gfont",
    variants: [
      { id: "unicode-stroke-original", label: "оригинал" },
      {
        id: "unicode-stroke-slanted",
        label: "наклонный",
        transform: { slant: 0.17, width: 0.96 },
      },
      {
        id: "unicode-stroke-compact",
        label: "компактный",
        transform: { slant: 0.05, width: 0.8 },
      },
    ],
  },
  {
    id: "hershey-cyrillic",
    label: "Hershey Cyrillic",
    description: "классический чертёжный шрифт с засечками",
    source: "hershey-cyrillic.gfont",
    variants: [
      { id: "hershey-cyrillic-original", label: "оригинал" },
      {
        id: "hershey-cyrillic-slanted",
        label: "наклонный",
        transform: { slant: 0.19, width: 0.98 },
      },
      {
        id: "hershey-cyrillic-compact",
        label: "компактный",
        transform: { slant: 0.06, width: 0.82 },
      },
    ],
  },
];

export const BUILTIN_GFONT_OPTIONS = BUILTIN_GFONT_FAMILIES.flatMap((family) =>
  family.variants.map((variant) => ({
    ...variant,
    familyId: family.id,
    familyLabel: family.label,
    variantLabel: variant.label,
    label: `${family.label} — ${variant.label}`,
    source: family.source,
  })),
);

const bundledSourceCache = new Map<string, Promise<GFont>>();

const BUNDLED_GFONT_LOADERS = {
  "ifdream-unicode.gfont": () =>
    import("../../font/plotter/ifdream-unicode.gfont?url").then(
      (module) => module.default,
    ),
  "iso-3098-cyrillic.gfont": () =>
    import("../../font/plotter/iso-3098-cyrillic.gfont?url").then(
      (module) => module.default,
    ),
  "opengost-a.gfont": () =>
    import("../../font/plotter/opengost-a.gfont?url").then(
      (module) => module.default,
    ),
  "opengost-b.gfont": () =>
    import("../../font/plotter/opengost-b.gfont?url").then(
      (module) => module.default,
    ),
  "unicode-stroke.gfont": () =>
    import("../../font/plotter/unicode-stroke.gfont?url").then(
      (module) => module.default,
    ),
  "hershey-cyrillic.gfont": () =>
    import("../../font/plotter/hershey-cyrillic.gfont?url").then(
      (module) => module.default,
    ),
};

function findEndOfCentralDirectory(view: DataView) {
  const minimum = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset;
  }
  throw new Error("В файле не найден ZIP-каталог шрифта.");
}

async function inflateRaw(bytes: Uint8Array) {
  if (!globalThis.DecompressionStream) {
    throw new Error(
      "Браузер не поддерживает распаковку .gfont. Откройте OpenHand в Chrome или Edge.",
    );
  }
  const stream = new Blob([bytes.slice().buffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function parseGlyph(bytes: Uint8Array, expectedCodePoint: number): GFontGlyph {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 10) throw new Error("Повреждённая глифа в .gfont.");

  let offset = 0;
  const codePoint = view.getUint16(offset, false);
  offset += 2;
  const floatCount = view.getUint32(offset, false);
  offset += 4;
  if (
    floatCount % 2 !== 0 ||
    floatCount > 2_000_000 ||
    offset + floatCount * 4 + 4 > view.byteLength
  ) {
    throw new Error("Некорректные координаты глифы.");
  }

  const points: GFontPoint[] = [];
  for (let index = 0; index < floatCount; index += 2) {
    points.push({
      x: view.getFloat32(offset, false),
      y: view.getFloat32(offset + 4, false),
    });
    offset += 8;
  }

  const flagCount = view.getUint32(offset, false);
  offset += 4;
  if (flagCount > points.length || offset + flagCount > view.byteLength) {
    throw new Error("Некорректные флаги штрихов глифы.");
  }
  const flags = Array.from(
    new Uint8Array(bytes.buffer, bytes.byteOffset + offset, flagCount),
  );

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return {
    codePoint: codePoint || expectedCodePoint,
    points,
    flags,
    bounds: points.length
      ? { minX, maxX, minY, maxY }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  };
}

export class GFont {
  bytes: Uint8Array;
  view: DataView;
  name: string;
  entries: Map<number, GFontEntry>;
  cache: Map<number, GFontGlyph | null>;

  constructor(arrayBuffer: ArrayBuffer, name = "Шрифт .gfont") {
    if (arrayBuffer.byteLength > MAX_GFONT_ARCHIVE_BYTES) {
      throw new Error(
        `.gfont больше ${MAX_GFONT_ARCHIVE_BYTES / 1024 / 1024} МБ. Уменьшите шрифт или разделите набор глифов.`,
      );
    }
    this.bytes = new Uint8Array(arrayBuffer);
    this.view = new DataView(arrayBuffer);
    this.name = name;
    this.entries = new Map();
    this.cache = new Map();
    this.readDirectory();
  }

  readDirectory() {
    const eocd = findEndOfCentralDirectory(this.view);
    this.assertRange(eocd, 22, "Повреждённый ZIP-каталог .gfont.");
    const entryCount = this.view.getUint16(eocd + 10, true);
    const directorySize = this.view.getUint32(eocd + 12, true);
    const recordedDirectoryOffset = this.view.getUint32(eocd + 16, true);
    const zipBase = eocd - directorySize - recordedDirectoryOffset;
    if (zipBase < 0) throw new Error("Некорректное смещение ZIP-каталога .gfont.");
    this.assertRange(
      zipBase + recordedDirectoryOffset,
      directorySize,
      "ZIP-каталог .gfont выходит за границы файла.",
    );
    let offset = zipBase + recordedDirectoryOffset;
    let totalUncompressedSize = 0;

    for (let index = 0; index < entryCount; index += 1) {
      this.assertRange(offset, 46, "Повреждённая запись каталога .gfont.");
      if (this.view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
        throw new Error("Повреждённый каталог .gfont.");
      }
      const method = this.view.getUint16(offset + 10, true);
      const compressedSize = this.view.getUint32(offset + 20, true);
      const uncompressedSize = this.view.getUint32(offset + 24, true);
      const nameLength = this.view.getUint16(offset + 28, true);
      const extraLength = this.view.getUint16(offset + 30, true);
      const commentLength = this.view.getUint16(offset + 32, true);
      const localOffset = zipBase + this.view.getUint32(offset + 42, true);
      const recordSize = 46 + nameLength + extraLength + commentLength;
      this.assertRange(offset, recordSize, "Запись каталога .gfont обрезана.");
      this.assertRange(localOffset, 30, "Смещение глифы выходит за границы .gfont.");
      totalUncompressedSize += uncompressedSize;
      if (totalUncompressedSize > MAX_GFONT_UNCOMPRESSED_BYTES) {
        throw new Error("Распакованный размер .gfont превышает безопасный предел.");
      }
      const nameBytes = this.bytes.subarray(
        offset + 46,
        offset + 46 + nameLength,
      );
      const entryName = new TextDecoder().decode(nameBytes);
      if (/^\d+$/.test(entryName)) {
        this.entries.set(Number(entryName), {
          method,
          compressedSize,
          uncompressedSize,
          localOffset,
        });
      }
      offset += recordSize;
    }
  }

  private assertRange(offset: number, length: number, message: string) {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset + length > this.view.byteLength
    ) {
      throw new Error(message);
    }
  }

  has(codePoint: number) {
    return this.entries.has(codePoint);
  }

  async getGlyph(codePoint: number): Promise<GFontGlyph | null> {
    const cached = this.cache.get(codePoint);
    if (cached !== undefined) return cached;
    const entry = this.entries.get(codePoint);
    if (!entry) return null;

    const { localOffset } = entry;
    this.assertRange(localOffset, 30, "Повреждённая локальная запись .gfont.");
    if (this.view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(
        `Повреждена запись символа U+${codePoint.toString(16).toUpperCase()}.`,
      );
    }
    const nameLength = this.view.getUint16(localOffset + 26, true);
    const extraLength = this.view.getUint16(localOffset + 28, true);
    const dataOffset = localOffset + 30 + nameLength + extraLength;
    this.assertRange(
      dataOffset,
      entry.compressedSize,
      "Сжатые данные глифы выходят за границы .gfont.",
    );
    const compressed = this.bytes.subarray(
      dataOffset,
      dataOffset + entry.compressedSize,
    );
    let decoded;
    if (entry.method === 0) decoded = compressed;
    else if (entry.method === 8) decoded = await inflateRaw(compressed);
    else throw new Error(`Метод сжатия ZIP ${entry.method} не поддерживается.`);
    if (
      entry.uncompressedSize &&
      decoded.byteLength !== entry.uncompressedSize
    ) {
      throw new Error("Размер распакованной глифы не совпал с каталогом.");
    }
    const glyph = parseGlyph(decoded, codePoint);
    this.cache.set(codePoint, glyph);
    return glyph;
  }
}

export async function loadGFont(source: ArrayBuffer | Blob, name?: string) {
  const sourceSize = source instanceof ArrayBuffer ? source.byteLength : source.size;
  if (sourceSize > MAX_GFONT_ARCHIVE_BYTES) {
    throw new Error(
      `.gfont больше ${MAX_GFONT_ARCHIVE_BYTES / 1024 / 1024} МБ. Уменьшите шрифт или разделите набор глифов.`,
    );
  }
  const buffer =
    source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  return new GFont(
    buffer,
    name || (source instanceof File ? source.name : undefined),
  );
}

function transformGlyph(
  glyph: GFontGlyph,
  codePoint: number,
  transform: { width?: number; slant?: number; wobble?: number } = {},
) {
  const width = transform.width ?? 1;
  const slant = transform.slant ?? 0;
  const wobble = transform.wobble ?? 0;
  const originX = glyph.bounds.minX;
  const baseline = glyph.bounds.maxY;
  const seed = (codePoint % 97) * 0.173;
  const points = glyph.points.map((point: GFontPoint) => ({
    x:
      originX +
      (point.x - originX) * width -
      (point.y - baseline) * slant +
      wobble * Math.sin((point.y - baseline) * 0.035 + seed),
    y: point.y,
  }));
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return {
    ...glyph,
    points,
    flags: [...glyph.flags],
    bounds: points.length
      ? {
          minX,
          maxX,
          minY,
          maxY,
        }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  };
}

type BuiltinGFontOption = (typeof BUILTIN_GFONT_OPTIONS)[number];

function createVariantFont(base: GFont, option: BuiltinGFontOption) {
  const cache = new Map<number, GFontGlyph | null>();
  return {
    name: option.label,
    entries: base.entries,
    has: (codePoint: number) => base.has(codePoint),
    async getGlyph(codePoint: number) {
      if (cache.has(codePoint)) return cache.get(codePoint);
      const glyph = await base.getGlyph(codePoint);
      const transformed = glyph
        ? transformGlyph(glyph, codePoint, option.transform)
        : null;
      cache.set(codePoint, transformed);
      return transformed;
    },
  };
}

async function loadBundledSource(filename: string) {
  const cached = bundledSourceCache.get(filename);
  if (cached) return cached;
  const loader =
    BUNDLED_GFONT_LOADERS[filename as keyof typeof BUNDLED_GFONT_LOADERS];
  if (!loader)
    throw new Error(`Встроенный шрифт «${filename}» не найден в сборке.`);
  const pending = loader()
    .then((url) => fetch(url))
    .then((response) => {
      // WKURLSchemeHandler returns a non-HTTP response with status 0.
      if (!response.ok && response.status !== 0) {
        throw new Error(`HTTP ${response.status}`);
      }
      return response.arrayBuffer();
    })
    .then((buffer) => loadGFont(buffer, filename));
  bundledSourceCache.set(filename, pending);
  return pending;
}

export async function loadBundledGFont(
  id = BUILTIN_GFONT_OPTIONS[0]?.id || "ifdream-original",
) {
  const option =
    BUILTIN_GFONT_OPTIONS.find((item) => item.id === id) ||
    BUILTIN_GFONT_OPTIONS[0];
  if (!option) throw new Error("Встроенные GFont не настроены.");
  try {
    const base = await loadBundledSource(option.source);
    return createVariantFont(base, option);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    throw new Error(
      `Не удалось открыть встроенный шрифт «${option.label}»: ${message}`,
    );
  }
}
