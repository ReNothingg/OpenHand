import { layoutFormula } from './mathLayout.js'
import {
  PLOTTER_ALIGN_MARKS,
  PLOTTER_CALLOUT_MARKS,
  PLOTTER_CONTROL_MARKS,
  PLOTTER_FORMULA_END,
  PLOTTER_FORMULA_START,
  PLOTTER_HEADING_MARKS,
  PLOTTER_MARKS,
  PLOTTER_QUOTE_MARKS,
  PLOTTER_SVG_END,
  PLOTTER_SVG_START,
} from './richText.js'

const PX_TO_MM = 25.4 / 96
const FONT_EM = 400

function seededRandom(seed, key) {
  let value = 2166136261
  const source = `${seed}:${key}`
  for (let index = 0; index < source.length; index += 1) {
    value ^= source.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  value += 0x6d2b79f5
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

export const DEFAULT_PLOTTER_CONFIG = {
  fontId: 'ifdream-original',
  profile: 'grbl',
  baudRate: 115200,
  feedRate: 1500,
  jogSpeed: 2500,
  jogDistance: 10,
  penMode: 'servo',
  penUp: 12000,
  penDown: 18000,
  zUp: 0,
  zDown: 2,
  zSpeed: 3000,
  laserPower: 1000,
  mmToSteps: 100,
  penDelay: 0.2,
  letterSpacing: 0.5,
  optimizePath: false,
}

export function pageSettingsToMillimeters(settings, metrics, evenPage = false, spreadSide = null) {
  const pageMargin = evenPage ? settings.marginLeftEven : settings.marginLeft
  const leftPixels = spreadSide === 'right'
    ? metrics.width / 2 + pageMargin
    : pageMargin
  return {
    pageWidth: metrics.width * PX_TO_MM,
    pageHeight: metrics.height * PX_TO_MM,
    left: leftPixels * PX_TO_MM,
    top: settings.marginTop * PX_TO_MM,
    right: (metrics.width - leftPixels - metrics.contentWidth) * PX_TO_MM,
    bottom: settings.marginBottom * PX_TO_MM,
    fontSize: settings.fontSize * PX_TO_MM,
    lineHeight: settings.fontSize * settings.lineHeight * PX_TO_MM,
  }
}

function splitGlyphStrokes(glyph, cursorX, baseline, scale, handwriting = null) {
  const strokes = []
  let stroke = null
  const variation = handwriting?.enabled ? Math.max(0, Math.min(100, Number(handwriting.variation) || 0)) : 0
  const variant = variation > 0 && seededRandom(handwriting.seed, `${handwriting.key}:active`) * 100 < variation
    ? Math.floor(seededRandom(handwriting.seed, `${handwriting.key}:variant`) * 4)
    : 0
  const rhythm = handwriting?.enabled ? Math.max(0, Math.min(100, Number(handwriting.rhythm) || 0)) : 0
  const fatigueProgress = Math.max(0, Math.min(1, Number(handwriting?.progress) || 0))
  const fatigue = handwriting?.fatigueEnabled
    ? Math.pow(fatigueProgress, 1.65) * Math.max(0, Math.min(100, Number(handwriting.fatigueStrength) || 0)) / 100
    : 0
  const authorSlant = Math.max(-18, Math.min(22, Number(handwriting?.authorSlant) || 0))
  const randomSlant = (seededRandom(handwriting?.seed, `${handwriting?.key}:slant`) - 0.5) * (variation * 0.0017 + rhythm * 0.0008)
  const slant = Math.tan((authorSlant + fatigue * 3.2) * Math.PI / 180) + randomSlant
  const authorWidth = Math.max(0.78, Math.min(1.22, Number(handwriting?.authorWidth || 100) / 100))
  const scaleX = authorWidth * (1 + (variant === 1 ? -0.025 : variant === 2 ? 0.035 : variant === 3 ? 0.012 : 0) + fatigue * 0.025)
  const scaleY = 1 + (seededRandom(handwriting?.seed, `${handwriting?.key}:height`) - 0.5) * variation * 0.0022
  const pressure = 1 + (seededRandom(handwriting?.seed, `${handwriting?.key}:pressure`) - 0.5) * Number(handwriting?.pressure || 0) * 0.012 - fatigue * 0.035
  const baselineDrift = fatigue * Math.max(0, Math.min(100, Number(handwriting?.authorBaseline) || 0)) * scale * 0.75
  const rhythmDrift = (seededRandom(handwriting?.seed, `${handwriting?.key}:rhythm-y`) - 0.5) * rhythm * scale * 0.22
  for (let index = 0; index < glyph.points.length; index += 1) {
    const source = glyph.points[index]
    const localY = source.y * scale * scaleY
    const localX = (source.x - glyph.bounds.minX) * scale * scaleX + localY * slant
    const point = {
      x: cursorX + localX,
      y: baseline + localY + baselineDrift + rhythmDrift,
    }
    if (glyph.flags[index] === 0 || !stroke) {
      stroke = [point]
      stroke.pressure = pressure
      strokes.push(stroke)
    } else {
      stroke.push(point)
    }
  }
  return strokes.filter((item) => item.length > 1)
}

const LETTER_PATTERN = /^\p{L}$/u

function glyphStrokeBounds(strokes) {
  const points = strokes.flat()
  if (!points.length) return null
  return {
    minX: Math.min(...points.map((point) => point.x)),
    maxX: Math.max(...points.map((point) => point.x)),
    minY: Math.min(...points.map((point) => point.y)),
    maxY: Math.max(...points.map((point) => point.y)),
  }
}

export function findCursiveAnchor(strokes, side, baseline, fontSize) {
  const bounds = glyphStrokeBounds(strokes)
  if (!bounds) return null

  const endpoints = strokes.flatMap((stroke, strokeIndex) => {
    if (stroke.length < 2) return []
    return [
      { point: stroke[0], neighbor: stroke[1], strokeIndex, atStart: true },
      { point: stroke.at(-1), neighbor: stroke.at(-2), strokeIndex, atStart: false },
    ]
  })
  if (!endpoints.length) return null

  const width = Math.max(fontSize * 0.12, bounds.maxX - bounds.minX)
  const edgeX = side === 'entry' ? bounds.minX : bounds.maxX
  const maximumInset = Math.max(fontSize * 0.055, width * 0.18)
  const targetY = baseline + fontSize * 0.015
  const candidates = endpoints
    .map((candidate) => {
      const edgeInset = Math.abs(candidate.point.x - edgeX)
      const baselineDistance = Math.abs(candidate.point.y - targetY)
      const tangentX = side === 'entry'
        ? candidate.neighbor.x - candidate.point.x
        : candidate.point.x - candidate.neighbor.x
      const tangentY = side === 'entry'
        ? candidate.neighbor.y - candidate.point.y
        : candidate.point.y - candidate.neighbor.y
      const tangentLength = Math.max(0.001, Math.hypot(tangentX, tangentY))
      const outwardness = tangentX / tangentLength
      const verticality = Math.abs(tangentY) / tangentLength
      const directionPenalty = Math.max(0, 0.22 - outwardness) * fontSize * 0.52
      return {
        ...candidate,
        edgeInset,
        baselineDistance,
        outwardness,
        verticality,
        score: edgeInset * 4.8
          + baselineDistance * 0.78
          + directionPenalty
          + verticality * fontSize * 0.07,
      }
    })
    .filter((candidate) => (
      candidate.edgeInset <= maximumInset &&
      candidate.baselineDistance <= fontSize * 0.4 &&
      candidate.outwardness >= -0.18
    ))
    .sort((left, right) => left.score - right.score)

  let anchor = candidates[0]
  if (!anchor) {
    const fallbackInset = Math.max(fontSize * 0.018, width * 0.045)
    anchor = strokes
      .flatMap((stroke, strokeIndex) => stroke.map((point, pointIndex) => ({
        point,
        strokeIndex,
        pointIndex,
        edgeInset: Math.abs(point.x - edgeX),
        baselineDistance: Math.abs(point.y - targetY),
      })))
      .filter((candidate) => (
        candidate.edgeInset <= fallbackInset &&
        candidate.baselineDistance <= fontSize * 0.36
      ))
      .sort((left, right) => (
        left.edgeInset * 5.5 + left.baselineDistance
        - (right.edgeInset * 5.5 + right.baselineDistance)
      ))[0]
    if (!anchor) return null
    return {
      ...anchor,
      outwardness: 0,
      verticality: 1,
      synthetic: true,
      quality: Math.max(0.24, 0.68 - (
        anchor.edgeInset / fallbackInset * 0.22
        + anchor.baselineDistance / (fontSize * 0.36) * 0.3
      )),
    }
  }
  return {
    ...anchor,
    quality: Math.max(0, 1 - (
      anchor.edgeInset / maximumInset * 0.5
      + anchor.baselineDistance / (fontSize * 0.4) * 0.32
      + Math.max(0, 0.22 - anchor.outwardness) * 0.18
    )),
  }
}

export function createCursiveConnector(start, end, fontSize, strength = 100) {
  if (!start || !end) return null
  const gap = end.x - start.x
  const verticalDistance = Math.abs(end.y - start.y)
  if (
    gap < fontSize * 0.018 ||
    gap > fontSize * 0.48 ||
    verticalDistance > fontSize * 0.3
  ) return null

  const normalizedStrength = Math.max(0, Math.min(100, Number(strength) || 0)) / 100
  const handle = Math.min(gap * 0.32, fontSize * 0.11)
  const bow = Math.min(gap * 0.09, fontSize * (0.008 + normalizedStrength * 0.018))
  const control1 = { x: start.x + handle, y: start.y + bow }
  const control2 = { x: end.x - handle, y: end.y + bow }
  const connector = []
  const steps = Math.max(5, Math.ceil(gap / Math.max(fontSize * 0.055, 0.15)))

  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const inverse = 1 - t
    connector.push({
      x: inverse ** 3 * start.x
        + 3 * inverse ** 2 * t * control1.x
        + 3 * inverse * t ** 2 * control2.x
        + t ** 3 * end.x,
      y: inverse ** 3 * start.y
        + 3 * inverse ** 2 * t * control1.y
        + 3 * inverse * t ** 2 * control2.y
        + t ** 3 * end.y,
    })
  }
  connector.pressure = 0.82 + normalizedStrength * 0.08
  return connector
}

export async function layoutText(text, font, page, config) {
  const scale = page.fontSize / FONT_EM
  const spaceWidth = page.fontSize * 0.46
  const letterSpacing = Number(config.letterSpacing || 0)
  const glyphs = new Map()
  const missing = new Set()

  const formulaPattern = new RegExp(`${PLOTTER_FORMULA_START}([\\s\\S]*?)${PLOTTER_FORMULA_END}`, 'g')
  const formulaSources = [...text.matchAll(formulaPattern)].map((match) => match[1])
  const svgPattern = new RegExp(`${PLOTTER_SVG_START}([\\s\\S]*?)${PLOTTER_SVG_END}`, 'g')
  const svgSources = [...text.matchAll(svgPattern)].map((match) => match[1])
  const plainText = text.replace(formulaPattern, '').replace(svgPattern, '')
  const plainCharacterCount = Math.max(1, Array.from(plainText).filter((char) => !/\s/u.test(char) && !PLOTTER_CONTROL_MARKS.has(char)).length)

  const getGlyph = async (char, recordMissing = true) => {
    if (glyphs.has(char)) return glyphs.get(char)
    const glyph = await font.getGlyph(char.codePointAt(0))
    if (glyph) glyphs.set(char, glyph)
    else if (recordMissing) missing.add(char)
    return glyph || null
  }

  for (const char of new Set(Array.from(plainText))) {
    if (/\s/u.test(char) || PLOTTER_CONTROL_MARKS.has(char)) continue
    await getGlyph(char)
  }

  const formulaLayouts = new Map()
  for (const source of formulaSources) {
    if (formulaLayouts.has(source)) continue
    const layout = await layoutFormula(source, {
      fontSize: page.fontSize,
      letterSpacing,
      getGlyph: (char) => getGlyph(char, false),
      handwriting: {
        enabled: Boolean(config.trueHandwriting),
        variation: config.glyphVariation,
        pressure: config.pressureVariation,
        seed: config.seed,
        authorSlant: config.authorSlant,
        authorWidth: config.authorWidth,
        rhythm: config.authorRhythm,
      },
    })
    layout.missing.forEach((char) => missing.add(char))
    formulaLayouts.set(source, layout)
  }
  const svgDrawings = new Map()
  svgSources.forEach((source) => {
    if (svgDrawings.has(source)) return
    try {
      const drawing = JSON.parse(decodeURIComponent(source))
      if (drawing?.width > 0 && drawing?.height > 0 && Array.isArray(drawing.strokes)) {
        svgDrawings.set(source, drawing)
      }
    } catch {
      // Повреждённый встроенный SVG просто не попадёт в траекторию.
    }
  })
  for (const drawing of svgDrawings.values()) {
    for (const label of drawing.texts || []) {
      for (const char of new Set(Array.from(label.value))) {
        if (!/\s/u.test(char) && !PLOTTER_CONTROL_MARKS.has(char)) await getGlyph(char)
      }
    }
  }

  const advanceFor = (char, textScale = 1) => {
    if (char === ' ' || char === '\t') return spaceWidth * (char === '\t' ? 4 : 1) * textScale
    const glyph = glyphs.get(char)
    const widthScale = Math.max(0.78, Math.min(1.22, Number(config.authorWidth || 100) / 100))
    return glyph
      ? Math.max(
        (glyph.bounds.maxX - glyph.bounds.minX) * scale * widthScale * textScale + letterSpacing,
        page.fontSize * 0.24 * textScale,
      )
      : spaceWidth * textScale
  }

  const strokes = []
  const activeDecorations = new Set()
  const decorationStarts = new Map()
  const activeTextStyles = new Set()
  let x = page.left
  let baseline = page.top + page.fontSize
  const maxX = page.pageWidth - Math.max(0, page.right)
  const maxY = page.pageHeight - page.bottom
  let clipped = false
  let overflowText = ''
  let activeCallout = null
  let activeQuote = null
  let activeHeadingLevel = 0
  let pendingHeadingGap = 0
  let glyphOccurrence = 0
  const quoteIndent = page.fontSize * 0.58
  const headingScales = [1, 1.62, 1.38, 1.2, 1.1, 1.02, 0.96]
  const headingScale = () => headingScales[activeHeadingLevel] || 1

  const markCalloutContent = () => {
    if (!activeCallout) return
    activeCallout.lastBaseline = baseline
    activeCallout.maxX = Math.max(activeCallout.maxX, x)
  }

  const closeCallout = () => {
    if (!activeCallout) return
    const left = Math.max(0, page.left - 1.5)
    const right = Math.min(maxX, Math.max(activeCallout.maxX + 1.8, page.left + page.fontSize * 3))
    const top = Math.max(0, activeCallout.top)
    const bottom = Math.min(maxY, activeCallout.lastBaseline + page.fontSize * 0.3)
    if (bottom > top && right > left) {
      strokes.push(
        [{ x: left, y: top }, { x: right, y: top }],
        [{ x: right, y: top }, { x: right, y: bottom }],
        [{ x: right, y: bottom }, { x: left, y: bottom }],
        [{ x: left, y: bottom }, { x: left, y: top }],
      )
    }
    activeCallout = null
  }

  const markQuoteContent = () => {
    if (!activeQuote) return
    activeQuote.lastBaseline = baseline
  }

  const closeQuote = () => {
    if (!activeQuote) return
    const railX = page.left + page.fontSize * 0.09
    const top = activeQuote.top
    const bottom = Math.min(maxY, activeQuote.lastBaseline + page.fontSize * 0.16)
    const middle = (top + bottom) / 2
    const quoteX = railX + page.fontSize * 0.15
    const quoteY = top + page.fontSize * 0.16
    strokes.push(
      [
        { x: railX, y: top },
        { x: railX - page.fontSize * 0.025, y: middle },
        { x: railX + page.fontSize * 0.018, y: bottom },
      ],
      [
        { x: quoteX, y: quoteY },
        { x: quoteX - page.fontSize * 0.035, y: quoteY + page.fontSize * 0.13 },
        { x: quoteX + page.fontSize * 0.025, y: quoteY + page.fontSize * 0.19 },
      ],
      [
        { x: quoteX + page.fontSize * 0.16, y: quoteY },
        { x: quoteX + page.fontSize * 0.125, y: quoteY + page.fontSize * 0.13 },
        { x: quoteX + page.fontSize * 0.185, y: quoteY + page.fontSize * 0.19 },
      ],
    )
    activeQuote = null
  }

  const decorationStroke = (style, startX, endX) => {
    if (endX - startX < 0.15) return
    if (style === 'strike') {
      strokes.push([{ x: startX, y: baseline - page.fontSize * 0.34 }, { x: endX, y: baseline - page.fontSize * 0.34 }])
      return
    }
    if (style === 'double') {
      strokes.push(
        [{ x: startX, y: baseline + page.fontSize * 0.10 }, { x: endX, y: baseline + page.fontSize * 0.10 }],
        [{ x: startX, y: baseline + page.fontSize * 0.19 }, { x: endX, y: baseline + page.fontSize * 0.19 }],
      )
      return
    }
    if (style === 'wavy') {
      const width = endX - startX
      const steps = Math.max(4, Math.ceil(width / Math.max(0.7, page.fontSize * 0.16)))
      const y = baseline + page.fontSize * 0.14
      const amplitude = Math.max(0.28, page.fontSize * 0.055)
      strokes.push(Array.from({ length: steps + 1 }, (_, index) => ({
        x: startX + width * index / steps,
        y: y + Math.sin(index * Math.PI / 2) * amplitude,
      })))
      return
    }
    if (style === 'code') {
      const inset = page.fontSize * 0.08
      const top = baseline - page.fontSize * 0.82
      const bottom = baseline + page.fontSize * 0.16
      strokes.push([
        { x: startX - inset, y: bottom },
        { x: startX - inset, y: top },
        { x: endX + inset, y: top },
        { x: endX + inset, y: bottom },
      ])
      return
    }
    if (style === 'highlight') {
      const top = baseline - page.fontSize * 0.76
      const bottom = baseline + page.fontSize * 0.13
      strokes.push(
        [{ x: startX, y: top }, { x: endX, y: top }],
        [{ x: startX, y: bottom }, { x: endX, y: bottom }],
      )
      return
    }
    strokes.push([{ x: startX, y: baseline + page.fontSize * 0.14 }, { x: endX, y: baseline + page.fontSize * 0.14 }])
  }

  const applyTextStyles = (sourceStrokes, originBaseline = baseline) => {
    const italic = activeTextStyles.has('italic')
    const bold = activeTextStyles.has('bold')
    const primary = sourceStrokes.map((stroke) => {
      const styled = stroke.map((point) => ({
        x: point.x + (italic ? (originBaseline - point.y) * 0.29 : 0),
        y: point.y,
      }))
      styled.pressure = (stroke.pressure || 1) * (bold ? 1.18 : 1)
      return styled
    })
    if (!bold) return primary

    const offset = Math.max(0.09, Math.min(0.18, page.fontSize * 0.024))
    const reinforcement = primary.map((stroke) => {
      const reinforced = stroke.map((point) => ({ x: point.x + offset, y: point.y + offset * 0.12 }))
      reinforced.pressure = (stroke.pressure || 1) * 1.08
      return reinforced
    })
    return [...primary, ...reinforcement]
  }

  const closeLineDecorations = () => {
    activeDecorations.forEach((style) => decorationStroke(style, decorationStarts.get(style) ?? page.left, x))
  }

  const nextLine = () => {
    closeLineDecorations()
    x = page.left + (activeQuote ? quoteIndent : 0)
    baseline += page.lineHeight + pendingHeadingGap
    pendingHeadingGap = 0
    activeDecorations.forEach((style) => decorationStarts.set(style, x))
    if (baseline > maxY) clipped = true
  }

  const startMarks = new Map([
    [PLOTTER_MARKS.underlineStart, 'underline'],
    [PLOTTER_MARKS.doubleStart, 'double'],
    [PLOTTER_MARKS.wavyStart, 'wavy'],
    [PLOTTER_MARKS.strikeStart, 'strike'],
    [PLOTTER_MARKS.codeStart, 'code'],
    [PLOTTER_MARKS.highlightStart, 'highlight'],
  ])
  const endMarks = new Map([
    [PLOTTER_MARKS.underlineEnd, 'underline'],
    [PLOTTER_MARKS.doubleEnd, 'double'],
    [PLOTTER_MARKS.wavyEnd, 'wavy'],
    [PLOTTER_MARKS.strikeEnd, 'strike'],
    [PLOTTER_MARKS.codeEnd, 'code'],
    [PLOTTER_MARKS.highlightEnd, 'highlight'],
  ])
  const textStyleStarts = new Map([
    [PLOTTER_MARKS.boldStart, 'bold'],
    [PLOTTER_MARKS.italicStart, 'italic'],
  ])
  const textStyleEnds = new Map([
    [PLOTTER_MARKS.boldEnd, 'bold'],
    [PLOTTER_MARKS.italicEnd, 'italic'],
  ])
  const headingStarts = new Map([
    [PLOTTER_HEADING_MARKS.h1Start, 1],
    [PLOTTER_HEADING_MARKS.h2Start, 2],
    [PLOTTER_HEADING_MARKS.h3Start, 3],
    [PLOTTER_HEADING_MARKS.h4Start, 4],
    [PLOTTER_HEADING_MARKS.h5Start, 5],
    [PLOTTER_HEADING_MARKS.h6Start, 6],
  ])
  const headingEnds = new Map([
    [PLOTTER_HEADING_MARKS.h1End, 1],
    [PLOTTER_HEADING_MARKS.h2End, 2],
    [PLOTTER_HEADING_MARKS.h3End, 3],
    [PLOTTER_HEADING_MARKS.h4End, 4],
    [PLOTTER_HEADING_MARKS.h5End, 5],
    [PLOTTER_HEADING_MARKS.h6End, 6],
  ])
  const alignmentStarts = new Map([
    [PLOTTER_ALIGN_MARKS.leftStart, 'left'],
    [PLOTTER_ALIGN_MARKS.centerStart, 'center'],
    [PLOTTER_ALIGN_MARKS.rightStart, 'right'],
  ])
  const alignmentEnds = new Set([
    PLOTTER_ALIGN_MARKS.leftEnd,
    PLOTTER_ALIGN_MARKS.centerEnd,
    PLOTTER_ALIGN_MARKS.rightEnd,
  ])
  const widthForLine = (line) => {
    let measuredHeadingLevel = activeHeadingLevel
    return line
      .split(new RegExp(`(${PLOTTER_FORMULA_START}.*?${PLOTTER_FORMULA_END}|${PLOTTER_SVG_START}.*?${PLOTTER_SVG_END})`, 'u'))
      .filter(Boolean)
      .reduce((width, token) => {
        const measuredScale = headingScales[measuredHeadingLevel] || 1
        if (token.startsWith(PLOTTER_FORMULA_START) && token.endsWith(PLOTTER_FORMULA_END)) {
          const source = token.slice(PLOTTER_FORMULA_START.length, -PLOTTER_FORMULA_END.length)
          return width + (formulaLayouts.get(source)?.width || 0) * measuredScale
        }
        if (token.startsWith(PLOTTER_SVG_START) && token.endsWith(PLOTTER_SVG_END)) {
          return width + (maxX - page.left) * 0.84
        }
        return width + Array.from(token).reduce((total, char) => {
          if (headingStarts.has(char)) {
            measuredHeadingLevel = headingStarts.get(char)
            return total
          }
          if (headingEnds.has(char)) {
            measuredHeadingLevel = 0
            return total
          }
          return total + (PLOTTER_CONTROL_MARKS.has(char)
            ? 0
            : advanceFor(char, headingScales[measuredHeadingLevel] || 1))
        }, 0)
      }, 0)
  }
  let activeAlignment = 'left'

  const rawLines = text.replace(/\r/g, '').split('\n')
  for (let rawLineIndex = 0; rawLineIndex < rawLines.length; rawLineIndex += 1) {
    const rawLine = rawLines[rawLineIndex]
    Array.from(rawLine).forEach((char) => {
      if (alignmentStarts.has(char)) activeAlignment = alignmentStarts.get(char)
    })
    const endsAlignment = Array.from(rawLine).some((char) => alignmentEnds.has(char))
    const line = Array.from(rawLine).filter((char) => !alignmentStarts.has(char) && !alignmentEnds.has(char)).join('')
    const lineWidth = widthForLine(line)
    if (activeAlignment === 'center' && lineWidth < maxX - page.left) {
      x = page.left + (maxX - page.left - lineWidth) / 2
    } else if (activeAlignment === 'right' && lineWidth < maxX - page.left) {
      x = maxX - lineWidth
    } else {
      x = page.left
    }
    if (activeQuote) x += quoteIndent
    activeDecorations.forEach((style) => decorationStarts.set(style, x))
    const tokens = line.split(new RegExp(`(${PLOTTER_FORMULA_START}.*?${PLOTTER_FORMULA_END}|${PLOTTER_SVG_START}.*?${PLOTTER_SVG_END}|\\s+)`, 'u')).filter(Boolean)
    const preserveOverflow = (tokenIndex, charIndex = 0) => {
      if (overflowText) return
      const tokenChars = Array.from(tokens[tokenIndex] || '')
      const currentLine = [
        tokenChars.slice(charIndex).join(''),
        ...tokens.slice(tokenIndex + 1),
      ].join('')
      overflowText = [currentLine, ...rawLines.slice(rawLineIndex + 1)].join('\n')
    }
    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      const token = tokens[tokenIndex]
      if (clipped) break
      if (token.startsWith(PLOTTER_FORMULA_START) && token.endsWith(PLOTTER_FORMULA_END)) {
        const source = token.slice(PLOTTER_FORMULA_START.length, -PLOTTER_FORMULA_END.length)
        const formula = formulaLayouts.get(source)
        if (!formula) continue
        if (x > page.left && x + formula.width * headingScale() > maxX) {
          nextLine()
          if (clipped) {
            preserveOverflow(tokenIndex)
            break
          }
        }
        if (baseline + formula.descent > maxY) {
          clipped = true
          preserveOverflow(tokenIndex)
          break
        }
        const formulaStrokes = formula.strokes.map((stroke) => {
          const currentScale = headingScale()
          const placed = stroke.map((point) => ({
            x: x + point.x * currentScale,
            y: baseline + point.y * currentScale,
          }))
          if (stroke.pressure) placed.pressure = stroke.pressure
          return placed
        })
        strokes.push(...applyTextStyles(formulaStrokes))
        x += formula.width * headingScale()
        markCalloutContent()
        continue
      }
      if (token.startsWith(PLOTTER_SVG_START) && token.endsWith(PLOTTER_SVG_END)) {
        const source = token.slice(PLOTTER_SVG_START.length, -PLOTTER_SVG_END.length)
        const drawing = svgDrawings.get(source)
        if (!drawing) continue
        if (x > page.left) nextLine()
        const top = baseline - page.fontSize * 0.78
        const availableHeight = drawing.kind === 'table'
          ? maxY - top - page.lineHeight
          : Math.min(70, maxY - top - page.lineHeight)
        const availableWidth = (maxX - page.left) * 0.86
        const preferredScale = drawing.kind === 'table'
          ? page.fontSize * 0.8 / 22
          : Infinity
        const drawingScale = Math.min(
          availableWidth / drawing.width,
          availableHeight / drawing.height,
          preferredScale,
        )
        if (!Number.isFinite(drawingScale) || drawingScale <= 0) {
          clipped = true
          break
        }
        const drawingWidth = drawing.width * drawingScale
        const drawingHeight = drawing.height * drawingScale
        const drawingX = page.left + (maxX - page.left - drawingWidth) / 2
        strokes.push(...drawing.strokes.map((stroke) => stroke.map((point) => ({
          x: drawingX + point.x * drawingScale,
          y: top + point.y * drawingScale,
        }))))
        for (const label of drawing.texts || []) {
          const labelScale = label.size * drawingScale / FONT_EM
          const labelSpace = label.size * drawingScale * 0.46
          const labelAdvances = Array.from(label.value).map((char) => {
            if (/\s/u.test(char)) return labelSpace
            const glyph = glyphs.get(char)
            return glyph
              ? Math.max((glyph.bounds.maxX - glyph.bounds.minX) * labelScale + letterSpacing, label.size * drawingScale * 0.24)
              : labelSpace
          })
          const labelWidth = labelAdvances.reduce((total, advance) => total + advance, 0)
          let labelCursor = label.anchor === 'middle' ? -labelWidth / 2 : label.anchor === 'end' ? -labelWidth : 0
          const originX = drawingX + label.x * drawingScale
          const originY = top + label.y * drawingScale
          const cosine = Math.cos(label.angle)
          const sine = Math.sin(label.angle)
          Array.from(label.value).forEach((char, index) => {
            const glyph = glyphs.get(char)
            if (glyph) {
              strokes.push(...glyph.flags.reduce((glyphStrokes, flag, pointIndex) => {
                const sourcePoint = glyph.points[pointIndex]
                const localX = labelCursor + (sourcePoint.x - glyph.bounds.minX) * labelScale
                const localY = sourcePoint.y * labelScale
                const point = {
                  x: originX + localX * cosine - localY * sine,
                  y: originY + localX * sine + localY * cosine,
                }
                if (flag === 0 || !glyphStrokes.length) glyphStrokes.push([point])
                else glyphStrokes[glyphStrokes.length - 1].push(point)
                return glyphStrokes
              }, []).filter((stroke) => stroke.length > 1))
            }
            labelCursor += labelAdvances[index]
          })
        }
        x = drawingX + drawingWidth
        baseline = top + drawingHeight
        markCalloutContent()
        continue
      }
      if (/^\s+$/u.test(token)) {
        for (const char of token) {
          if (char === '\n') nextLine()
          else x += advanceFor(char, headingScale())
        }
        continue
      }
      const tokenWidth = Array.from(token).reduce((total, char) => total + (PLOTTER_CONTROL_MARKS.has(char) ? 0 : advanceFor(char)), 0)
      if (x > page.left && x + tokenWidth > maxX) {
        nextLine()
        if (clipped) {
          preserveOverflow(tokenIndex)
          break
        }
      }
      const tokenChars = Array.from(token)
      const tokenStartX = x
      let previousJoin = null
      for (let charIndex = 0; charIndex < tokenChars.length; charIndex += 1) {
        const char = tokenChars[charIndex]
        if (char === PLOTTER_CALLOUT_MARKS.start) {
          closeCallout()
          activeCallout = {
            top: baseline - page.fontSize * 0.82,
            lastBaseline: baseline,
            maxX: page.left,
          }
          continue
        }
        if (char === PLOTTER_CALLOUT_MARKS.end) {
          closeCallout()
          continue
        }
        if (char === PLOTTER_QUOTE_MARKS.start) {
          closeQuote()
          activeQuote = {
            top: baseline - page.fontSize * 0.79,
            lastBaseline: baseline,
          }
          x += quoteIndent
          continue
        }
        if (char === PLOTTER_QUOTE_MARKS.end) {
          closeQuote()
          continue
        }
        if (headingStarts.has(char)) {
          activeHeadingLevel = headingStarts.get(char)
          continue
        }
        if (headingEnds.has(char)) {
          const level = headingEnds.get(char)
          pendingHeadingGap = page.lineHeight * (level === 1 ? 0.18 : level === 2 ? 0.1 : 0.05)
          activeHeadingLevel = 0
          continue
        }
        if (startMarks.has(char)) {
          const style = startMarks.get(char)
          activeDecorations.add(style)
          decorationStarts.set(style, x)
          continue
        }
        if (textStyleStarts.has(char)) {
          activeTextStyles.add(textStyleStarts.get(char))
          continue
        }
        if (endMarks.has(char)) {
          const style = endMarks.get(char)
          decorationStroke(style, decorationStarts.get(style) ?? x, x)
          activeDecorations.delete(style)
          decorationStarts.delete(style)
          continue
        }
        if (textStyleEnds.has(char)) {
          activeTextStyles.delete(textStyleEnds.get(char))
          continue
        }
        const currentHeadingScale = headingScale()
        const advance = advanceFor(char, currentHeadingScale)
        if (x > page.left && x + advance > maxX) {
          nextLine()
          previousJoin = null
          if (clipped) {
            preserveOverflow(tokenIndex, charIndex)
            break
          }
        }
        if (clipped) break
        const glyph = glyphs.get(char)
        if (glyph) {
          const sourceGlyphStrokes = splitGlyphStrokes(glyph, x, baseline, scale * currentHeadingScale, {
            enabled: Boolean(config.trueHandwriting),
            variation: config.glyphVariation,
            pressure: config.pressureVariation,
            seed: config.seed,
            key: `${glyphOccurrence}:${char}`,
            authorSlant: config.authorSlant,
            authorWidth: config.authorWidth,
            rhythm: config.authorRhythm,
            authorBaseline: config.authorBaseline,
            fatigueEnabled: config.fatigueEnabled,
            fatigueStrength: config.fatigueStrength,
            progress: glyphOccurrence / plainCharacterCount,
          })
          const glyphStrokes = applyTextStyles(sourceGlyphStrokes)
          const primaryGlyphStrokes = glyphStrokes.slice(0, sourceGlyphStrokes.length)
          const isLetter = LETTER_PATTERN.test(char)
          const entryAnchor = isLetter
            ? findCursiveAnchor(primaryGlyphStrokes, 'entry', baseline, page.fontSize * currentHeadingScale)
            : null
          const exitAnchor = isLetter
            ? findCursiveAnchor(primaryGlyphStrokes, 'exit', baseline, page.fontSize * currentHeadingScale)
            : null
          const connectionChance = Math.max(0, Math.min(100, Number(config.connectionStrength) || 0))
          if (
            config.trueHandwriting &&
            previousJoin &&
            entryAnchor &&
            seededRandom(config.seed, `join:${glyphOccurrence}`) * 100 < connectionChance &&
            previousJoin.charIsLetter &&
            isLetter &&
            Math.min(previousJoin.anchor.quality, entryAnchor.quality) >= 0.22
          ) {
            const connector = createCursiveConnector(
              previousJoin.anchor.point,
              entryAnchor.point,
              page.fontSize * currentHeadingScale,
              connectionChance,
            )
            if (connector) strokes.push(...applyTextStyles([connector]))
          }
          if (
            config.trueHandwriting &&
            charIndex === 0 &&
            entryAnchor?.quality >= 0.35 &&
            seededRandom(config.seed, `lead:${glyphOccurrence}`) < 0.34
          ) {
            const start = entryAnchor.point
            const lead = [
              { x: start.x - page.fontSize * (0.08 + seededRandom(config.seed, `lead-width:${glyphOccurrence}`) * 0.08), y: start.y + page.fontSize * 0.05 },
              start,
            ]
            lead.pressure = 0.78
            strokes.push(lead)
          }
          strokes.push(...glyphStrokes)
          previousJoin = exitAnchor ? { anchor: exitAnchor, charIsLetter: isLetter } : null
          glyphOccurrence += 1
        } else {
          previousJoin = null
        }
        x += advance
        if (glyph || !/\s/u.test(char)) {
          markCalloutContent()
          markQuoteContent()
        }
      }
      if (
        config.trueHandwriting &&
        previousJoin &&
        previousJoin.anchor.quality >= 0.35 &&
        seededRandom(config.seed, `tail:${glyphOccurrence}`) < 0.3
      ) {
        const tailStart = previousJoin.anchor.point
        const tail = [
          tailStart,
          { x: tailStart.x + page.fontSize * 0.13, y: tailStart.y - page.fontSize * 0.025 },
        ]
        tail.pressure = 0.76
        strokes.push(tail)
      }
      if (
        config.trueHandwriting &&
        x > tokenStartX &&
        seededRandom(config.seed, `correction:${glyphOccurrence}:${token}`) * 100 < Number(config.correctionChance || 0)
      ) {
        const correction = [
          { x: tokenStartX - page.fontSize * 0.04, y: baseline - page.fontSize * 0.38 },
          { x: x + page.fontSize * 0.05, y: baseline - page.fontSize * 0.31 },
        ]
        correction.pressure = 1.08
        strokes.push(correction)
      }
    }
    if (rawLineIndex < rawLines.length - 1) {
      nextLine()
      if (clipped && !overflowText) {
        overflowText = rawLines.slice(rawLineIndex + 1).join('\n')
      }
    }
    else closeLineDecorations()
    if (endsAlignment) activeAlignment = 'left'
    if (clipped) break
  }
  closeCallout()
  closeQuote()

  return { strokes, missing: [...missing], clipped, overflowText }
}

