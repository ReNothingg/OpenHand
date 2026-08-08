export const PLOTTER_MARKS = Object.freeze({
  underlineStart: '\uE000',
  underlineEnd: '\uE001',
  doubleStart: '\uE002',
  doubleEnd: '\uE003',
  wavyStart: '\uE004',
  wavyEnd: '\uE005',
  strikeStart: '\uE006',
  strikeEnd: '\uE007',
  boldStart: '\uE008',
  boldEnd: '\uE009',
  italicStart: '\uE00A',
  italicEnd: '\uE00B',
  codeStart: '\uE00C',
  codeEnd: '\uE00D',
  highlightStart: '\uE00E',
  highlightEnd: '\uE00F',
})

export const PLOTTER_ALIGN_MARKS = Object.freeze({
  leftStart: '\uE110',
  leftEnd: '\uE111',
  centerStart: '\uE112',
  centerEnd: '\uE113',
  rightStart: '\uE114',
  rightEnd: '\uE115',
})

export const PLOTTER_CALLOUT_MARKS = Object.freeze({
  start: '\uE120',
  end: '\uE121',
})

export const PLOTTER_QUOTE_MARKS = Object.freeze({
  start: '\uE122',
  end: '\uE123',
})

export const PLOTTER_HEADING_MARKS = Object.freeze({
  h1Start: '\uE150',
  h1End: '\uE151',
  h2Start: '\uE152',
  h2End: '\uE153',
  h3Start: '\uE154',
  h3End: '\uE155',
  h4Start: '\uE156',
  h4End: '\uE157',
  h5Start: '\uE158',
  h5End: '\uE159',
  h6Start: '\uE15A',
  h6End: '\uE15B',
})

export const PLOTTER_CONTROL_MARKS = new Set<string>([
  ...Object.values(PLOTTER_MARKS),
  ...Object.values(PLOTTER_ALIGN_MARKS),
  ...Object.values(PLOTTER_CALLOUT_MARKS),
  ...Object.values(PLOTTER_QUOTE_MARKS),
  ...Object.values(PLOTTER_HEADING_MARKS),
])

export const PLOTTER_FORMULA_START = '\uE100'
export const PLOTTER_FORMULA_END = '\uE101'
export const PLOTTER_SVG_START = '\uE130'
export const PLOTTER_SVG_END = '\uE131'
export const PLOTTER_PAGE_BREAK = '\uE140'

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL', 'DETAILS', 'SUMMARY',
])

const STYLE_MARKS = {
  underline: [PLOTTER_MARKS.underlineStart, PLOTTER_MARKS.underlineEnd],
  double: [PLOTTER_MARKS.doubleStart, PLOTTER_MARKS.doubleEnd],
  wavy: [PLOTTER_MARKS.wavyStart, PLOTTER_MARKS.wavyEnd],
  strike: [PLOTTER_MARKS.strikeStart, PLOTTER_MARKS.strikeEnd],
  bold: [PLOTTER_MARKS.boldStart, PLOTTER_MARKS.boldEnd],
  italic: [PLOTTER_MARKS.italicStart, PLOTTER_MARKS.italicEnd],
  code: [PLOTTER_MARKS.codeStart, PLOTTER_MARKS.codeEnd],
  highlight: [PLOTTER_MARKS.highlightStart, PLOTTER_MARKS.highlightEnd],
}

function elementStyles(element) {
  const styles = []
  if (element.matches('strong, b, .bf')) styles.push('bold')
  if (element.matches('em, i, .it, .sl')) styles.push('italic')
  if (element.matches('code') && !element.closest('pre')) styles.push('code')
  if (element.matches('mark')) styles.push('highlight')
  if (element.matches('del, s, strike')) styles.push('strike')
  if (element.classList.contains('underline-double')) styles.push('double')
  else if (element.classList.contains('underline-wavy')) styles.push('wavy')
  else if (element.matches('u, .underline')) styles.push('underline')
  return styles
}

function elementAlignment(element) {
  if (element.tagName === 'CENTER') return 'center'
  const alignment = (element.getAttribute('align') || element.style.textAlign || '').trim().toLowerCase()
  return ['left', 'center', 'right'].includes(alignment) ? alignment : null
}

