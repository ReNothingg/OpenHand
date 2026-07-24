import { PAGE_SIZES } from '../app/config.js'

export function getPageMetrics(settings) {
  const page = PAGE_SIZES[settings.pageSize]
  const landscape = settings.pageOrientation === 'landscape'
  const width = landscape ? page.height : page.width
  const height = landscape ? page.width : page.height
  const horizontalMargin = Math.max(settings.marginLeft, settings.marginLeftEven)
  const spreadInnerMargin = 24
  const writableWidth = settings.pageSize === 'NotebookSpread' ? width / 2 : width
  return {
    ...page,
    width,
    height,
    orientation: landscape ? 'Альбомная' : 'Книжная',
    spreadInnerMargin,
    contentHeight: Math.max(180, height - settings.marginTop - settings.marginBottom),
    contentWidth: Math.min(settings.textWidth, Math.max(220, writableWidth - horizontalMargin - spreadInnerMargin)),
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

function getSplitUnits(element) {
  const words = [...element.querySelectorAll('.hw-word')]
  return words.length > 1 ? words : [...element.querySelectorAll('.hw-letter')]
}

function cloneThroughUnit(element, unit) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setEndAfter(unit)
  const fragment = element.cloneNode(false)
  fragment.append(range.cloneContents())
  return fragment
}

function cloneAfterUnit(element, unit) {
  const range = document.createRange()
  range.selectNodeContents(element)
  range.setStartAfter(unit)
  const fragment = element.cloneNode(false)
  fragment.append(range.cloneContents())
  return fragment
}

function fitsOnPage(content, element) {
  content.append(element)
  const fits = content.scrollHeight <= content.clientHeight + 1
  element.remove()
  return fits
}

function createTableFragment(table, includeFooter = false) {
  const fragment = table.cloneNode(false)
  table.querySelectorAll(':scope > caption, :scope > colgroup, :scope > thead').forEach((section) => {
    fragment.append(section.cloneNode(true))
  })
  const body = document.createElement('tbody')
  fragment.append(body)
  if (includeFooter) {
    table.querySelectorAll(':scope > tfoot').forEach((footer) => {
      fragment.append(footer.cloneNode(true))
    })
  }
  return { fragment, body }
}

function splitTableAcrossPages(table, content, createPage) {
  const intactTable = table.cloneNode(true)
  if (fitsOnPage(content, intactTable)) {
    content.append(table)
    return content
  }

  const rows = [...table.querySelectorAll(':scope > tbody > tr')]
  if (!rows.length) {
    if (content.childElementCount) content = createPage()
    content.append(table)
    return content
  }

  let { fragment, body } = createTableFragment(table)
  content.append(fragment)

  rows.forEach((sourceRow) => {
    const row = sourceRow.cloneNode(true)
    body.append(row)
    if (content.scrollHeight <= content.clientHeight + 1) return

    row.remove()
    if (!body.rows.length) fragment.remove()
    content = createPage()
    const nextTable = createTableFragment(table)
    fragment = nextTable.fragment
    body = nextTable.body
    content.append(fragment)
    body.append(row)
  })

  const footer = table.querySelector(':scope > tfoot')
  if (footer) {
    const footerClone = footer.cloneNode(true)
    fragment.append(footerClone)
    if (content.scrollHeight > content.clientHeight + 1 && body.rows.length > 1) {
      footerClone.remove()
      const lastRow = body.rows[body.rows.length - 1]
      lastRow.remove()
      content = createPage()
      const nextTable = createTableFragment(table, true)
      fragment = nextTable.fragment
      body = nextTable.body
      content.append(fragment)
      body.append(lastRow)
    }
  }

  return content
}

function splitElementAcrossPages(element, content, createPage) {
  if (element.matches('table')) {
    return splitTableAcrossPages(element, content, createPage)
  }

  let working = element.cloneNode(true)
  let guard = 0
  while (working && guard < 100) {
    guard += 1
    const units = getSplitUnits(working)
    if (!units.length) {
      if (content.childElementCount && !fitsOnPage(content, working)) content = createPage()
      content.append(working)
      return content
    }

    let low = 1
    let high = units.length
    let best = 0
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const candidate = cloneThroughUnit(working, units[middle - 1])
      if (fitsOnPage(content, candidate)) {
        best = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }

    if (!best) {
      if (content.childElementCount) {
        content = createPage()
        continue
      }
      content.append(working)
      return content
    }

    if (best >= units.length) {
      content.append(working)
      return content
    }

    const usesWords = working.querySelectorAll('.hw-word').length > 1
    const minimumFragment = usesWords ? Math.min(3, units.length) : 1
    if (content.childElementCount && best < minimumFragment) {
      content = createPage()
      continue
    }

    const remaining = units.length - best
    if (usesWords && remaining < minimumFragment && best > minimumFragment) {
      best -= minimumFragment - remaining
    }

    content.append(cloneThroughUnit(working, units[best - 1]))
    working = cloneAfterUnit(working, units[best - 1])
    content = createPage()
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
    content = splitElementAcrossPages(node, content, createPage)
  })
  const result = pages.map(({ content: pageContent }) => pageContent.innerHTML)
  host.replaceChildren()
  return result.length ? result : ['']
}
