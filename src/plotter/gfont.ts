import { validForms, formGlyph, type LetterForm } from '../font-builder/letterForms';
import { orderedStrokeSamples } from '../font-builder/strokeSamples';
const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
export const MAX_GFONT_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_GFONT_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

export interface GFontPoint {
  x: number;
  y: number;
  pressure?: number;
  tiltX?: number;
  tiltY?: number;
  time?: number;
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
  { id: "retest", label: "ReTest", description: "личный рукописный GFont", source: "ReTest.gfont", variants: [{ id: "retest-original", label: "оригинал" }] },
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
  "ReTest.gfont": () => import("../../font/plotter/ReTest.gfont?url").then((module) => module.default),
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
  private penEntries = new Map<number, GFontEntry>();
  private formEntries = new Map<number, GFontEntry>();
  private formCache = new Map<number, LetterForm[]>();
  private synthesizing = new Set<number>();

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
      const penMatch = entryName.match(/^openhand\/(\d+)\.pen\.json$/);
      const formMatch = entryName.match(/^openhand\/(\d+)\.forms\.json$/);
      if (formMatch && uncompressedSize <= 8 * 1024 * 1024) this.formEntries.set(Number(formMatch[1]), { method, compressedSize, uncompressedSize, localOffset });
      if (penMatch && uncompressedSize <= 8 * 1024 * 1024) {
        this.penEntries.set(Number(penMatch[1]), { method, compressedSize, uncompressedSize, localOffset });
      }
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