function formulaSource(formula: Element) {
  const annotation = formula.querySelector('annotation[encoding="application/x-tex"], annotation')?.textContent?.trim()
  if (annotation) return annotation
  const math = formula.matches('math') ? formula : formula.querySelector('math')
  const directText = math
    ? Array.from(math.childNodes)
      .filter((node) => node.nodeType === Node.TEXT_NODE)
      .map((node) => node.textContent)
      .join('')
      .trim()
    : ''
  return directText || formula.getAttribute('alttext') || ''
}

function replaceFormulaNodes(container) {
  container.querySelectorAll('.katex').forEach((formula) => {
    const source = formulaSource(formula)
    const normalized = source.replace(/\s+/g, ' ').trim()
    formula.replaceWith(document.createTextNode(normalized ? `${PLOTTER_FORMULA_START}${normalized}${PLOTTER_FORMULA_END}` : ''))
  })
  container.querySelectorAll('math').forEach((formula) => {
    const source = formulaSource(formula)
    const normalized = source.replace(/\s+/g, ' ').trim()
    formula.replaceWith(document.createTextNode(normalized ? `${PLOTTER_FORMULA_START}${normalized}${PLOTTER_FORMULA_END}` : ''))
  })
}

function handwrittenTableLine(x1, y1, x2, y2, seed) {
  const points = []
  const horizontal = Math.abs(x2 - x1) >= Math.abs(y2 - y1)
  const segments = horizontal ? 10 : 7
  for (let index = 0; index <= segments; index += 1) {
    const progress = index / segments
    const wave = index === 0 || index === segments
      ? 0
      : Math.sin(seed * 1.71 + index * 1.43) * 1.25
        + Math.sin(seed * 0.63 + index * 0.77) * 0.55
    points.push({
      x: x1 + (x2 - x1) * progress + (horizontal ? 0 : wave),
      y: y1 + (y2 - y1) * progress + (horizontal ? wave : 0),
    })
  }
  return points
}

function estimateTableTextWidth(value: string) {
  return Array.from(value).reduce((width, character) => {
    if (/\s/u.test(character)) return width + 7
    if (/[\p{P}\p{S}]/u.test(character)) return width + 7
    if (/[ijlI1]/u.test(character)) return width + 7
    return width + 12
  }, 0)
}

function tableDrawing(table: HTMLTableElement) {
  const rows = [...table.rows]
  const columnCount = Math.max(1, ...rows.map((row) => row.cells.length))
  if (!rows.length || !columnCount) return null

  const tableValues = rows.map((row) =>
    [...row.cells].map((cell) => (cell.textContent || '').replace(/\s+/g, ' ').trim()))
  const columnWidths = Array.from({ length: columnCount }, (_, columnIndex) => {
    const contentWidth = Math.max(
      0,
      ...tableValues.map((values) => estimateTableTextWidth(values[columnIndex] || '')),
    )
    return Math.max(76, Math.min(300, contentWidth + 28))
  })
  const columnOffsets = [0]
  columnWidths.forEach((columnWidth) => {
    columnOffsets.push(columnOffsets[columnOffsets.length - 1] + columnWidth)
  })
  const width = columnOffsets[columnOffsets.length - 1]
  const rowHeight = 44
  const height = rows.length * rowHeight
  const strokes = []
  const texts = []

  for (let rowIndex = 0; rowIndex <= rows.length; rowIndex += 1) {
    const y = rowIndex * rowHeight
    strokes.push(handwrittenTableLine(0, y, width, y, rowIndex + 1))
  }
  for (let columnIndex = 0; columnIndex <= columnCount; columnIndex += 1) {
    const x = columnOffsets[columnIndex]
    strokes.push(handwrittenTableLine(x, 0, x, height, columnIndex + rows.length + 1))
  }

  rows.forEach((row, rowIndex) => {
    const cells = [...row.cells]
    cells.forEach((cell, columnIndex) => {
      const value = tableValues[rowIndex][columnIndex]
      if (!value) return
      const alignment = (cell.getAttribute('align') || '').toLowerCase()
      const anchor = alignment === 'right' ? 'end' : alignment === 'center' ? 'middle' : 'start'
      const inset = 14
      const columnStart = columnOffsets[columnIndex]
      const columnEnd = columnOffsets[columnIndex + 1]
      texts.push({
        value,
        x: anchor === 'end'
          ? columnEnd - inset
          : anchor === 'middle'
            ? (columnStart + columnEnd) / 2
            : columnStart + inset,
        y: rowIndex * rowHeight + rowHeight * 0.68,
        size: 22,
        angle: Math.sin((rowIndex + 1) * 1.9 + columnIndex) * 0.008,
        anchor,
      })
    })
  })

  return { kind: 'table', width, height, strokes, texts }
}

