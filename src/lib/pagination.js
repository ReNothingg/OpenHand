import { PAGE_SIZES } from '../app/config.js'

export function getPageMetrics(settings) {
  const page = PAGE_SIZES[settings.pageSize]
  const horizontalMargin = Math.max(settings.marginLeft, settings.marginLeftEven)
  return {
    ...page,
    contentHeight: Math.max(180, page.height - settings.marginTop - settings.marginBottom),
    contentWidth: Math.min(settings.textWidth, Math.max(220, page.width - horizontalMargin - 24)),
  }
}

function makeMeasurePage(host, settings) {
  const metrics = getPageMetrics(settings)
  const page = document.createElement('div')
  page.className = 'paper measure-paper'
  page.style.width = `${metrics.width}px`
  page.style.height = `${metrics.height}px`
  page.style.fontFamily = `'${settings.fontFamily}'`
  page.style.fontSize = `${settings.fontSize}px`
  page.style.lineHeight = String(settings.lineHeight)
  const content = document.createElement('div')
  content.className = 'page-content markdown-body'
  content.style.width = `${metrics.contentWidth}px`
  content.style.height = `${metrics.contentHeight}px`
  page.append(content)
  host.append(page)
  return { page, content }
}

function splitOversizedElement(element, content, createPage) {
  let working = element.cloneNode(true)
  let guard = 0
  while (working && guard < 100) {
    guard += 1
    const words = [...working.querySelectorAll('.hw-word')]
    const units = words.length <= 1 ? [...working.querySelectorAll('.hw-letter')] : words
    if (!units.length) {
      content.append(working)
      return content
    }
    let low = 1
    let high = units.length
    let best = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const range = document.createRange()
      range.selectNodeContents(working)
      range.setEndAfter(units[middle - 1])
      const candidate = working.cloneNode(false)
      candidate.append(range.cloneContents())
      content.replaceChildren(candidate)
      if (content.scrollHeight <= content.clientHeight + 1) {
        best = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    content.replaceChildren()
    if (!best) {
      content.append(working)
      return content
    }
    const currentWords = [...working.querySelectorAll('.hw-word')]
    const currentUnits = currentWords.length <= 1 ? [...working.querySelectorAll('.hw-letter')] : currentWords
    const headRange = document.createRange()
    headRange.selectNodeContents(working)
    headRange.setEndAfter(currentUnits[best - 1])
    const head = working.cloneNode(false)
    head.append(headRange.cloneContents())
    content.append(head)
    if (best >= currentUnits.length) return content
    const tailRange = document.createRange()
    tailRange.selectNodeContents(working)
    tailRange.setStartAfter(currentUnits[best - 1])
    const tail = working.cloneNode(false)
    tail.append(tailRange.cloneContents())
    content = createPage()
    working = tail
  }
  return content
}

export function paginateHtml(html, settings, host) {
  host.replaceChildren()
  const template = document.createElement('template')
  template.innerHTML = html
  const pages = []
  const createPage = () => {
    const measured = makeMeasurePage(host, settings)
    pages.push(measured)
    return measured.content
  }
  let content = createPage()
  const nodes = [...template.content.children]
  nodes.forEach((sourceNode) => {
    if (sourceNode.matches('[data-page-break]')) {
      if (content.childElementCount || pages.length === 1) content = createPage()
      return
    }
    const node = sourceNode.cloneNode(true)
    content.append(node)
    if (content.scrollHeight <= content.clientHeight + 1) return
    node.remove()
    if (content.childElementCount) content = createPage()
    content.append(node)
    if (content.scrollHeight > content.clientHeight + 1) {
      node.remove()
      content = splitOversizedElement(node, content, createPage)
    }
  })
  const result = pages.map(({ content: pageContent }) => pageContent.innerHTML)
  host.replaceChildren()
  return result.length ? result : ['']
}
