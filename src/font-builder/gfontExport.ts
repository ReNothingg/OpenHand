const encoder = new TextEncoder()

type FontPoint = { x: number; y: number }
type FontStroke = FontPoint[]

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(view, offset, value, littleEndian = true) {
  view.setUint16(offset, value, littleEndian)
}

function writeUint32(view, offset, value, littleEndian = true) {
  view.setUint32(offset, value, littleEndian)
}

export function encodeGlyph(codePoint, strokes) {
  const points = strokes.flat()
  const byteLength = 2 + 4 + points.length * 8 + 4 + points.length
  const buffer = new ArrayBuffer(byteLength)
  const view = new DataView(buffer)
  let offset = 0

  writeUint16(view, offset, codePoint, false)
  offset += 2
  writeUint32(view, offset, points.length * 2, false)
  offset += 4

  strokes.forEach((stroke) => {
    stroke.forEach((point) => {
      view.setFloat32(offset, point.x, false)
      view.setFloat32(offset + 4, point.y, false)
      offset += 8
    })
  })

  writeUint32(view, offset, points.length, false)
  offset += 4
  strokes.forEach((stroke) => {
    stroke.forEach((_, index) => {
      view.setUint8(offset, index === 0 ? 0 : 1)
      offset += 1
    })
  })

  return new Uint8Array(buffer)
}

function concatBytes(chunks) {
  const size = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const result = new Uint8Array(size)
  let offset = 0
  chunks.forEach((chunk) => {
    result.set(chunk, offset)
    offset += chunk.byteLength
  })
  return result
}

export function createGFontBlob(glyphs: Record<string, FontStroke[]>) {
  const localChunks: Uint8Array[] = []
  const centralChunks: Uint8Array[] = []
  let localOffset = 0

  Object.entries(glyphs as Record<string, FontStroke[]>)
    .filter(([, strokes]) => strokes?.some((stroke) => stroke.length > 1))
    .sort(([left], [right]) => Number(left) - Number(right))
    .forEach(([character, strokes]) => {
      const codePoint = character.codePointAt(0)
      const name = encoder.encode(String(codePoint))
      const data = encodeGlyph(codePoint, strokes.filter((stroke) => stroke.length > 1))
      const checksum = crc32(data)

      const localHeader = new Uint8Array(30 + name.length)
      const localView = new DataView(localHeader.buffer)
      writeUint32(localView, 0, 0x04034b50)
      writeUint16(localView, 4, 20)
      writeUint16(localView, 6, 0)
      writeUint16(localView, 8, 0)
      writeUint32(localView, 14, checksum)
      writeUint32(localView, 18, data.length)
      writeUint32(localView, 22, data.length)
      writeUint16(localView, 26, name.length)
      localHeader.set(name, 30)
      localChunks.push(localHeader, data)

      const centralHeader = new Uint8Array(46 + name.length)
      const centralView = new DataView(centralHeader.buffer)
      writeUint32(centralView, 0, 0x02014b50)
      writeUint16(centralView, 4, 20)
      writeUint16(centralView, 6, 20)
      writeUint16(centralView, 8, 0)
      writeUint16(centralView, 10, 0)
      writeUint32(centralView, 16, checksum)
      writeUint32(centralView, 20, data.length)
      writeUint32(centralView, 24, data.length)
      writeUint16(centralView, 28, name.length)
      writeUint32(centralView, 42, localOffset)
      centralHeader.set(name, 46)
      centralChunks.push(centralHeader)

      localOffset += localHeader.length + data.length
    })

  const localData = concatBytes(localChunks)
  const centralData = concatBytes(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  const entryCount = centralChunks.length
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 8, entryCount)
  writeUint16(endView, 10, entryCount)
  writeUint32(endView, 12, centralData.length)
  writeUint32(endView, 16, localData.length)

  return new Blob([localData, centralData, end], { type: 'application/octet-stream' })
}

export function safeFontFilename(value) {
  const normalized = value.trim().replace(/[^\p{L}\p{N}_-]+/gu, '-').replace(/^-+|-+$/g, '')
  return `${normalized || 'my-openhand-font'}.gfont`
}