  private async readEntry(entry: GFontEntry): Promise<Uint8Array> {
    const { localOffset } = entry;
    this.assertRange(localOffset, 30, "Повреждённая локальная запись .gfont.");
    if (this.view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(
        "Повреждена локальная запись .gfont.",
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
    return decoded;
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
    return this.entries.has(codePoint) || [60, 62, 8800, 8804, 8805].includes(codePoint);
  }

  async getGlyph(codePoint: number): Promise<GFontGlyph | null> {
    const cached = this.cache.get(codePoint);
    if (cached !== undefined) return cached;
    const entry = this.entries.get(codePoint);
    if (!entry) {
      const synthesized = await this.synthesizeSymbol(codePoint);
      this.cache.set(codePoint, synthesized);
      return synthesized;
    }

    const decoded = await this.readEntry(entry);
    const glyph = parseGlyph(decoded, codePoint);
    const penEntry = this.penEntries.get(codePoint);
    if (penEntry) {
      try {
        const metadata = JSON.parse(new TextDecoder().decode(await this.readEntry(penEntry)));
        if (metadata.version === 1 && Array.isArray(metadata.points) && metadata.points.length === glyph.points.length) {
          glyph.points.forEach((point, index) => {
            const sample = metadata.points[index];
            if (!sample || typeof sample !== "object") return;
            for (const [key, min, max] of [["pressure", 0, 1], ["tiltX", -90, 90], ["tiltY", -90, 90], ["time", 0, 86400000]] as const) {
              const value = sample[key];
              if (typeof value === "number" && Number.isFinite(value) && value >= min && value <= max) point[key] = value;
            }
          });
        }
      } catch { /* Optional pen metadata must not make valid centerline glyphs unreadable. */ }
    }
    const strokes: GFontPoint[][] = [];
    glyph.points.forEach((point, index) => {
      if (!glyph.flags[index] || !strokes.length) strokes.push([]);
      strokes.at(-1)!.push(point);
    });
    const repaired = strokes.map(orderedStrokeSamples);
    if (repaired.some((stroke, index) => stroke !== strokes[index])) {
      const clean = formGlyph({ strokes: repaired }, glyph.codePoint);
      glyph.points = clean.points;
      glyph.flags = clean.flags;
      glyph.bounds = clean.bounds;
    }
    this.cache.set(codePoint, glyph);
    return glyph;
  }

  async getForms(codePoint: number): Promise<LetterForm[]> {
    const cached = this.formCache.get(codePoint);
    if (cached) return cached;
    let forms: LetterForm[] = [];
    const entry = this.formEntries.get(codePoint);
    if (entry) {
      try {
        const data = JSON.parse(new TextDecoder().decode(await this.readEntry(entry)));
        if (data?.version === 1) forms = validForms(data.forms);
      } catch { /* A damaged optional extension does not invalidate the legacy glyph. */ }
    }
    if (!forms.length) {
      const glyph = await this.getGlyph(codePoint);
      if (glyph) {
        const strokes: GFontPoint[][] = [];
        glyph.points.forEach((p, i) => { if (!glyph.flags[i] || !strokes.length) strokes.push([]); strokes.at(-1)!.push({ ...p }); });
        forms = [{ strokes: strokes.filter(s => s.length > 1), position: 'any' }];
      }
    }
    this.formCache.set(codePoint, forms);
    return forms;
  }

  private async synthesizeSymbol(codePoint: number): Promise<GFontGlyph | null> {
    if (![60, 62, 8800, 8804, 8805].includes(codePoint)) return null;
    if (this.synthesizing.has(codePoint)) return null;
    this.synthesizing.add(codePoint);

    try {
      let refGlyph: GFontGlyph | null = null;
      for (const refCp of [61, 45, 43, 60, 62]) {
        if (this.entries.has(refCp)) {
          refGlyph = await this.getGlyph(refCp);
          if (refGlyph) break;
        }
      }

      const minX = refGlyph ? refGlyph.bounds.minX : 20;
      const maxX = refGlyph ? refGlyph.bounds.maxX : 160;
      const width = Math.max(60, maxX - minX);
      const midX = (minX + maxX) / 2;
      const minY = refGlyph ? refGlyph.bounds.minY : -180;
      const maxY = refGlyph ? refGlyph.bounds.maxY : -90;
      const height = Math.max(40, maxY - minY);
      const midY = (minY + maxY) / 2;

      const toGlyph = (strokes: GFontPoint[][]): GFontGlyph => {
        const points: GFontPoint[] = [];
        const flags: number[] = [];
        let gMinX = Infinity, gMaxX = -Infinity, gMinY = Infinity, gMaxY = -Infinity;
        for (const stroke of strokes) {
          if (stroke.length < 2) continue;
          stroke.forEach((p, i) => {
            points.push({ ...p });
            flags.push(i === 0 ? 0 : 1);
            gMinX = Math.min(gMinX, p.x);
            gMaxX = Math.max(gMaxX, p.x);
            gMinY = Math.min(gMinY, p.y);
            gMaxY = Math.max(gMaxY, p.y);
          });
        }
        return {
          codePoint,
          points,
          flags,
          bounds: points.length
            ? { minX: gMinX, maxX: gMaxX, minY: gMinY, maxY: gMaxY }
            : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
        };
      };

      if (codePoint === 8800) {
        const eq = this.entries.has(61) ? await this.getGlyph(61) : null;
        if (eq && eq.points.length >= 2) {
          const strokes: GFontPoint[][] = [];
          eq.points.forEach((p, i) => {
            if (!eq.flags[i] || !strokes.length) strokes.push([]);
            strokes.at(-1)!.push({ ...p });
          });
          const eqW = eq.bounds.maxX - eq.bounds.minX;
          const eqH = Math.max(30, eq.bounds.maxY - eq.bounds.minY);
          const slashStart = { x: eq.bounds.maxX - eqW * 0.15, y: eq.bounds.minY - eqH * 0.7 };
          const slashEnd = { x: eq.bounds.minX + eqW * 0.15, y: eq.bounds.maxY + eqH * 0.7 };
          strokes.push([slashStart, slashEnd]);
          return toGlyph(strokes);
        }
        const s1 = [{ x: minX, y: midY - height * 0.35 }, { x: maxX, y: midY - height * 0.35 }];
        const s2 = [{ x: minX, y: midY + height * 0.35 }, { x: maxX, y: midY + height * 0.35 }];
        const slash = [{ x: midX + width * 0.3, y: midY - height * 0.9 }, { x: midX - width * 0.3, y: midY + height * 0.9 }];
        return toGlyph([s1, s2, slash]);
      }

      if (codePoint === 60) {
        if (this.entries.has(62)) {
          const gt = await this.getGlyph(62);
          if (gt) {
            const flipped: GFontPoint[][] = [];
            gt.points.forEach((p, i) => {
              if (!gt.flags[i] || !flipped.length) flipped.push([]);
              flipped.at(-1)!.push({ x: gt.bounds.maxX - (p.x - gt.bounds.minX), y: p.y });
            });
            return toGlyph(flipped);
          }
        }
        const halfH = Math.max(35, width * 0.45);
        return toGlyph([[{ x: maxX, y: midY - halfH }, { x: minX, y: midY }, { x: maxX, y: midY + halfH }]]);
      }

      if (codePoint === 62) {
        if (this.entries.has(60)) {
          const lt = await this.getGlyph(60);
          if (lt) {
            const flipped: GFontPoint[][] = [];
            lt.points.forEach((p, i) => {
              if (!lt.flags[i] || !flipped.length) flipped.push([]);
              flipped.at(-1)!.push({ x: lt.bounds.maxX - (p.x - lt.bounds.minX), y: p.y });
            });
            return toGlyph(flipped);
          }
        }
        const halfH = Math.max(35, width * 0.45);
        return toGlyph([[{ x: minX, y: midY - halfH }, { x: maxX, y: midY }, { x: minX, y: midY + halfH }]]);
      }

      if (codePoint === 8804) {
        const lt = await this.getGlyph(60);
        if (lt && lt.points.length >= 2) {
          const strokes: GFontPoint[][] = [];
          const shiftUp = Math.max(25, (lt.bounds.maxY - lt.bounds.minY) * 0.35);
          lt.points.forEach((p, i) => {
            if (!lt.flags[i] || !strokes.length) strokes.push([]);
            strokes.at(-1)!.push({ x: p.x, y: p.y - shiftUp });
          });
          const lineY = lt.bounds.maxY - shiftUp + Math.max(20, shiftUp * 0.85);
          strokes.push([{ x: lt.bounds.minX, y: lineY }, { x: lt.bounds.maxX, y: lineY }]);
          return toGlyph(strokes);
        }
      }

      if (codePoint === 8805) {
        const gt = await this.getGlyph(62);
        if (gt && gt.points.length >= 2) {
          const strokes: GFontPoint[][] = [];
          const shiftUp = Math.max(25, (gt.bounds.maxY - gt.bounds.minY) * 0.35);
          gt.points.forEach((p, i) => {
            if (!gt.flags[i] || !strokes.length) strokes.push([]);
            strokes.at(-1)!.push({ x: p.x, y: p.y - shiftUp });
          });
          const lineY = gt.bounds.maxY - shiftUp + Math.max(20, shiftUp * 0.85);
          strokes.push([{ x: gt.bounds.minX, y: lineY }, { x: gt.bounds.maxX, y: lineY }]);
          return toGlyph(strokes);
        }
      }

      return null;
    } finally {
      this.synthesizing.delete(codePoint);
    }
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
    ...point,
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
    async getForms(codePoint: number) {
      return (await base.getForms(codePoint)).map(form => {
        const transformed = transformGlyph(formGlyph(form, codePoint), codePoint, option.transform);
        let offset = 0;
        return { ...form, strokes: form.strokes.map(stroke => { const result = transformed.points.slice(offset, offset + stroke.length); offset += stroke.length; return result; }) };
      });
    },
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