export async function layoutBlocks(blocks, font, page, config) {
  const strokes = []
  const missing = new Set()
  const clippedItems = []
  let clipped = false

  for (const [index, block] of blocks.entries()) {
    const layout = block.layout || {
      x: 0,
      y: index * page.lineHeight / PX_TO_MM * 1.4,
      width: (page.pageWidth - page.left - page.right) / PX_TO_MM,
      height: page.lineHeight / PX_TO_MM * 1.5,
      rotation: 0,
      align: 'left',
      noWrap: false,
    }
    const left = page.left + Number(layout.x || 0) * PX_TO_MM
    const top = page.top + Number(layout.y || 0) * PX_TO_MM
    const width = Math.max(8, Number(layout.width || 240) * PX_TO_MM)
    const height = Math.max(page.lineHeight, Number(layout.height || 40) * PX_TO_MM)
    const alignment = ['left', 'center', 'right'].includes(layout.align) ? layout.align : 'left'
    const markedText = alignment === 'left'
      ? block.text
      : `${PLOTTER_ALIGN_MARKS[`${alignment}Start`]}${block.text}${PLOTTER_ALIGN_MARKS[`${alignment}End`]}`
    const blockPage = {
      ...page,
      left,
      top,
      right: layout.noWrap ? -page.pageWidth * 3 : page.pageWidth - left - width,
      bottom: Math.max(0, page.pageHeight - top - height),
    }
    const result = await layoutText(markedText, font, blockPage, { ...config, noWrap: layout.noWrap })
    result.missing.forEach((char) => missing.add(char))

    const angle = Number(layout.rotation || 0) * Math.PI / 180
    const cosine = Math.cos(angle)
    const sine = Math.sin(angle)
    const transformed = result.strokes.map((stroke) => {
      const next = stroke.map((point) => {
        const x = point.x - left
        const y = point.y - top
        return {
          x: left + x * cosine - y * sine,
          y: top + x * sine + y * cosine,
        }
      })
      next.pressure = stroke.pressure
      return next
    })
    const points = transformed.flat()
    const outsidePage = points.some((point) => (
      point.x < 0 || point.y < 0 || point.x > page.pageWidth || point.y > page.pageHeight
    ))
    const tolerance = page.fontSize * 0.28
    const outsideBlock = !layout.noWrap && points.some((point) => (
      point.x < left - tolerance || point.x > left + width + tolerance || point.y < top - tolerance || point.y > top + height + tolerance
    ))
    if (result.clipped || outsidePage || outsideBlock) {
      clipped = true
      clippedItems.push(block.label || `Блок ${index + 1}`)
    }
    strokes.push(...transformed.filter((stroke) => stroke.every((point) => (
      point.x >= 0 && point.y >= 0 && point.x <= page.pageWidth && point.y <= page.pageHeight
    ))))
  }

  return { strokes, missing: [...missing], clipped, clippedItems }
}

