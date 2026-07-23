const SHEET = Object.freeze({
  width: 1200,
  height: 1700,
  columns: 8,
  insetX: 40,
  insetTop: 80,
  insetBottom: 40,
})

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function distance(left, right) {
  return Math.hypot(left.x - right.x, left.y - right.y)
}

function simplify(points, tolerance = 1.25) {
  if (points.length < 3) return points
  const start = points[0]
  const end = points.at(-1)
  const length = Math.max(0.0001, distance(start, end))
  let furthest = 0
  let furthestIndex = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    const point = points[index]
    const area = Math.abs(
      (end.x - start.x) * (start.y - point.y) -
      (start.x - point.x) * (end.y - start.y),
    )
    const perpendicular = area / length
    if (perpendicular > furthest) {
      furthest = perpendicular
      furthestIndex = index
    }
  }
  if (furthest <= tolerance) return [start, end]
  return [
    ...simplify(points.slice(0, furthestIndex + 1), tolerance).slice(0, -1),
    ...simplify(points.slice(furthestIndex), tolerance),
  ]
}

function otsuThreshold(grayscale) {
  const histogram = new Uint32Array(256)
  grayscale.forEach((value) => { histogram[value] += 1 })
  const total = grayscale.length
  let sum = 0
  for (let index = 0; index < 256; index += 1) sum += index * histogram[index]
  let backgroundWeight = 0
  let backgroundSum = 0
  let bestVariance = -1
  let threshold = 128
  for (let index = 0; index < 256; index += 1) {
    backgroundWeight += histogram[index]
    if (!backgroundWeight) continue
    const foregroundWeight = total - backgroundWeight
    if (!foregroundWeight) break
    backgroundSum += index * histogram[index]
    const backgroundMean = backgroundSum / backgroundWeight
    const foregroundMean = (sum - backgroundSum) / foregroundWeight
    const variance = backgroundWeight * foregroundWeight * (backgroundMean - foregroundMean) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      threshold = index
    }
  }
  return clamp(threshold, 72, 168)
}

function removeSmallComponents(binary, width, height, minimum = 5) {
  const visited = new Uint8Array(binary.length)
  const queue = new Int32Array(binary.length)
  const neighbors = [-1, 1, -width, width, -width - 1, -width + 1, width - 1, width + 1]
  for (let start = 0; start < binary.length; start += 1) {
    if (!binary[start] || visited[start]) continue
    let head = 0
    let tail = 1
    queue[0] = start
    visited[start] = 1
    while (head < tail) {
      const current = queue[head++]
      const x = current % width
      const y = Math.floor(current / width)
      for (const offset of neighbors) {
        const next = current + offset
        if (next < 0 || next >= binary.length || visited[next] || !binary[next]) continue
        const nextX = next % width
        const nextY = Math.floor(next / width)
        if (Math.abs(nextX - x) > 1 || Math.abs(nextY - y) > 1) continue
        visited[next] = 1
        queue[tail++] = next
      }
    }
    if (tail < minimum) {
      for (let index = 0; index < tail; index += 1) binary[queue[index]] = 0
    }
  }
}

function skeletonize(binary, width, height) {
  const output = new Uint8Array(binary)
  const marked = new Uint8Array(binary.length)
  const at = (x, y) => output[y * width + x]
  let changed = true
  let iteration = 0
  while (changed && iteration < 90) {
    changed = false
    iteration += 1
    for (let pass = 0; pass < 2; pass += 1) {
      marked.fill(0)
      for (let y = 1; y < height - 1; y += 1) {
        for (let x = 1; x < width - 1; x += 1) {
          const index = y * width + x
          if (!output[index]) continue
          const p2 = at(x, y - 1)
          const p3 = at(x + 1, y - 1)
          const p4 = at(x + 1, y)
          const p5 = at(x + 1, y + 1)
          const p6 = at(x, y + 1)
          const p7 = at(x - 1, y + 1)
          const p8 = at(x - 1, y)
          const p9 = at(x - 1, y - 1)
          const ring = [p2, p3, p4, p5, p6, p7, p8, p9, p2]
          const neighbors = ring.slice(0, 8).reduce((sum, value) => sum + value, 0)
          const transitions = ring.slice(0, 8).reduce(
            (sum, value, ringIndex) => sum + (value === 0 && ring[ringIndex + 1] === 1 ? 1 : 0),
            0,
          )
          if (neighbors < 2 || neighbors > 6 || transitions !== 1) continue
          const firstConstraint = pass === 0 ? p2 * p4 * p6 : p2 * p4 * p8
          const secondConstraint = pass === 0 ? p4 * p6 * p8 : p2 * p6 * p8
          if (!firstConstraint && !secondConstraint) marked[index] = 1
        }
      }
      for (let index = 0; index < marked.length; index += 1) {
        if (!marked[index]) continue
        output[index] = 0
        changed = true
      }
    }
  }
  return output
}

