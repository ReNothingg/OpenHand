import { useEffect, useRef, useState } from 'react'
import { applyLineEffects } from '../markdown.js'
import { paginateHtml } from '../lib/pagination.js'

export function useRenderedPages(renderedHtml, settings) {
  const [pages, setPages] = useState([''])
  const measureRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    let frame = 0
    const calculate = async () => {
      await document.fonts.ready
      if (cancelled || !measureRef.current) return
      frame = requestAnimationFrame(() => {
        if (!cancelled && measureRef.current) {
          setPages(paginateHtml(
            renderedHtml,
            settings,
            measureRef.current,
            applyLineEffects,
          ))
        }
      })
    }
    calculate()
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [
    renderedHtml,
    settings.fontFamily,
    settings.fontSize,
    settings.lineHeight,
    settings.textWidth,
    settings.marginTop,
    settings.marginLeft,
    settings.marginLeftEven,
    settings.marginBottom,
    settings.pageSize,
    settings.pageOrientation,
    settings.seed,
    settings.directionChance,
    settings.maxLineDrift,
    settings.maxLineIndent,
  ])

  return { pages, measureRef }
}
