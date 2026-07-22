import { layoutFormula } from './mathLayout.js'
import { PLOTTER_CONTROL_MARKS, PLOTTER_FORMULA_END, PLOTTER_FORMULA_START, PLOTTER_MARKS } from './richText.js'

const PX_TO_MM = 25.4 / 96
const FONT_EM = 400

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
}

export function pageSettingsToMillimeters(settings, metrics, evenPage = false, spreadSide = null) {
  const leftPixels = spreadSide === 'right'
    ? metrics.width / 2 + metrics.spreadInnerMargin
    : (evenPage ? settings.marginLeftEven : settings.marginLeft)
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

function splitGlyphStrokes(glyph, cursorX, baseline, scale) {
  const strokes = []
  let stroke = null
  for (let index = 0; index < glyph.points.length; index += 1) {
    const source = glyph.points[index]
    const point = {
      x: cursorX + (source.x - glyph.bounds.minX) * scale,
      y: baseline + source.y * scale,
    }
    if (glyph.flags[index] === 0 || !stroke) {
      stroke = [point]
      strokes.push(stroke)
    } else {
      stroke.push(point)
    }
  }
  return strokes.filter((item) => item.length > 1)
}

export async function layoutText(text, font, page, config) {
  const scale = page.fontSize / FONT_EM
  const spaceWidth = page.fontSize * 0.46
  const letterSpacing = Number(config.letterSpacing || 0)
  const glyphs = new Map()
  const missing = new Set()

  const formulaPattern = new RegExp(`${PLOTTER_FORMULA_START}([\\s\\S]*?)${PLOTTER_FORMULA_END}`, 'g')
  const formulaSources = [...text.matchAll(formulaPattern)].map((match) => match[1])
  const plainText = text.replace(formulaPattern, '')

  const getGlyph = async (char) => {
    if (glyphs.has(char)) return glyphs.get(char)
    const glyph = await font.getGlyph(char.codePointAt(0))
    if (glyph) glyphs.set(char, glyph)
    else missing.add(char)
    return glyph || null
  }

  for (const char of new Set(Array.from(plainText))) {
    if (/\s/u.test(char) || PLOTTER_CONTROL_MARKS.has(char)) continue
    await getGlyph(char)
  }

  const formulaLayouts = new Map()
  for (const source of formulaSources) {
    if (formulaLayouts.has(source)) continue
    const layout = await layoutFormula(source, { fontSize: page.fontSize, letterSpacing, getGlyph })
    layout.missing.forEach((char) => missing.add(char))
    formulaLayouts.set(source, layout)
  }

  const advanceFor = (char) => {
    if (char === ' ' || char === '\t') return spaceWidth * (char === '\t' ? 4 : 1)
    const glyph = glyphs.get(char)
    return glyph ? Math.max((glyph.bounds.maxX - glyph.bounds.minX) * scale + letterSpacing, page.fontSize * 0.24) : spaceWidth
  }

  const strokes = []
  const activeDecorations = new Set()
  const decorationStarts = new Map()
  let x = page.left
  let baseline = page.top + page.fontSize
  const maxX = page.pageWidth - Math.max(0, page.right)
  const maxY = page.pageHeight - page.bottom
  let clipped = false

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
    strokes.push([{ x: startX, y: baseline + page.fontSize * 0.14 }, { x: endX, y: baseline + page.fontSize * 0.14 }])
  }

  const closeLineDecorations = () => {
    activeDecorations.forEach((style) => decorationStroke(style, decorationStarts.get(style) ?? page.left, x))
  }

  const nextLine = () => {
    closeLineDecorations()
    x = page.left
    baseline += page.lineHeight
    activeDecorations.forEach((style) => decorationStarts.set(style, x))
    if (baseline > maxY) clipped = true
  }

  const startMarks = new Map([
    [PLOTTER_MARKS.underlineStart, 'underline'],
    [PLOTTER_MARKS.doubleStart, 'double'],
    [PLOTTER_MARKS.wavyStart, 'wavy'],
    [PLOTTER_MARKS.strikeStart, 'strike'],
  ])
  const endMarks = new Map([
    [PLOTTER_MARKS.underlineEnd, 'underline'],
    [PLOTTER_MARKS.doubleEnd, 'double'],
    [PLOTTER_MARKS.wavyEnd, 'wavy'],
    [PLOTTER_MARKS.strikeEnd, 'strike'],
  ])

  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const tokens = rawLine.split(new RegExp(`(${PLOTTER_FORMULA_START}.*?${PLOTTER_FORMULA_END}|\\s+)`, 'u')).filter(Boolean)
    for (const token of tokens) {
      if (clipped) break
      if (token.startsWith(PLOTTER_FORMULA_START) && token.endsWith(PLOTTER_FORMULA_END)) {
        const source = token.slice(PLOTTER_FORMULA_START.length, -PLOTTER_FORMULA_END.length)
        const formula = formulaLayouts.get(source)
        if (!formula) continue
        if (x > page.left && x + formula.width > maxX) nextLine()
        if (baseline + formula.descent > maxY) { clipped = true; break }
        strokes.push(...formula.strokes.map((stroke) => stroke.map((point) => ({ x: x + point.x, y: baseline + point.y }))))
        x += formula.width
        continue
      }
      if (/^\s+$/u.test(token)) {
        for (const char of token) {
          if (char === '\n') nextLine()
          else x += advanceFor(char)
        }
        continue
      }
      const tokenWidth = Array.from(token).reduce((total, char) => total + (PLOTTER_CONTROL_MARKS.has(char) ? 0 : advanceFor(char)), 0)
      if (x > page.left && x + tokenWidth > maxX) nextLine()
      for (const char of token) {
        if (startMarks.has(char)) {
          const style = startMarks.get(char)
          activeDecorations.add(style)
          decorationStarts.set(style, x)
          continue
        }
        if (endMarks.has(char)) {
          const style = endMarks.get(char)
          decorationStroke(style, decorationStarts.get(style) ?? x, x)
          activeDecorations.delete(style)
          decorationStarts.delete(style)
          continue
        }
        const advance = advanceFor(char)
        if (x > page.left && x + advance > maxX) nextLine()
        if (clipped) break
        const glyph = glyphs.get(char)
        if (glyph) strokes.push(...splitGlyphStrokes(glyph, x, baseline, scale))
        x += advance
      }
    }
    nextLine()
    if (clipped) break
  }

  return { strokes, missing: [...missing], clipped }
}

