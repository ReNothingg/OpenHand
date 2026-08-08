const FONT_EM = 400

const SYMBOLS = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', phi: 'φ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  int: '∫', oint: '∮', sum: 'Σ', prod: 'Π', infty: '∞', pm: '±', mp: '∓',
  times: '×', cdot: '·', div: '÷', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  ne: '≠', neq: '≠', approx: '≈', sim: '∼', to: '→', rightarrow: '→', leftarrow: '←',
  partial: '∂', nabla: '∇', hbar: 'ℏ', degree: '°', circ: '°', ldots: '…', dots: '…',
})

const GROUP_COMMANDS = new Set(['text', 'textrm', 'textit', 'textbf', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'operatorname', 'mathbb', 'mathcal'])
const IGNORED_COMMANDS = new Set(['left', 'right', 'limits', 'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle'])

function sequence(children = []) { return { type: 'sequence', children } }

function parser(source) {
  let index = 0
  const peek = () => source[index]
  const take = () => source[index++]
  const command = () => {
    take()
    if (!/[A-Za-z]/.test(peek() || '')) return take() || ''
    const start = index
    while (/[A-Za-z]/.test(peek() || '')) index += 1
    return source.slice(start, index)
  }
  const argument = () => {
    while (/\s/.test(peek() || '')) index += 1
    if (peek() === '{') {
      take()
      const result = expression('}')
      if (peek() === '}') take()
      return result
    }
    return atom()
  }
  const atom = () => {
    if (index >= source.length) return sequence()
    if (peek() === '{') return argument()
    if (peek() !== '\\') return { type: 'text', value: take() }
    const name = command()
    if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return { type: 'frac', numerator: argument(), denominator: argument() }
    if (name === 'sqrt') {
      if (peek() === '[') {
        while (index < source.length && take() !== ']') { /* optional root index */ }
      }
      return { type: 'sqrt', body: argument() }
    }
    if (name === 'hat' || name === 'widehat') return { type: 'accent', body: argument(), accent: 'hat' }
    if (GROUP_COMMANDS.has(name)) return argument()
    if (IGNORED_COMMANDS.has(name)) return sequence()
    if ([',', ';', ':', '!', 'quad', 'qquad', ' '].includes(name)) return { type: 'space', wide: name === 'qquad' ? 2 : name === 'quad' ? 1 : .35 }
    return { type: 'text', value: SYMBOLS[name] || name }
  }
  const expression = (stop = '') => {
    const children = []
    while (index < source.length && peek() !== stop) {
      if (/\s/.test(peek())) { index += 1; continue }
      if (peek() === '&') { index += 1; continue }
      if (source.slice(index, index + 2) === '\\\\') { index += 2; children.push({ type: 'linebreak' }); continue }
      let base = atom()
      let sup = null
      let sub = null
      while (peek() === '^' || peek() === '_') {
        const kind = take()
        const value = argument()
        if (kind === '^') sup = value
        else sub = value
      }
      if (sup || sub) base = { type: 'scripts', base, sup, sub }
      children.push(base)
    }
    return sequence(children)
  }
  return expression()
}

function shift(strokes, dx, dy) {
  return strokes.map((stroke) => {
    const shifted = stroke.map((point) => ({ x: point.x + dx, y: point.y + dy }))
    if (stroke.pressure) shifted.pressure = stroke.pressure
    return shifted
  })
}

function glyphStrokes(glyph, x, baseline, scale) {
  const strokes = []
  let stroke = null
  glyph.points.forEach((source, index) => {
    const point = { x: x + (source.x - glyph.bounds.minX) * scale, y: baseline + source.y * scale }
    if (glyph.flags[index] === 0 || !stroke) { stroke = [point]; strokes.push(stroke) } else stroke.push(point)
  })
  return strokes.filter((item) => item.length > 1)
}

function emptyBox(width = 0) { return { width, ascent: 0, descent: 0, strokes: [] } }

