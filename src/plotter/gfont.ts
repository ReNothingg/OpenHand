const EOCD_SIGNATURE = 0x06054b50
const CENTRAL_SIGNATURE = 0x02014b50
const LOCAL_SIGNATURE = 0x04034b50

export const BUILTIN_GFONT_FAMILIES = [
  {
    id: 'ifdream',
    label: 'Если Мечта',
    description: 'живой школьный почерк',
    source: 'ifdream-unicode.gfont',
    variants: [
      { id: 'ifdream-original', label: 'оригинал' },
      { id: 'ifdream-slanted', label: 'наклонный', transform: { slant: 0.2, width: 0.98 } },
      { id: 'ifdream-notes', label: 'конспектный', transform: { slant: 0.11, width: 0.82 } },
      { id: 'ifdream-wide', label: 'размашистый', transform: { slant: 0.08, width: 1.15 } },
      { id: 'ifdream-live', label: 'живой', transform: { slant: 0.05, width: 1.03, wobble: 4.5 } },
    ],
  },
  {
    id: 'iso',
    label: 'ISO 3098',
    description: 'ровный технический почерк',
    source: 'iso-3098-cyrillic.gfont',
    variants: [
      { id: 'iso-original', label: 'технический' },
      { id: 'iso-italic', label: 'наклонный', transform: { slant: 0.2, width: 0.96 } },
      { id: 'iso-narrow', label: 'узкий', transform: { slant: 0.08, width: 0.78 } },
    ],
  },
  {
    id: 'opengost-a',
    label: 'OpenGost A',
    description: 'узкий чертёжный ГОСТ с полной кириллицей',
    source: 'opengost-a.gfont',
    variants: [
      { id: 'opengost-a-original', label: 'оригинал' },
      { id: 'opengost-a-slanted', label: 'наклонный', transform: { slant: 0.2, width: 0.98 } },
      { id: 'opengost-a-notes', label: 'конспектный', transform: { slant: 0.1, width: 0.84 } },
    ],
  },
  {
    id: 'opengost-b',
    label: 'OpenGost B',
    description: 'широкий ровный ГОСТ с полной кириллицей',
    source: 'opengost-b.gfont',
    variants: [
      { id: 'opengost-b-original', label: 'оригинал' },
      { id: 'opengost-b-slanted', label: 'наклонный', transform: { slant: 0.18, width: 0.98 } },
      { id: 'opengost-b-wide', label: 'размашистый', transform: { slant: 0.06, width: 1.14 } },
    ],
  },
  {
    id: 'unicode-stroke',
    label: 'Unicode Stroke',
    description: 'универсальный однолинейный шрифт LibreCAD',
    source: 'unicode-stroke.gfont',
    variants: [
      { id: 'unicode-stroke-original', label: 'оригинал' },
      { id: 'unicode-stroke-slanted', label: 'наклонный', transform: { slant: 0.17, width: 0.96 } },
      { id: 'unicode-stroke-compact', label: 'компактный', transform: { slant: 0.05, width: 0.8 } },
    ],
  },
  {
    id: 'hershey-cyrillic',
    label: 'Hershey Cyrillic',
    description: 'классический чертёжный шрифт с засечками',
    source: 'hershey-cyrillic.gfont',
    variants: [
      { id: 'hershey-cyrillic-original', label: 'оригинал' },
      { id: 'hershey-cyrillic-slanted', label: 'наклонный', transform: { slant: 0.19, width: 0.98 } },
      { id: 'hershey-cyrillic-compact', label: 'компактный', transform: { slant: 0.06, width: 0.82 } },
    ],
  },
]

export const BUILTIN_GFONT_OPTIONS = BUILTIN_GFONT_FAMILIES.flatMap((family) => (
  family.variants.map((variant) => ({
    ...variant,
    familyId: family.id,
    familyLabel: family.label,
    variantLabel: variant.label,
    label: `${family.label} — ${variant.label}`,
    source: family.source,
  }))
))

const bundledSourceCache = new Map()