function number(value, digits = 3) {
  return Number(value.toFixed(digits)).toString()
}

function penCommand(up, config) {
  if (config.profile === 'ebb') return `SP,${up ? 1 : 0},${Math.round(config.penDelay * 1000)}`
  if (config.profile === 'marlin') {
    if (config.penMode === 'stepper') return `G1G90Z${number(up ? config.zUp : config.zDown)}F${config.zSpeed}`
    if (config.penMode === 'estepper') return `G1G90E${number(up ? config.zUp : config.zDown)}F${config.zSpeed}`
    return `M280P0S${up ? config.penUp : config.penDown}`
  }
  if (config.penMode === 'stepper') return `G1G90Z${number(up ? config.zUp : config.zDown)}F${config.zSpeed}`
  if (config.penMode === 'laser') return up ? 'M5' : `M3S${config.laserPower}`
  return `M3S${up ? config.penUp : config.penDown}`
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

export function compilePlotJob(strokes, config) {
  const commands = []
  const addPen = (up) => {
    commands.push(penCommand(up, config))
    if (config.profile !== 'ebb' && Number(config.penDelay) > 0) commands.push(`G4P${number(Number(config.penDelay))}`)
  }
  let current = { x: 0, y: 0 }
  const residue = { x: 0, y: 0 }
  let distance = 0
  let penChanges = 0

  if (config.profile !== 'ebb') commands.push('G21', 'G90')
  addPen(true)
  penChanges += 1
  for (const stroke of strokes) {
    if (stroke.length < 2) continue
    const start = stroke[0]
    distance += Math.hypot(start.x - current.x, start.y - current.y)
    if (config.profile === 'ebb') commands.push(buildEbbMove(current, start, config.jogSpeed, config, residue))
    else commands.push(`G0X${number(start.x)}Y${number(start.y)}F${config.jogSpeed}`)
    current = start
    addPen(false)
    penChanges += 1
    for (const point of stroke.slice(1)) {
      distance += Math.hypot(point.x - current.x, point.y - current.y)
      if (config.profile === 'ebb') commands.push(buildEbbMove(current, point, config.feedRate, config, residue))
      else commands.push(`G1X${number(point.x)}Y${number(point.y)}F${config.feedRate}`)
      current = point
    }
    addPen(true)
    penChanges += 1
  }

  const estimatedSeconds = distance / Math.max(1, Number(config.feedRate)) * 60 + penChanges * Number(config.penDelay)
  return { commands, distance, estimatedSeconds }
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