function constructedSymbol(char, size) {
  const line = (...points) => points.map(([x, y]) => ({ x: x * size, y: y * size }))
  if (char === 'ℏ') {
    return {
      width: size * .62,
      ascent: size * .88,
      descent: size * .10,
      strokes: [
        line([.13, .08], [.24, -.88]),
        line([.08, -.46], [.54, -.46]),
        line([.12, -.32], [.58, -.32]),
        line([.23, -.36], [.36, -.52], [.50, -.48], [.52, -.28], [.47, .06]),
      ],
    }
  }
  if (char === '∂') {
    return {
      width: size * .62,
      ascent: size * .84,
      descent: size * .10,
      strokes: [
        line(
          [.18, -.78], [.32, -.88], [.48, -.78], [.54, -.58],
          [.50, -.30], [.39, -.06], [.23, .08], [.10, .02],
          [.07, -.16], [.14, -.34], [.30, -.42], [.49, -.36],
        ),
      ],
    }
  }
  if (char === 'Ψ') {
    return {
      width: size * .78,
      ascent: size * .86,
      descent: size * .10,
      strokes: [
        line([.08, -.78], [.10, -.48], [.21, -.22], [.39, -.12], [.57, -.22], [.68, -.48], [.70, -.78]),
        line([.39, -.86], [.39, .08]),
        line([.18, .08], [.60, .08]),
      ],
    }
  }
  if (char === '∫' || char === '∮') {
    const integral = line([.42, -.88], [.28, -.92], [.18, -.78], [.22, -.48], [.16, -.18], [.05, .08], [.12, .18], [.29, .14])
    const strokes = [integral]
    if (char === '∮') strokes.push(line([.02, -.39], [.42, -.39], [.42, -.16], [.02, -.16], [.02, -.39]))
    return { width: size * .48, ascent: size * .92, descent: size * .18, strokes }
  }
  if (char === '±' || char === '∓') {
    return { width: size * .68, ascent: size * .72, descent: size * .08, strokes: [line([.08, -.48], [.60, -.48]), line([.34, -.70], [.34, -.26]), line([.08, -.08], [.60, -.08])] }
  }
  if (char === 'Σ') return { width: size * .72, ascent: size * .82, descent: size * .10, strokes: [line([.66, -.82], [.10, -.82], [.42, -.38], [.10, .08], [.68, .08])] }
  if (char === 'Π') return { width: size * .72, ascent: size * .82, descent: size * .08, strokes: [line([.10, .08], [.10, -.82], [.64, -.82], [.64, .08])] }
  if (char === '∞') return { width: size * .88, ascent: size * .56, descent: size * .02, strokes: [line([.06, -.26], [.18, -.48], [.36, -.48], [.76, -.04], [.86, -.26], [.74, -.48], [.56, -.48], [.16, -.04], [.06, -.26])] }
  if (char === '×') return { width: size * .65, ascent: size * .68, descent: 0, strokes: [line([.10, -.62], [.56, -.12]), line([.56, -.62], [.10, -.12])] }
  if (char === '·') return { width: size * .30, ascent: size * .38, descent: 0, strokes: [line([.13, -.28], [.16, -.25])] }
  return null
}

export function parseFormula(source) {
  return parser(source.replace(/\s+/g, ' ').trim())
}

function seededRandom(seed, key) {
  let value = 2166136261
  const input = `${seed}:${key}`
  for (let index = 0; index < input.length; index += 1) {
    value ^= input.charCodeAt(index)
    value = Math.imul(value, 16777619)
  }
  value += 0x6d2b79f5
  value = Math.imul(value ^ (value >>> 15), value | 1)
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296
}

function humanizeFormula(strokes, handwriting, fontSize) {
  if (!handwriting?.enabled) return strokes
  const variation = Math.max(0, Math.min(100, Number(handwriting.variation) || 0))
  const rhythm = Math.max(0, Math.min(100, Number(handwriting.rhythm) || 0))
  const width = Math.max(0.82, Math.min(1.18, Number(handwriting.authorWidth || 100) / 100))
  const slant = Math.tan(Math.max(-16, Math.min(20, Number(handwriting.authorSlant) || 0)) * Math.PI / 180)
  const jitter = fontSize * (variation * 0.00012 + rhythm * 0.00008)
  return strokes.map((stroke, strokeIndex) => {
    const pressure = 1 + (seededRandom(handwriting.seed, `formula:${strokeIndex}:pressure`) - 0.5) * Number(handwriting.pressure || 0) * 0.009
    const transformed = stroke.map((point, pointIndex) => {
      const localJitter = (seededRandom(handwriting.seed, `formula:${strokeIndex}:${pointIndex}`) - 0.5) * jitter
      return {
        x: point.x * width + point.y * slant + localJitter,
        y: point.y + localJitter * 0.65,
      }
    })
    transformed.pressure = pressure
    return transformed
  })
}