function replaceTableNodes(container) {
  container.querySelectorAll('table').forEach((table) => {
    const drawing = tableDrawing(table)
    const placeholder = document.createElement('div')
    placeholder.textContent = drawing
      ? `${PLOTTER_SVG_START}${encodeURIComponent(JSON.stringify(drawing))}${PLOTTER_SVG_END}`
      : ''
    table.replaceWith(placeholder)
  })
}

function splitDashedStroke(points, pattern) {
  if (points.length < 2 || !pattern.length) return points.length > 1 ? [points] : []
  const normalized = pattern.length % 2 ? [...pattern, ...pattern] : pattern
  const strokes = []
  let patternIndex = 0
  let remaining = normalized[0]
  let drawing = true
  let stroke = []

  for (let index = 1; index < points.length; index += 1) {
    let start = points[index - 1]
    const target = points[index]
    let segmentLength = Math.hypot(target.x - start.x, target.y - start.y)
    if (segmentLength <= 0) continue

    while (segmentLength > 0.001) {
      const distance = Math.min(segmentLength, remaining)
      const ratio = distance / segmentLength
      const end = {
        x: start.x + (target.x - start.x) * ratio,
        y: start.y + (target.y - start.y) * ratio,
      }
      if (drawing) {
        if (!stroke.length) stroke.push(start)
        stroke.push(end)
      }
      start = end
      segmentLength -= distance
      remaining -= distance
      if (remaining <= 0.001) {
        if (drawing && stroke.length > 1) strokes.push(stroke)
        stroke = []
        patternIndex = (patternIndex + 1) % normalized.length
        remaining = normalized[patternIndex]
        drawing = patternIndex % 2 === 0
      }
    }
  }
  if (drawing && stroke.length > 1) strokes.push(stroke)
  return strokes
}

function arrowStroke(tip, neighbor, size) {
  const distance = Math.hypot(neighbor.x - tip.x, neighbor.y - tip.y)
  if (distance <= 0) return null
  const dx = (neighbor.x - tip.x) / distance
  const dy = (neighbor.y - tip.y) / distance
  const perpendicularX = -dy
  const perpendicularY = dx
  return [
    {
      x: tip.x + dx * size + perpendicularX * size * 0.42,
      y: tip.y + dy * size + perpendicularY * size * 0.42,
    },
    tip,
    {
      x: tip.x + dx * size - perpendicularX * size * 0.42,
      y: tip.y + dy * size - perpendicularY * size * 0.42,
    },
  ]
}

function svgTextDrawing(text, bounds) {
  const value = (text.textContent || '')
    .replace(/\u2300/g, 'Ø')
    .replace(/\s+/g, ' ')
    .trim()
  const matrix = text.getScreenCTM()
  if (!value || !matrix) return null
  const style = getComputedStyle(text)
  if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null
  const x = text.x?.baseVal?.numberOfItems ? text.x.baseVal.getItem(0).value : Number(text.getAttribute('x')) || 0
  const y = text.y?.baseVal?.numberOfItems ? text.y.baseVal.getItem(0).value : Number(text.getAttribute('y')) || 0
  const origin = new DOMPoint(x, y).matrixTransform(matrix)
  return {
    value,
    x: origin.x - bounds.left,
    y: origin.y - bounds.top,
    size: (Number.parseFloat(style.fontSize) || 16) * Math.hypot(matrix.a, matrix.b),
    angle: Math.atan2(matrix.b, matrix.a),
    anchor: style.textAnchor || text.getAttribute('text-anchor') || 'start',
  }
}