function number(value, digits = 3) {
  return Number(value.toFixed(digits)).toString()
}

function penCommand(up, config, pressure = 1) {
  const servoMax = config.profile === 'marlin' ? 180 : 32767
  const pressuredPenDown = Math.max(0, Math.min(
    servoMax,
    Number(config.penUp) + (Number(config.penDown) - Number(config.penUp)) * Math.max(0.72, Math.min(1.28, pressure)),
  ))
  if (config.profile === 'ebb') return `SP,${up ? 1 : 0},${Math.round(config.penDelay * 1000)}`
  if (config.profile === 'marlin') {
    if (config.penMode === 'stepper') return `G1G90Z${number(up ? config.zUp : config.zDown)}F${config.zSpeed}`
    if (config.penMode === 'estepper') return `G1G90E${number(up ? config.zUp : config.zDown)}F${config.zSpeed}`
    return `M280P0S${Math.round(up ? config.penUp : pressuredPenDown)}`
  }
  if (config.penMode === 'stepper') return `G1G90Z${number(up ? config.zUp : config.zDown)}F${config.zSpeed}`
  if (config.penMode === 'laser') return up ? 'M5' : `M3S${config.laserPower}`
  return `M3S${Math.round(up ? config.penUp : pressuredPenDown)}`
}