export async function layoutFormula(source, { fontSize, letterSpacing = 0, getGlyph, handwriting = null }) {
  const missing = new Set()
  const render = async (node, size) => {
    if (!node) return emptyBox()
    if (node.type === 'space') return emptyBox(size * .22 * node.wide)
    if (node.type === 'linebreak') return emptyBox(size * .5)
    if (node.type === 'text') {
      let x = 0
      let ascent = size * .72
      let descent = size * .18
      const strokes = []
      for (const char of Array.from(node.value)) {
        const glyph = await getGlyph(char)
        if (!glyph) {
          const constructed = constructedSymbol(char, size)
          if (constructed) {
            strokes.push(...shift(constructed.strokes, x, 0))
            x += constructed.width
            ascent = Math.max(ascent, constructed.ascent)
            descent = Math.max(descent, constructed.descent)
            continue
          }
          missing.add(char)
          x += size * .46
          continue
        }
        const scale = size / FONT_EM
        strokes.push(...glyphStrokes(glyph, x, 0, scale))
        const points = glyph.points || []
        if (points.length) {
          ascent = Math.max(ascent, -Math.min(...points.map((point) => point.y)) * scale)
          descent = Math.max(descent, Math.max(...points.map((point) => point.y)) * scale)
        }
        x += Math.max((glyph.bounds.maxX - glyph.bounds.minX) * scale + letterSpacing * size / fontSize, size * .24)
      }
      return { width: x, ascent, descent, strokes }
    }
    if (node.type === 'sequence') {
      let x = 0
      let ascent = 0
      let descent = 0
      const strokes = []
      for (const child of node.children) {
        const box = await render(child, size)
        strokes.push(...shift(box.strokes, x, 0))
        x += box.width
        ascent = Math.max(ascent, box.ascent)
        descent = Math.max(descent, box.descent)
      }
      return { width: x, ascent, descent, strokes }
    }
    if (node.type === 'sqrt') {
      const body = await render(node.body, size * .92)
      const lead = size * .42
      const top = -Math.max(body.ascent + size * .08, size * .72)
      const width = lead + body.width + size * .10
      const radical = [[
        { x: 0, y: -size * .12 }, { x: size * .10, y: size * .02 },
        { x: size * .22, y: top + size * .16 }, { x: size * .34, y: top }, { x: width, y: top },
      ]]
      return {
        width,
        ascent: Math.max(-top, body.ascent),
        descent: Math.max(body.descent, size * .03),
        strokes: [...radical, ...shift(body.strokes, lead, 0)],
      }
    }
    if (node.type === 'accent') {
      const body = await render(node.body, size)
      const top = -body.ascent - size * .08
      const inset = Math.min(body.width * .18, size * .14)
      const middle = body.width / 2
      return {
        width: body.width,
        ascent: Math.max(body.ascent, -top + size * .16),
        descent: body.descent,
        strokes: [
          ...body.strokes,
          [
            { x: inset, y: top + size * .12 },
            { x: middle, y: top },
            { x: Math.max(middle, body.width - inset), y: top + size * .12 },
          ],
        ],
      }
    }
    if (node.type === 'frac') {
      const numerator = await render(node.numerator, size * .72)
      const denominator = await render(node.denominator, size * .72)
      const padding = size * .14
      const gap = size * .12
      const width = Math.max(numerator.width, denominator.width) + padding * 2
      const ruleY = -size * .10
      const numeratorY = ruleY - gap - numerator.descent
      const denominatorY = ruleY + gap + denominator.ascent
      return {
        width,
        ascent: Math.max(-numeratorY + numerator.ascent, -ruleY),
        descent: denominatorY + denominator.descent,
        strokes: [
          ...shift(numerator.strokes, (width - numerator.width) / 2, numeratorY),
          [{ x: 0, y: ruleY }, { x: width, y: ruleY }],
          ...shift(denominator.strokes, (width - denominator.width) / 2, denominatorY),
        ],
      }
    }
    if (node.type === 'scripts') {
      const base = await render(node.base, size)
      const sup = node.sup ? await render(node.sup, size * .62) : emptyBox()
      const sub = node.sub ? await render(node.sub, size * .62) : emptyBox()
      const scriptX = base.width + size * .04
      const supY = node.sup ? -Math.max(size * .52, base.ascent * .62) : 0
      const subY = node.sub ? Math.max(size * .27, base.descent + size * .18) : 0
      return {
        width: base.width + (node.sup || node.sub ? size * .04 + Math.max(sup.width, sub.width) : 0),
        ascent: Math.max(base.ascent, node.sup ? -supY + sup.ascent : 0),
        descent: Math.max(base.descent, node.sub ? subY + sub.descent : 0),
        strokes: [...base.strokes, ...shift(sup.strokes, scriptX, supY), ...shift(sub.strokes, scriptX, subY)],
      }
    }
    return emptyBox()
  }

  const box = await render(parseFormula(source), fontSize)
  return {
    ...box,
    width: handwriting?.enabled
      ? box.width * Math.max(0.82, Math.min(1.18, Number(handwriting.authorWidth || 100) / 100))
      : box.width,
    strokes: humanizeFormula(box.strokes, handwriting, fontSize),
    missing: [...missing],
  }
}