function svgDrawing(svg) {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:800px;height:auto;opacity:0;pointer-events:none'
  const clone = svg.cloneNode(true)
  clone.style.maxWidth = 'none'
  if (!clone.getAttribute('width')) clone.style.width = '600px'
  if (!clone.getAttribute('height')) clone.style.height = 'auto'
  host.append(clone)
  document.body.append(host)

  try {
    const bounds = clone.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return null
    const strokes = []
    const texts = []
    clone.querySelectorAll('path, line, polyline, polygon, rect, circle, ellipse').forEach((geometry) => {
      if (geometry.closest('defs, clipPath, mask, pattern, marker')) return
      const style = getComputedStyle(geometry)
      if (style.display === 'none' || style.visibility === 'hidden') return
      const strokeVisible = style.stroke !== 'none' && Number(style.strokeOpacity) !== 0 && Number.parseFloat(style.strokeWidth) > 0
      const fillVisible = style.fill !== 'none' && Number(style.fillOpacity) !== 0
      if (!strokeVisible && !fillVisible) return
      const geometryBounds = geometry.getBoundingClientRect()
      const isBackground = geometry.tagName.toLowerCase() === 'rect'
        && !strokeVisible
        && geometryBounds.width >= bounds.width * 0.96
        && geometryBounds.height >= bounds.height * 0.96
      if (isBackground) return
      let length
      try {
        length = geometry.getTotalLength()
      } catch {
        return
      }
      if (!Number.isFinite(length) || length <= 0) return
      const matrix = geometry.getScreenCTM()
      if (!matrix) return
      const matrixScale = Math.max(0.001, Math.hypot(matrix.a, matrix.b))
      const steps = Math.min(1200, Math.max(2, Math.ceil(length / 2)))
      const stepLength = length / steps
      const geometryStrokes = []
      let stroke = []
      let previous = null
      for (let index = 0; index <= steps; index += 1) {
        const source = geometry.getPointAtLength(stepLength * index)
        const screen = new DOMPoint(source.x, source.y).matrixTransform(matrix)
        const point = { x: screen.x - bounds.left, y: screen.y - bounds.top }
        if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) > stepLength * matrixScale * 4.5) {
          if (stroke.length > 1) geometryStrokes.push(stroke)
          stroke = []
        }
        stroke.push(point)
        previous = point
      }
      if (stroke.length > 1) geometryStrokes.push(stroke)

      const dashPattern = strokeVisible && style.strokeDasharray !== 'none'
        ? style.strokeDasharray.split(/[,\s]+/).map(Number.parseFloat).filter((value) => value > 0).map((value) => value * matrixScale)
        : []
      geometryStrokes.forEach((item) => strokes.push(...splitDashedStroke(item, dashPattern)))

      const firstStroke = geometryStrokes[0]
      const lastStroke = geometryStrokes.at(-1)
      const arrowSize = Math.max(5, Math.min(18, (Number.parseFloat(style.strokeWidth) || 1) * matrixScale * 5))
      if (strokeVisible && style.markerStart !== 'none' && firstStroke?.length > 1) {
        const arrow = arrowStroke(firstStroke[0], firstStroke[1], arrowSize)
        if (arrow) strokes.push(arrow)
      }
      if (strokeVisible && style.markerEnd !== 'none' && lastStroke?.length > 1) {
        const end = lastStroke.length - 1
        const arrow = arrowStroke(lastStroke[end], lastStroke[end - 1], arrowSize)
        if (arrow) strokes.push(arrow)
      }
    })
    clone.querySelectorAll('text').forEach((text) => {
      if (text.closest('defs, clipPath, mask, pattern, marker')) return
      const drawing = svgTextDrawing(text, bounds)
      if (drawing) texts.push(drawing)
    })
    return strokes.length || texts.length ? { width: bounds.width, height: bounds.height, strokes, texts } : null
  } finally {
    host.remove()
  }
}

function replaceSvgNodes(container: Element) {
  container.querySelectorAll('svg').forEach((svg) => {
    const drawing = svgDrawing(svg)
    svg.replaceWith(document.createTextNode(
      drawing ? `${PLOTTER_SVG_START}${encodeURIComponent(JSON.stringify(drawing))}${PLOTTER_SVG_END}` : '',
    ))
  })
}

