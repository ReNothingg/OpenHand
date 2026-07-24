import { htmlToPlotterText } from '../plotter/richText.js'

function hash(value) {
  let result = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index)
    result = Math.imul(result, 16777619)
  }
  return (result >>> 0).toString(36)
}

export function htmlToManualBlocks(html, pageIndex, includePlotterText = true) {
  const host = document.createElement('div')
  host.innerHTML = html
  const nodes = Array.from(host.children)
  if (!nodes.length && host.textContent?.trim()) {
    const paragraph = document.createElement('p')
    paragraph.textContent = host.textContent
    nodes.push(paragraph)
  }
  return nodes.map((node, index) => {
    const blockHtml = node.outerHTML
    const text = includePlotterText ? htmlToPlotterText(blockHtml) : ''
    const kind = node.querySelector('svg') || node.matches('svg, figure.imported-svg, .tex-tikz')
      ? 'svg'
      : node.querySelector('.katex, math') || node.matches('.katex-display, math')
        ? 'formula'
        : 'text'
    const preview = (node.textContent || '').replace(/\s+/gu, ' ').trim()
    const layoutId = node.dataset.layoutId
    const defaultLayout = layoutId ? {
      pageIndex: Number(node.dataset.layoutPage) || 0,
      x: Number(node.dataset.layoutX) || 0,
      y: Number(node.dataset.layoutY) || 0,
      width: Math.max(36, Number(node.dataset.layoutWidth) || 320),
      height: Math.max(24, Number(node.dataset.layoutHeight) || 80),
      rotation: Number(node.dataset.layoutRotation) || 0,
      align: ['left', 'center', 'right'].includes(node.dataset.layoutAlign) ? node.dataset.layoutAlign : 'left',
      noWrap: node.dataset.layoutNowrap === 'true',
    } : null
    return {
      id: layoutId ? `md-${layoutId}` : `${pageIndex}-${index}-${hash(blockHtml)}`,
      originPage: pageIndex,
      html: blockHtml,
      text,
      kind,
      defaultLayout,
      sourceLayoutKey: defaultLayout ? JSON.stringify(defaultLayout) : null,
      label: kind === 'svg'
        ? 'SVG'
        : kind === 'formula'
          ? `Формула${preview ? ` · ${preview.slice(0, 28)}` : ''}`
          : preview.slice(0, 42) || `Блок ${index + 1}`,
    }
  })
}

export function createManualPages(pages, includePlotterText = true) {
  return pages.map((html, pageIndex) => (
    htmlToManualBlocks(html, pageIndex, includePlotterText)
  ))
}

export function arrangeManualPages(sourcePages, layouts) {
  const output = Array.from({ length: sourcePages.length }, () => [])
  sourcePages.forEach((blocks, originPage) => {
    blocks.forEach((block) => {
      const layout = layouts[originPage]?.[block.id] || block.defaultLayout || null
      const requestedPage = Number.isFinite(Number(layout?.pageIndex))
        ? Math.max(0, Math.round(Number(layout.pageIndex)))
        : originPage
      while (output.length <= requestedPage) output.push([])
      output[requestedPage].push({ ...block, originPage, layout })
    })
  })
  return output.length ? output : [[]]
}

export function normalizeBlockLayout(layout = {}, fallback = {}) {
  layout = layout || {}
  fallback = fallback || {}
  return {
    x: Number.isFinite(layout.x) ? layout.x : fallback.x || 0,
    y: Number.isFinite(layout.y) ? layout.y : fallback.y || 0,
    width: Math.max(36, Number(layout.width) || fallback.width || 240),
    height: Math.max(24, Number(layout.height) || fallback.height || 40),
    rotation: Math.max(-180, Math.min(180, Number(layout.rotation) || 0)),
    align: ['left', 'center', 'right'].includes(layout.align) ? layout.align : 'left',
    noWrap: Boolean(layout.noWrap),
    pageIndex: Number.isFinite(Number(layout.pageIndex)) ? Math.max(0, Math.round(Number(layout.pageIndex))) : undefined,
  }
}

function directiveId(source) {
  const match = String(source).match(/(?:^|\s)id=("[^"]*"|'[^']*'|[^\s]+)/)
  return match ? match[1].replace(/^(['"])([\s\S]*)\1$/, '$2') : ''
}

function directiveValue(value) {
  const string = String(value)
  return /\s/u.test(string) ? `"${string.replaceAll('"', '\\"')}"` : string
}

export function updatePlacementDirective(markdown, layoutId, incomingLayout) {
  if (!layoutId) return markdown
  const layout = normalizeBlockLayout(incomingLayout)
  const line = [
    ':::place',
    `id=${directiveValue(layoutId)}`,
    `page=${(layout.pageIndex ?? 0) + 1}`,
    `x=${Math.round(layout.x * 10) / 10}`,
    `y=${Math.round(layout.y * 10) / 10}`,
    `width=${Math.round(layout.width * 10) / 10}`,
    `height=${Math.round(layout.height * 10) / 10}`,
    `rotate=${Math.round(layout.rotation * 10) / 10}`,
    `align=${layout.align}`,
    layout.noWrap ? 'nowrap' : '',
  ].filter(Boolean).join(' ')
  return String(markdown).split('\n').map((sourceLine) => (
    sourceLine.startsWith(':::place') && directiveId(sourceLine.slice(':::place'.length)) === layoutId
      ? line
      : sourceLine
  )).join('\n')
}