const BUNDLED_GFONT_LOADERS = {
  'ifdream-unicode.gfont': () => import('../../font/plotter/ifdream-unicode.gfont?url').then((module) => module.default),
  'iso-3098-cyrillic.gfont': () => import('../../font/plotter/iso-3098-cyrillic.gfont?url').then((module) => module.default),
  'opengost-a.gfont': () => import('../../font/plotter/opengost-a.gfont?url').then((module) => module.default),
  'opengost-b.gfont': () => import('../../font/plotter/opengost-b.gfont?url').then((module) => module.default),
  'unicode-stroke.gfont': () => import('../../font/plotter/unicode-stroke.gfont?url').then((module) => module.default),
  'hershey-cyrillic.gfont': () => import('../../font/plotter/hershey-cyrillic.gfont?url').then((module) => module.default),
}

function findEndOfCentralDirectory(view) {
  const minimum = Math.max(0, view.byteLength - 0xffff - 22)
  for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) return offset
  }
  throw new Error('В файле не найден ZIP-каталог шрифта.')
}

async function inflateRaw(bytes) {
  if (!globalThis.DecompressionStream) {
    throw new Error('Браузер не поддерживает распаковку .gfont. Откройте OpenHand в Chrome или Edge.')
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function parseGlyph(bytes, expectedCodePoint) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.byteLength < 10) throw new Error('Повреждённая глифа в .gfont.')

  let offset = 0
  const codePoint = view.getUint16(offset, false)
  offset += 2
  const floatCount = view.getUint32(offset, false)
  offset += 4
  if (floatCount % 2 !== 0 || floatCount > 2_000_000 || offset + floatCount * 4 + 4 > view.byteLength) {
    throw new Error('Некорректные координаты глифы.')
  }

  const points = []
  for (let index = 0; index < floatCount; index += 2) {
    points.push({ x: view.getFloat32(offset, false), y: view.getFloat32(offset + 4, false) })
    offset += 8
  }

  const flagCount = view.getUint32(offset, false)
  offset += 4
  if (flagCount > points.length || offset + flagCount > view.byteLength) {
    throw new Error('Некорректные флаги штрихов глифы.')
  }
  const flags = Array.from(new Uint8Array(bytes.buffer, bytes.byteOffset + offset, flagCount))

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  for (const point of points) {
    minX = Math.min(minX, point.x)
    maxX = Math.max(maxX, point.x)
    minY = Math.min(minY, point.y)
    maxY = Math.max(maxY, point.y)
  }

  return {
    codePoint: codePoint || expectedCodePoint,
    points,
    flags,
    bounds: points.length ? { minX, maxX, minY, maxY } : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  }
}

export class GFont {
  bytes: Uint8Array
  view: DataView
  name: string
  entries: Map<number, { method: number; compressedSize: number; uncompressedSize: number; localOffset: number }>
  cache: Map<number, any>

  constructor(arrayBuffer: ArrayBuffer, name = 'Шрифт .gfont') {
    this.bytes = new Uint8Array(arrayBuffer)
    this.view = new DataView(arrayBuffer)
    this.name = name
    this.entries = new Map()
    this.cache = new Map()
    this.readDirectory()
  }

  readDirectory() {
    const eocd = findEndOfCentralDirectory(this.view)
    const entryCount = this.view.getUint16(eocd + 10, true)
    const directorySize = this.view.getUint32(eocd + 12, true)
    const recordedDirectoryOffset = this.view.getUint32(eocd + 16, true)
    const zipBase = eocd - directorySize - recordedDirectoryOffset
    let offset = zipBase + recordedDirectoryOffset

    for (let index = 0; index < entryCount; index += 1) {
      if (this.view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
        throw new Error('Повреждённый каталог .gfont.')
      }
      const method = this.view.getUint16(offset + 10, true)
      const compressedSize = this.view.getUint32(offset + 20, true)
      const uncompressedSize = this.view.getUint32(offset + 24, true)
      const nameLength = this.view.getUint16(offset + 28, true)
      const extraLength = this.view.getUint16(offset + 30, true)
      const commentLength = this.view.getUint16(offset + 32, true)
      const localOffset = zipBase + this.view.getUint32(offset + 42, true)
      const nameBytes = this.bytes.subarray(offset + 46, offset + 46 + nameLength)
      const entryName = new TextDecoder().decode(nameBytes)
      if (/^\d+$/.test(entryName)) {
        this.entries.set(Number(entryName), { method, compressedSize, uncompressedSize, localOffset })
      }
      offset += 46 + nameLength + extraLength + commentLength
    }
  }