function traceSkeleton(binary, width, height) {
  const offsets = [
    [-1, -1], [0, -1], [1, -1], [1, 0],
    [1, 1], [0, 1], [-1, 1], [-1, 0],
  ]
  const points = []
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      if (binary[y * width + x]) points.push({ x, y, index: y * width + x })
    }
  }
  const neighborsFor = (point) => offsets
    .map(([dx, dy]) => ({ x: point.x + dx, y: point.y + dy, index: (point.y + dy) * width + point.x + dx }))
    .filter((candidate) => binary[candidate.index])
  const edgeKey = (left, right) => left < right ? `${left}:${right}` : `${right}:${left}`
  const used = new Set()
  const strokes = []
  const walk = (start, first) => {
    const stroke = [start]
    let previous = start
    let current = first
    used.add(edgeKey(start.index, first.index))
    while (current) {
      stroke.push(current)
      const candidates = neighborsFor(current).filter((candidate) => (
        candidate.index !== previous.index && !used.has(edgeKey(current.index, candidate.index))
      ))
      if (candidates.length !== 1) break
      const next = candidates[0]
      used.add(edgeKey(current.index, next.index))
      previous = current
      current = next
    }
    return stroke
  }
  const nodes = points.filter((point) => neighborsFor(point).length !== 2)
  for (const node of nodes) {
    for (const neighbor of neighborsFor(node)) {
      if (used.has(edgeKey(node.index, neighbor.index))) continue
      const stroke = walk(node, neighbor)
      if (stroke.length > 2) strokes.push(stroke)
    }
  }
  for (const point of points) {
    for (const neighbor of neighborsFor(point)) {
      if (used.has(edgeKey(point.index, neighbor.index))) continue
      const stroke = walk(point, neighbor)
      if (stroke.length > 2) strokes.push(stroke)
    }
  }
  return strokes
}

function vectorizeImageData(imageData, options = {}) {
  const { width, height, data } = imageData
  const grayscale = new Uint8Array(width * height)
  for (let index = 0; index < grayscale.length; index += 1) {
    const offset = index * 4
    grayscale[index] = Math.round(data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114)
  }
  const threshold = Math.min(150, otsuThreshold(grayscale) + Number(options.thresholdOffset || 0))
  const binary = new Uint8Array(grayscale.length)
  for (let index = 0; index < binary.length; index += 1) {
    binary[index] = grayscale[index] < threshold ? 1 : 0
  }
  const border = Math.max(2, Math.round(Math.min(width, height) * 0.035))
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x < border || y < border || x >= width - border || y >= height - border) binary[y * width + x] = 0
    }
  }
  removeSmallComponents(binary, width, height, Math.max(4, Math.round(width * height * 0.00035)))
  const skeleton = skeletonize(binary, width, height)
  const traced = traceSkeleton(skeleton, width, height)
    .map((stroke) => simplify(stroke, 1.15))
    .filter((stroke) => stroke.length > 1)
  const allPoints = traced.flat()
  if (!allPoints.length) return []
  const minX = Math.min(...allPoints.map((point) => point.x))
  const maxX = Math.max(...allPoints.map((point) => point.x))
  const minY = Math.min(...allPoints.map((point) => point.y))
  const maxY = Math.max(...allPoints.map((point) => point.y))
  const inkHeight = Math.max(1, maxY - minY)
  const inkWidth = Math.max(1, maxX - minX)
  const targetHeight = options.targetHeight || 300
  const targetWidth = options.targetWidth || 330
  const scale = Math.min(targetHeight / inkHeight, targetWidth / inkWidth)
  const baseline = Number.isFinite(options.baseline)
    ? options.baseline
    : maxY
  return traced.map((stroke) => stroke.map((point) => ({
    x: Math.round((point.x - minX) * scale * 10) / 10,
    y: Math.round((point.y - baseline) * scale * 10) / 10,
  })))
}

