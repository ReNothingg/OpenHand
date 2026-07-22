import { useLayoutEffect, useRef, useState } from 'react'
import { applyLineEffects } from '../markdown.js'
import { paginateHtml } from '../lib/pagination.js'

export function useRenderedPages(renderedHtml, settings) {
  const [pages, setPages] = useState([''])
  const measureRef = useRef(null)

  useLayoutEffect(() => {
    let cancelled = false
    const calculate = async () => {
      await document.fonts.ready
      if (cancelled || !measureRef.current) return
      setPages(paginateHtml(renderedHtml, settings, measureRef.current))
    }
    calculate()
    return () => { cancelled = true }
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
  ])

  return { pages, measureRef }
}

export function useLineEffects(previewRef, pages, settings) {
  useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => applyLineEffects(previewRef.current, settings))
    return () => cancelAnimationFrame(frame)
  }, [
    previewRef,
    pages,
    settings.seed,
    settings.directionChance,
    settings.wordFrequency,
    settings.maxWordTilt,
    settings.maxLift,
    settings.fontRandomization,
    settings.maxLetterSpacing,
    settings.letterFrequency,
    settings.maxLineDrift,
    settings.maxLineIndent,
  ])
}