function buildEbbMove(from, to, speedMmMin, config, residue) {
  const scale = Number(config.mmToSteps)
  const exactX = (to.x - from.x) * scale + residue.x
  const exactY = (to.y - from.y) * scale + residue.y
  const stepsX = Math.trunc(exactX)
  const stepsY = Math.trunc(exactY)
  residue.x = exactX - stepsX
  residue.y = exactY - stepsY
  const speed = Math.min(Number(speedMmMin) / 60 * scale, 25000)
  const duration = Math.max(1, Math.round(Math.max(Math.abs(stepsX), Math.abs(stepsY)) / Math.max(1, speed) * 1000))
  return `XM,${duration},${stepsX},${stepsY}`
}

function strokeTravelDistance(strokes) {
  let current = { x: 0, y: 0 }
  let distance = 0
  for (const stroke of strokes) {
    if (stroke.length < 2) continue
    distance += Math.hypot(stroke[0].x - current.x, stroke[0].y - current.y)
    current = stroke.at(-1)
  }
  return distance
}

function reversedStroke(stroke) {
  const reversed = [...stroke].reverse()
  if (stroke.pressure) reversed.pressure = stroke.pressure
  return reversed
}

export function optimizeStrokeOrder(strokes, { lookahead = 36, lineTolerance = 8 } = {}) {
  const pending = strokes.filter((stroke) => stroke.length > 1)
  if (pending.length < 3) return pending
  const output = []
  let current = { x: 0, y: 0 }
  while (pending.length) {
    const limit = Math.min(lookahead, pending.length)
    let selectedIndex = 0
    let reverse = false
    let bestScore = Infinity
    const referenceY = pending[0].reduce((sum, point) => sum + point.y, 0) / pending[0].length
    for (let index = 0; index < limit; index += 1) {
      const stroke = pending[index]
      const centerY = stroke.reduce((sum, point) => sum + point.y, 0) / stroke.length
      const linePenalty = Math.max(0, Math.abs(centerY - referenceY) - lineTolerance) * 12
      const orderPenalty = index * 0.055
      const forward = Math.hypot(stroke[0].x - current.x, stroke[0].y - current.y) + linePenalty + orderPenalty
      const backward = Math.hypot(stroke.at(-1).x - current.x, stroke.at(-1).y - current.y) + linePenalty + orderPenalty + 0.08
      if (forward < bestScore) {
        bestScore = forward
        selectedIndex = index
        reverse = false
      }
      if (backward < bestScore) {
        bestScore = backward
        selectedIndex = index
        reverse = true
      }
    }
    const [selected] = pending.splice(selectedIndex, 1)
    const prepared = reverse ? reversedStroke(selected) : selected
    output.push(prepared)
    current = prepared.at(-1)
  }
  return output
}