async function bitmapFromFile(file) {
  if ('createImageBitmap' in window) return createImageBitmap(file)
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise((resolve, reject) => {
      image.onload = resolve
      image.onerror = reject
      image.src = url
    })
    return image
  } finally {
    URL.revokeObjectURL(url)
  }
}

function drawScaled(bitmap, maximum = 1800) {
  const sourceWidth = bitmap.width || bitmap.naturalWidth
  const sourceHeight = bitmap.height || bitmap.naturalHeight
  const scale = Math.min(1, maximum / Math.max(sourceWidth, sourceHeight))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(sourceWidth * scale))
  canvas.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  return canvas
}

function detectMarkers(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
  const width = canvas.width
  const height = canvas.height
  const dark = new Uint8Array(width * height)
  for (let index = 0; index < dark.length; index += 1) {
    const offset = index * 4
    const light = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
    dark[index] = light < 72 ? 1 : 0
  }
  const visited = new Uint8Array(dark.length)
  const queue = new Int32Array(dark.length)
  const candidates = []
  for (let start = 0; start < dark.length; start += 1) {
    if (!dark[start] || visited[start]) continue
    let head = 0
    let tail = 1
    let minX = start % width
    let maxX = minX
    let minY = Math.floor(start / width)
    let maxY = minY
    queue[0] = start
    visited[start] = 1
    while (head < tail) {
      const current = queue[head++]
      const x = current % width
      const y = Math.floor(current / width)
      minX = Math.min(minX, x)
      maxX = Math.max(maxX, x)
      minY = Math.min(minY, y)
      maxY = Math.max(maxY, y)
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nextX = x + dx
        const nextY = y + dy
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue
        const next = nextY * width + nextX
        if (!dark[next] || visited[next]) continue
        visited[next] = 1
        queue[tail++] = next
      }
    }
    const componentWidth = maxX - minX + 1
    const componentHeight = maxY - minY + 1
    const area = componentWidth * componentHeight
    const fill = tail / area
    if (
      area >= width * height * 0.00008 &&
      area <= width * height * 0.018 &&
      componentWidth / componentHeight > 0.62 &&
      componentWidth / componentHeight < 1.62 &&
      fill > 0.42
    ) {
      candidates.push({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, area, fill })
    }
  }
  if (candidates.length < 4) return null
  const targets = [
    { x: 0, y: 0 },
    { x: width, y: 0 },
    { x: width, y: height },
    { x: 0, y: height },
  ]
  const selected = []
  for (const target of targets) {
    const available = candidates
      .filter((candidate) => !selected.includes(candidate))
      .sort((left, right) => distance(left, target) - distance(right, target))
    if (!available.length) return null
    selected.push(available[0])
  }
  return selected
}

function warpSheet(source, corners) {
  const canvas = document.createElement('canvas')
  canvas.width = SHEET.width
  canvas.height = SHEET.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const sourceContext = source.getContext('2d', { willReadFrequently: true })
  const sourceData = sourceContext.getImageData(0, 0, source.width, source.height)
  const output = context.createImageData(canvas.width, canvas.height)
  const [topLeft, topRight, bottomRight, bottomLeft] = corners
  for (let y = 0; y < canvas.height; y += 1) {
    const v = y / Math.max(1, canvas.height - 1)
    const leftX = topLeft.x + (bottomLeft.x - topLeft.x) * v
    const leftY = topLeft.y + (bottomLeft.y - topLeft.y) * v
    const rightX = topRight.x + (bottomRight.x - topRight.x) * v
    const rightY = topRight.y + (bottomRight.y - topRight.y) * v
    for (let x = 0; x < canvas.width; x += 1) {
      const u = x / Math.max(1, canvas.width - 1)
      const sourceX = clamp(Math.round(leftX + (rightX - leftX) * u), 0, source.width - 1)
      const sourceY = clamp(Math.round(leftY + (rightY - leftY) * u), 0, source.height - 1)
      const sourceOffset = (sourceY * source.width + sourceX) * 4
      const outputOffset = (y * canvas.width + x) * 4
      output.data[outputOffset] = sourceData.data[sourceOffset]
      output.data[outputOffset + 1] = sourceData.data[sourceOffset + 1]
      output.data[outputOffset + 2] = sourceData.data[sourceOffset + 2]
      output.data[outputOffset + 3] = 255
    }
  }
  context.putImageData(output, 0, 0)
  return canvas
}