  has(codePoint) {
    return this.entries.has(codePoint)
  }

  async getGlyph(codePoint) {
    if (this.cache.has(codePoint)) return this.cache.get(codePoint)
    const entry = this.entries.get(codePoint)
    if (!entry) return null

    const { localOffset } = entry
    if (this.view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`Повреждена запись символа U+${codePoint.toString(16).toUpperCase()}.`)
    }
    const nameLength = this.view.getUint16(localOffset + 26, true)
    const extraLength = this.view.getUint16(localOffset + 28, true)
    const dataOffset = localOffset + 30 + nameLength + extraLength
    const compressed = this.bytes.subarray(dataOffset, dataOffset + entry.compressedSize)
    let decoded
    if (entry.method === 0) decoded = compressed
    else if (entry.method === 8) decoded = await inflateRaw(compressed)
    else throw new Error(`Метод сжатия ZIP ${entry.method} не поддерживается.`)
    if (entry.uncompressedSize && decoded.byteLength !== entry.uncompressedSize) {
      throw new Error('Размер распакованной глифы не совпал с каталогом.')
    }
    const glyph = parseGlyph(decoded, codePoint)
    this.cache.set(codePoint, glyph)
    return glyph
  }
}

export async function loadGFont(source: ArrayBuffer | Blob, name?: string) {
  const buffer = source instanceof ArrayBuffer ? source : await source.arrayBuffer()
  return new GFont(buffer, name || (source instanceof File ? source.name : undefined))
}

function transformGlyph(glyph: any, codePoint: number, transform: { width?: number; slant?: number; wobble?: number } = {}) {
  const width = transform.width ?? 1
  const slant = transform.slant ?? 0
  const wobble = transform.wobble ?? 0
  const originX = glyph.bounds.minX
  const baseline = glyph.bounds.maxY
  const seed = (codePoint % 97) * 0.173
  const points = glyph.points.map((point) => ({
    x: originX + (point.x - originX) * width - (point.y - baseline) * slant
      + wobble * Math.sin((point.y - baseline) * 0.035 + seed),
    y: point.y,
  }))
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  return {
    ...glyph,
    points,
    flags: [...glyph.flags],
    bounds: points.length
      ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
      : { minX: 0, maxX: 0, minY: 0, maxY: 0 },
  }
}

function createVariantFont(base, option) {
  const cache = new Map()
  return {
    name: option.label,
    entries: base.entries,
    has: (codePoint) => base.has(codePoint),
    async getGlyph(codePoint) {
      if (cache.has(codePoint)) return cache.get(codePoint)
      const glyph = await base.getGlyph(codePoint)
      const transformed = glyph ? transformGlyph(glyph, codePoint, option.transform) : null
      cache.set(codePoint, transformed)
      return transformed
    },
  }
}

async function loadBundledSource(filename) {
  if (bundledSourceCache.has(filename)) return bundledSourceCache.get(filename)
  const loader = BUNDLED_GFONT_LOADERS[filename]
  if (!loader) throw new Error(`Встроенный шрифт «${filename}» не найден в сборке.`)
  const pending = loader()
    .then((url) => fetch(url))
    .then((response) => {
      // WKURLSchemeHandler returns a non-HTTP response with status 0.
      if (!response.ok && response.status !== 0) {
        throw new Error(`HTTP ${response.status}`)
      }
      return response.arrayBuffer()
    })
    .then((buffer) => loadGFont(buffer, filename))
  bundledSourceCache.set(filename, pending)
  return pending
}

export async function loadBundledGFont(id = BUILTIN_GFONT_OPTIONS[0].id) {
  const option = BUILTIN_GFONT_OPTIONS.find((item) => item.id === id) || BUILTIN_GFONT_OPTIONS[0]
  try {
    const base = await loadBundledSource(option.source)
    return createVariantFont(base, option)
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason)
    throw new Error(`Не удалось открыть встроенный шрифт «${option.label}»: ${message}`)
  }
}