function fingerprintCommands(commands) {
  let hash = 2166136261
  for (const command of commands) {
    for (let index = 0; index < command.length; index += 1) {
      hash ^= command.charCodeAt(index)
      hash = Math.imul(hash, 16777619)
    }
  }
  return `${commands.length}-${(hash >>> 0).toString(36)}`
}

export function compilePlotJob(strokes, config) {
  // EBB jobs are emitted as relative step deltas. After a controller reset we
  // cannot safely infer the physical origin, so resuming in the middle of such
  // a stream would be unsafe. GRBL/Marlin use absolute millimetre coordinates.
  const recoverable = config.profile !== 'ebb'
  const sourceStrokes = strokes.filter((stroke) => stroke.length > 1)
  const originalTravelDistance = strokeTravelDistance(sourceStrokes)
  const preparedStrokes = config.optimizePath
    ? optimizeStrokeOrder(sourceStrokes)
    : sourceStrokes
  const commands = []
  const resumePoints = []
  const strokeCommandRanges = []
  const addPen = (up, pressure = 1) => {
    commands.push(penCommand(up, config, pressure))
    if (config.profile !== 'ebb' && Number(config.penDelay) > 0) commands.push(`G4P${number(Number(config.penDelay))}`)
  }
  let current = { x: 0, y: 0 }
  const residue = { x: 0, y: 0 }
  let distance = 0
  let drawDistance = 0
  let travelDistance = 0
  let penChanges = 0
  let penLifts = 0

  if (config.profile !== 'ebb') commands.push('G21', 'G90')
  addPen(true)
  penChanges += 1
  for (const stroke of preparedStrokes) {
    if (stroke.length < 2) continue
    if (recoverable) resumePoints.push(commands.length)
    const start = stroke[0]
    const travel = Math.hypot(start.x - current.x, start.y - current.y)
    distance += travel
    travelDistance += travel
    if (config.profile === 'ebb') commands.push(buildEbbMove(current, start, config.jogSpeed, config, residue))
    else commands.push(`G0X${number(start.x)}Y${number(start.y)}F${config.jogSpeed}`)
    current = start
    addPen(false, stroke.pressure || 1)
    const drawStart = commands.length
    penChanges += 1
    for (const point of stroke.slice(1)) {
      const drawn = Math.hypot(point.x - current.x, point.y - current.y)
      distance += drawn
      drawDistance += drawn
      if (config.profile === 'ebb') commands.push(buildEbbMove(current, point, config.feedRate, config, residue))
      else commands.push(`G1X${number(point.x)}Y${number(point.y)}F${config.feedRate}`)
      current = point
    }
    const drawEnd = commands.length
    addPen(true)
    strokeCommandRanges.push({ start: drawStart, end: drawEnd })
    penChanges += 1
    penLifts += 1
  }

  const estimatedSeconds = drawDistance / Math.max(1, Number(config.feedRate)) * 60
    + travelDistance / Math.max(1, Number(config.jogSpeed)) * 60
    + penChanges * Number(config.penDelay)
  const resumePrefix = config.profile === 'ebb'
    ? [penCommand(true, config)]
    : ['G21', 'G90', penCommand(true, config)]
  return {
    id: fingerprintCommands(commands),
    commands,
    strokes: preparedStrokes,
    strokeCommandRanges,
    resumePoints,
    resumePrefix,
    recoverable,
    distance,
    drawDistance,
    travelDistance,
    originalTravelDistance,
    optimizationSaved: Math.max(0, originalTravelDistance - travelDistance),
    penLifts,
    penChanges,
    estimatedSeconds,
  }
}