function listMarker(item: HTMLLIElement) {
  const list = item.parentElement
  if (list?.tagName !== 'OL') return '- '
  if (item.hasAttribute('value')) return `${item.value}. `
  const start = Number(list.getAttribute('start')) || 1
  const index = Array.from(list.children).filter((child) => child.tagName === 'LI').indexOf(item)
  return `${start + Math.max(0, index)}. `
}

function listDepth(item: HTMLLIElement) {
  let depth = 0
  let parent = item.parentElement
  while (parent) {
    if (parent.matches('ul, ol')) depth += 1
    parent = parent.parentElement
  }
  return Math.max(0, depth - 1)
}

export function htmlToPlotterText(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  replaceFormulaNodes(container)
  replaceTableNodes(container)
  replaceSvgNodes(container)

  let output = ''
  const appendBreak = (count = 1) => {
    output = output.replace(/[ \t]+$/g, '')
    const existing = output.match(/\n+$/)?.[0].length || 0
    output += '\n'.repeat(Math.max(0, count - existing))
  }
  const appendBeforeTrailingBreaks = (value) => {
    const trailing = output.match(/\n+$/)?.[0] || ''
    if (trailing) output = `${output.slice(0, -trailing.length)}${value}${trailing}`
    else output += value
  }

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent || ''
      if (
        /^[\t\r\n ]+$/u.test(text)
        && /[\r\n]/u.test(text)
        && !node.parentElement?.matches('pre, code')
      ) return
      output += text
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node
    if (element.matches('script, style, [aria-hidden="true"]')) return
    if (element.hasAttribute('data-plotter-whitespace')) {
      output += (element.textContent || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
      return
    }
    if (element.tagName === 'BR') {
      appendBreak(1)
      return
    }
    if (element.matches('input[type="checkbox"]')) {
      output += element.checked ? '[x] ' : '[ ] '
      return
    }
    if (element.classList.contains('callout-label')) {
      output += '! '
      appendBreak(1)
      return
    }
    if (element.hasAttribute('data-page-break')) {
      appendBreak(1)
      output += PLOTTER_PAGE_BREAK
      appendBreak(1)
      return
    }
    if (element.hasAttribute('data-preserved-blank')) {
      output = output.replace(/[ \t]+$/g, '')
      output += '\n'
      return
    }
    if (element.matches('ul, ol')) {
      appendBreak(1)
      Array.from(element.childNodes).forEach(walk)
      appendBreak(1)
      return
    }
    if (element.tagName === 'LI') {
      appendBreak(1)
      output += `${'  '.repeat(listDepth(element))}${listMarker(element)}`
    }

    const callout = element.matches('blockquote.callout')
    const quote = element.matches('blockquote:not(.callout)')
    const headingLevel = /^H[1-6]$/.test(element.tagName) ? Number(element.tagName.slice(1)) : 0
    if (callout) output += PLOTTER_CALLOUT_MARKS.start
    if (quote) output += PLOTTER_QUOTE_MARKS.start
    if (headingLevel) output += PLOTTER_HEADING_MARKS[`h${headingLevel}Start`]
    const alignment = elementAlignment(element)
    if (alignment) output += PLOTTER_ALIGN_MARKS[`${alignment}Start`]
    const styles = elementStyles(element)
    styles.forEach((style) => { output += STYLE_MARKS[style][0] })
    Array.from(element.childNodes).forEach(walk)
    styles.slice().reverse().forEach((style) => { output += STYLE_MARKS[style][1] })
    if (headingLevel) appendBeforeTrailingBreaks(PLOTTER_HEADING_MARKS[`h${headingLevel}End`])
    if (alignment) appendBeforeTrailingBreaks(PLOTTER_ALIGN_MARKS[`${alignment}End`])
    if (quote) appendBeforeTrailingBreaks(PLOTTER_QUOTE_MARKS.end)
    if (callout) appendBeforeTrailingBreaks(PLOTTER_CALLOUT_MARKS.end)

    if (element.tagName === 'LI') appendBreak(1)
    else if (BLOCK_TAGS.has(element.tagName)) appendBreak(1)
  }

  Array.from(container.childNodes).forEach(walk)
  return output
    .replace(/[ \t]+\n/g, '\n')
    .trim()
}