function tightlyCropToSheet(source) {
  const canvas = document.createElement('canvas')
  canvas.width = SHEET.width
  canvas.height = SHEET.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export function createPhotoTemplateSvg(characters) {
  const outerWidth = 1400
  const outerHeight = 1900
  const offsetX = 100
  const offsetY = 100
  const rows = Math.ceil(characters.length / SHEET.columns)
  const gridWidth = SHEET.width - SHEET.insetX * 2
  const gridHeight = SHEET.height - SHEET.insetTop - SHEET.insetBottom
  const cellWidth = gridWidth / SHEET.columns
  const cellHeight = gridHeight / rows
  const cells = characters.map((character, index) => {
    const column = index % SHEET.columns
    const row = Math.floor(index / SHEET.columns)
    const x = offsetX + SHEET.insetX + column * cellWidth
    const y = offsetY + SHEET.insetTop + row * cellHeight
    const baseline = y + cellHeight * 0.73
    const escaped = character === '&' ? '&amp;' : character === '<' ? '&lt;' : character
    return `
      <rect x="${x}" y="${y}" width="${cellWidth}" height="${cellHeight}" fill="none" stroke="#dbe4ee" stroke-width="1"/>
      <line x1="${x + 8}" y1="${baseline}" x2="${x + cellWidth - 8}" y2="${baseline}" stroke="#bfdbfe" stroke-width="1"/>
      <text x="${x + 7}" y="${y + 15}" fill="#c5ced8" font-family="Arial, sans-serif" font-size="12">${escaped}</text>
    `
  }).join('')
  const markers = [
    [offsetX, offsetY],
    [offsetX + SHEET.width, offsetY],
    [offsetX + SHEET.width, offsetY + SHEET.height],
    [offsetX, offsetY + SHEET.height],
  ].map(([x, y]) => `<rect x="${x - 22}" y="${y - 22}" width="44" height="44" fill="#000"/>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 ${outerWidth} ${outerHeight}">
    <rect width="100%" height="100%" fill="#fff"/>
    <text x="100" y="54" fill="#111827" font-family="Arial, sans-serif" font-size="24" font-weight="700">OpenHand — бланк почерка</text>
    <text x="100" y="78" fill="#64748b" font-family="Arial, sans-serif" font-size="14">Пишите внутри клеток тёмной ручкой. Не закрашивайте четыре чёрные метки.</text>
    ${markers}
    ${cells}
  </svg>`
}

export async function vectorizeSinglePhoto(file) {
  const bitmap = await bitmapFromFile(file)
  const canvas = drawScaled(bitmap, 900)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  return vectorizeImageData(context.getImageData(0, 0, canvas.width, canvas.height))
}

export async function vectorizePhotoSheet(file, characters, onProgress = () => {}) {
  const bitmap = await bitmapFromFile(file)
  const source = drawScaled(bitmap, 1800)
  onProgress({ phase: 'markers', progress: 0.08 })
  const corners = detectMarkers(source)
  const sheet = corners ? warpSheet(source, corners) : tightlyCropToSheet(source)
  const rows = Math.ceil(characters.length / SHEET.columns)
  const gridWidth = SHEET.width - SHEET.insetX * 2
  const gridHeight = SHEET.height - SHEET.insetTop - SHEET.insetBottom
  const cellWidth = gridWidth / SHEET.columns
  const cellHeight = gridHeight / rows
  const context = sheet.getContext('2d', { willReadFrequently: true })
  const glyphs = {}
  for (let index = 0; index < characters.length; index += 1) {
    const column = index % SHEET.columns
    const row = Math.floor(index / SHEET.columns)
    const x = Math.round(SHEET.insetX + column * cellWidth + 4)
    const y = Math.round(SHEET.insetTop + row * cellHeight + cellHeight * 0.16)
    const width = Math.max(8, Math.round(cellWidth - 8))
    const height = Math.max(8, Math.round(cellHeight * 0.8 - 4))
    const imageData = context.getImageData(x, y, width, height)
    const baseline = cellHeight * (0.73 - 0.16)
    const strokes = vectorizeImageData(imageData, {
      baseline,
      targetHeight: 310,
      targetWidth: 345,
    })
    if (strokes.length) glyphs[characters[index]] = strokes
    if (index % 4 === 0 || index === characters.length - 1) {
      onProgress({ phase: 'glyphs', progress: 0.1 + (index + 1) / characters.length * 0.9 })
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }
  }
  return {
    glyphs,
    markerCorrection: Boolean(corners),
  }
}