export function plotBounds(strokes) {
  const points = strokes.flat().filter((point) => (
    Number.isFinite(point?.x) && Number.isFinite(point?.y)
  ))
  if (!points.length) return null
  return points.reduce((bounds, point) => ({
    minX: Math.min(bounds.minX, point.x),
    minY: Math.min(bounds.minY, point.y),
    maxX: Math.max(bounds.maxX, point.x),
    maxY: Math.max(bounds.maxY, point.y),
  }), { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity })
}

export function createDryRunCommands(strokes, config) {
  const bounds = plotBounds(strokes)
  if (!bounds) throw new Error('Нет штрихов для проверки рамки.')
  const epsilon = 0.01
  if (
    bounds.minX < -epsilon || bounds.minY < -epsilon ||
    bounds.maxX > Number(config.workAreaWidth) + epsilon ||
    bounds.maxY > Number(config.workAreaHeight) + epsilon
  ) {
    throw new Error('Траектория выходит за настроенную рабочую область. Измените лист, поля или границы механики.')
  }
  if (config.profile === 'ebb') {
    throw new Error('Сухой прогон рамки для EBB требует относительных шагов и пока недоступен. Проверьте область в мастере калибровки.')
  }
  const corners = [
    [bounds.minX, bounds.minY], [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY], [bounds.minX, bounds.maxY], [bounds.minX, bounds.minY],
  ]
  return [
    'G21', 'G90', penCommand(true, config),
    ...corners.map(([x, y]) => `G0X${number(x)}Y${number(y)}F${config.jogSpeed}`),
  ]
}

export function createJogCommands(dx, dy, config) {
  if (config.profile === 'ebb') {
    return [buildEbbMove({ x: 0, y: 0 }, { x: dx, y: dy }, config.jogSpeed, config, { x: 0, y: 0 })]
  }
  if (config.profile === 'marlin') return ['G91', `G0X${number(dx)}Y${number(dy)}F${config.jogSpeed}`]
  return [`$J=G21G91X${number(dx)}Y${number(dy)}F${config.jogSpeed}`]
}

export function createPenCommand(up, config) {
  return [penCommand(up, config)]
}

export function createOriginCommands(config) {
  if (config.profile === 'ebb') return []
  if (config.profile === 'marlin') return ['G92X0Y0Z0']
  return ['G10P0L20X0Y0Z0']
}
