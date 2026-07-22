export const PLOTTER_MARKS = Object.freeze({
  underlineStart: '\uE000',
  underlineEnd: '\uE001',
  doubleStart: '\uE002',
  doubleEnd: '\uE003',
  wavyStart: '\uE004',
  wavyEnd: '\uE005',
  strikeStart: '\uE006',
  strikeEnd: '\uE007',
})

export const PLOTTER_CONTROL_MARKS = new Set(Object.values(PLOTTER_MARKS))

export const PLOTTER_FORMULA_START = '\uE100'
export const PLOTTER_FORMULA_END = '\uE101'

const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DIV', 'DL', 'DT', 'DD',
  'FIGCAPTION', 'FIGURE', 'FOOTER', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION', 'TABLE',
  'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
])

const STYLE_MARKS = {
  underline: [PLOTTER_MARKS.underlineStart, PLOTTER_MARKS.underlineEnd],
  double: [PLOTTER_MARKS.doubleStart, PLOTTER_MARKS.doubleEnd],
  wavy: [PLOTTER_MARKS.wavyStart, PLOTTER_MARKS.wavyEnd],
  strike: [PLOTTER_MARKS.strikeStart, PLOTTER_MARKS.strikeEnd],
}

function elementStyles(element) {
  const styles = []
  if (element.matches('del, s, strike')) styles.push('strike')
  if (element.classList.contains('underline-double')) styles.push('double')
  else if (element.classList.contains('underline-wavy')) styles.push('wavy')
  else if (element.matches('u, .underline')) styles.push('underline')
  return styles
}

function formulaSource(formula) {
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

export function htmlToPlotterText(html) {
  const container = document.createElement('div')
  container.innerHTML = html
  replaceFormulaNodes(container)

  let output = ''
  const appendBreak = (count = 1) => {
    output = output.replace(/[ \t]+$/g, '')
    const existing = output.match(/\n+$/)?.[0].length || 0
    output += '\n'.repeat(Math.max(0, count - existing))
  }

  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      output += (node.textContent || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node
    if (element.matches('script, style, [aria-hidden="true"]')) return
    if (element.tagName === 'BR') {
      appendBreak(1)
      return
    }

    const styles = elementStyles(element)
    styles.forEach((style) => { output += STYLE_MARKS[style][0] })
    Array.from(element.childNodes).forEach(walk)
    styles.slice().reverse().forEach((style) => { output += STYLE_MARKS[style][1] })

    if (element.tagName === 'LI') appendBreak(1)
    else if (BLOCK_TAGS.has(element.tagName)) appendBreak(2)
  }

  Array.from(container.childNodes).forEach(walk)
  return output
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
