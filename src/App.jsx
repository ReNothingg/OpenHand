import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, normalizeSettings, PAGE_SIZES, STORAGE_KEYS } from './app/config.js'
import { SAMPLE_MARKDOWN, SAMPLE_TEX } from './app/samples.js'
import EditorPanel from './components/editor/EditorPanel.jsx'
import PreviewPanel from './components/preview/PreviewPanel.jsx'
import SettingsPanel from './components/settings/SettingsPanel.jsx'
import { useDocumentPersistence } from './hooks/useDocumentPersistence.js'
import { useDebouncedValue } from './hooks/useDebouncedValue.js'
import { useIntegratedPlotter } from './hooks/useIntegratedPlotter.js'
import { usePreviewInteractions } from './hooks/usePreviewInteractions.js'
import { useLineEffects, useRenderedPages } from './hooks/useRenderedPages.js'
import { downloadFile } from './lib/files.js'
import { loadStoredGFonts, saveStoredGFont } from './lib/customGFonts.js'
import { getPageMetrics } from './lib/pagination.js'
import { arrangeManualPages, createManualPages, updatePlacementDirective } from './lib/manualLayout.js'
import { loadStoredObject, loadStoredText } from './lib/storage.js'
import { renderMarkdown } from './markdown.js'
import { loadGFont } from './plotter/gfont.js'
import { htmlToPlotterText } from './plotter/richText.js'
import { renderTex } from './tex.js'

export default function App() {
  const [markdown, setMarkdown] = useState(() => loadStoredText(STORAGE_KEYS.markdown, SAMPLE_MARKDOWN))
  const [texSource, setTexSource] = useState(() => loadStoredText(STORAGE_KEYS.tex, SAMPLE_TEX))
  const [sourceMode, setSourceMode] = useState(() => localStorage.getItem(STORAGE_KEYS.sourceMode) === 'tex' ? 'tex' : 'markdown')
  const [settings, setSettings] = useState(() => normalizeSettings(loadStoredObject(STORAGE_KEYS.settings, {})))
  const [presets, setPresets] = useState(() => loadStoredObject(STORAGE_KEYS.presets, {}))
  const [activePreset, setActivePreset] = useState('')
  const [previewOnly, setPreviewOnly] = useState(false)
  const [viewMode, setViewMode] = useState('single')
  const [activeSheetIndex, setActiveSheetIndex] = useState(0)
  const [manualEditing, setManualEditing] = useState(false)
  const [manualLayouts, setManualLayouts] = useState(() => loadStoredObject(STORAGE_KEYS.manualLayout, {}))
  const [customPlotterFonts, setCustomPlotterFonts] = useState([])
  const [customFontsReady, setCustomFontsReady] = useState(false)

  const textareaRef = useRef(null)
  const previewRef = useRef(null)
  const sourceImportRef = useRef(null)
  const settingsImportRef = useRef(null)

  const activeSource = sourceMode === 'tex' ? texSource : markdown
  const setActiveSource = useCallback((value) => {
    if (sourceMode === 'tex') setTexSource(value)
    else setMarkdown(value)
  }, [sourceMode])
  const updateSetting = useCallback((key, value) => {
    setSettings((current) => ({ ...current, [key]: value }))
  }, [])
  const updateFontSelection = useCallback(({ type, value }) => {
    setSettings((current) => type === 'plotter'
      ? { ...current, fontType: 'plotter', plotterFontId: value }
      : { ...current, fontType: 'screen', fontFamily: value })
  }, [])
  const uploadCustomFont = useCallback(async (file) => {
    if (!file) return
    try {
      const buffer = await file.arrayBuffer()
      const font = await loadGFont(buffer, file.name)
      const record = await saveStoredGFont(file.name, buffer)
      const savedFont = { ...record, font, plotterFontId: `custom:${record.id}` }
      setCustomPlotterFonts((current) => [
        savedFont,
        ...current.filter((item) => item.id !== record.id),
      ])
      setSettings((current) => ({
        ...current,
        fontType: 'plotter',
        plotterFontId: savedFont.plotterFontId,
      }))
    } catch (reason) {
      window.alert(reason instanceof Error ? reason.message : 'Не удалось открыть шрифт.')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    loadStoredGFonts()
      .then(async (records) => {
        const loaded = (await Promise.all(records.map(async (record) => {
          try {
            return {
              ...record,
              font: await loadGFont(record.buffer, record.name),
              plotterFontId: `custom:${record.id}`,
            }
          } catch {
            return null
          }
        }))).filter(Boolean)
        if (!cancelled) {
          setCustomPlotterFonts((current) => [
            ...current,
            ...loaded.filter((font) => !current.some((item) => item.id === font.id)),
          ].sort((left, right) => right.updatedAt - left.updatedAt))
        }
      })
      .catch(() => {
        if (!cancelled) setCustomPlotterFonts([])
      })
      .finally(() => {
        if (!cancelled) setCustomFontsReady(true)
      })
    return () => { cancelled = true }
  }, [])

  const customPlotterFont = useMemo(
    () => customPlotterFonts.find((item) => item.plotterFontId === settings.plotterFontId) || null,
    [customPlotterFonts, settings.plotterFontId],
  )

  useEffect(() => {
    if (
      customFontsReady &&
      settings.plotterFontId.startsWith('custom:') &&
      !customPlotterFont
    ) {
      setSettings((current) => ({
        ...current,
        fontType: 'plotter',
        plotterFontId: DEFAULT_SETTINGS.plotterFontId,
      }))
    }
  }, [customFontsReady, customPlotterFont, settings.plotterFontId])

  const metrics = useMemo(() => getPageMetrics(settings), [
    settings.pageSize,
    settings.pageOrientation,
    settings.marginTop,
    settings.marginLeft,
    settings.marginLeftEven,
    settings.marginBottom,
    settings.textWidth,
  ])
  const selectedPool = useMemo(
    () => settings.fontPool?.length ? settings.fontPool : [settings.fontFamily],
    [settings.fontPool, settings.fontFamily],
  )
  const calculationSettings = useMemo(() => ({
    fontFamily: settings.fontFamily,
    fontSize: settings.fontSize,
    textWidth: settings.textWidth,
    lineHeight: settings.lineHeight,
    marginTop: settings.marginTop,
    marginLeft: settings.marginLeft,
    marginLeftEven: settings.marginLeftEven,
    marginBottom: settings.marginBottom,
    pageSize: settings.pageSize,
    pageOrientation: settings.pageOrientation,
    seed: settings.seed,
    directionChance: settings.directionChance,
    wordFrequency: settings.wordFrequency,
    maxWordTilt: settings.maxWordTilt,
    maxLift: settings.maxLift,
    fontRandomization: settings.fontRandomization,
    maxLetterSpacing: settings.maxLetterSpacing,
    letterFrequency: settings.letterFrequency,
    maxLineDrift: settings.maxLineDrift,
    maxLineIndent: settings.maxLineIndent,
    trueHandwriting: settings.trueHandwriting,
    glyphVariation: settings.glyphVariation,
    connectionStrength: settings.connectionStrength,
    correctionChance: settings.correctionChance,
    pressureVariation: settings.pressureVariation,
  }), [
    settings.fontFamily,
    settings.fontSize,
    settings.textWidth,
    settings.lineHeight,
    settings.marginTop,
    settings.marginLeft,
    settings.marginLeftEven,
    settings.marginBottom,
    settings.pageSize,
    settings.pageOrientation,
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
    settings.trueHandwriting,
    settings.glyphVariation,
    settings.connectionStrength,
    settings.correctionChance,
    settings.pressureVariation,
  ])
  const deferredSettings = useDebouncedValue(calculationSettings)
  const deferredMarkdown = useDebouncedValue(markdown, 90)
  const deferredTexSource = useDebouncedValue(texSource, 90)
  const deferredPool = useDebouncedValue(selectedPool)
  const calculationPending = (
    deferredSettings !== calculationSettings ||
    deferredPool !== selectedPool ||
    (sourceMode === 'tex' ? deferredTexSource !== texSource : deferredMarkdown !== markdown)
  )
  const layoutMetrics = useMemo(() => getPageMetrics(deferredSettings), [deferredSettings])
  const renderSettings = useMemo(() => ({
    seed: deferredSettings.seed,
    directionChance: deferredSettings.directionChance,
    wordFrequency: deferredSettings.wordFrequency,
    maxWordTilt: deferredSettings.maxWordTilt,
    maxLift: deferredSettings.maxLift,
    fontRandomization: deferredSettings.fontRandomization,
    maxLetterSpacing: deferredSettings.maxLetterSpacing,
    letterFrequency: deferredSettings.letterFrequency,
    maxLineDrift: deferredSettings.maxLineDrift,
    maxLineIndent: deferredSettings.maxLineIndent,
    trueHandwriting: deferredSettings.trueHandwriting,
    glyphVariation: deferredSettings.glyphVariation,
    connectionStrength: deferredSettings.connectionStrength,
    correctionChance: deferredSettings.correctionChance,
    pressureVariation: deferredSettings.pressureVariation,
  }), [deferredSettings])
  const renderedHtml = useMemo(
    () => sourceMode === 'tex'
      ? renderTex(deferredTexSource, renderSettings, deferredPool)
      : renderMarkdown(deferredMarkdown, renderSettings, deferredPool),
    [sourceMode, deferredTexSource, deferredMarkdown, renderSettings, deferredPool],
  )
  const { pages, measureRef } = useRenderedPages(renderedHtml, deferredSettings)
  const manualPages = useMemo(() => createManualPages(pages), [pages])
  useEffect(() => {
    setManualLayouts((current) => {
      const next = { ...current }
      let changed = false
      manualPages.forEach((blocks, originPage) => {
        blocks.forEach((block) => {
          if (!block.defaultLayout) return
          const existing = next[originPage]?.[block.id]
          if (existing?.sourceLayoutKey === block.sourceLayoutKey) return
          next[originPage] = { ...(next[originPage] || {}) }
          next[originPage][block.id] = {
            ...(existing || {}),
            ...block.defaultLayout,
            sourceLayoutKey: block.sourceLayoutKey,
            dirty: false,
          }
          changed = true
        })
      })
      return changed ? next : current
    })
  }, [manualPages])
  const arrangedManualPages = useMemo(
    () => arrangeManualPages(manualPages, manualLayouts),
    [manualPages, manualLayouts],
  )
  const displayPages = useMemo(
    () => Array.from({ length: arrangedManualPages.length }, (_, index) => pages[index] || ''),
    [arrangedManualPages.length, pages],
  )
  const setZoom = useCallback((zoom) => updateSetting('zoom', zoom), [updateSetting])

  useDocumentPersistence({ markdown, texSource, sourceMode, settings })
  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(STORAGE_KEYS.manualLayout, JSON.stringify(manualLayouts))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [manualLayouts])
  useLineEffects(previewRef, pages, deferredSettings)
  const panHandlers = usePreviewInteractions({
    previewRef,
    zoom: settings.zoom,
    setZoom,
    viewMode,
    pageSize: settings.pageSize,
    previewOnly,
    sourceMode,
  })

  const sourceFile = sourceMode === 'tex'
    ? { name: 'document.tex', type: 'application/x-tex;charset=utf-8' }
    : { name: 'document.md', type: 'text/markdown;charset=utf-8' }
  const downloadSource = useCallback(() => {
    downloadFile(sourceFile.name, activeSource, sourceFile.type)
  }, [activeSource, sourceFile.name, sourceFile.type])

  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        downloadSource()
      }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [downloadSource])

  const updatePageSize = (pageSize) => {
    setSettings((current) => {
      if (pageSize !== 'NotebookSpread') return { ...current, pageSize }
      return {
        ...current,
        pageSize,
        pageOrientation: 'landscape',
        marginTop: 56,
        marginLeft: 72,
        marginLeftEven: 72,
        marginBottom: 0,
        textWidth: Math.min(current.textWidth, Math.max(PAGE_SIZES[pageSize].width, PAGE_SIZES[pageSize].height) - 144),
        fontSize: Math.min(current.fontSize, 24),
        lineHeight: 1.25,
        ruledPaper: true,
      }
    })
  }

  const importSource = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    const contents = await file.text()
    if (file.name.toLowerCase().endsWith('.tex')) {
      setTexSource(contents)
      setSourceMode('tex')
    } else {
      setMarkdown(contents)
      setSourceMode('markdown')
    }
    event.target.value = ''
  }

  const importSettingsFile = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const incoming = JSON.parse(await file.text())
      setSettings(normalizeSettings(incoming))
    } catch {
      alert('Не удалось прочитать JSON с настройками.')
    }
    event.target.value = ''
  }

  const savePreset = () => {
    const name = window.prompt('Название пресета:', activePreset || 'Мой почерк')?.trim()
    if (!name) return
    const next = { ...presets, [name]: settings }
    setPresets(next)
    setActivePreset(name)
    localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(next))
  }

  const deletePreset = () => {
    if (!activePreset) return
    const next = { ...presets }
    delete next[activePreset]
    setPresets(next)
    setActivePreset('')
    localStorage.setItem(STORAGE_KEYS.presets, JSON.stringify(next))
  }

  const selectPreset = (name) => {
    setActivePreset(name)
    if (name) setSettings(normalizeSettings(presets[name]))
  }

  const togglePoolFont = (family) => {
    const pool = settings.fontPool || []
    updateSetting('fontPool', pool.includes(family) ? pool.filter((item) => item !== family) : [...pool, family])
  }

  const wordCount = activeSource.trim() ? activeSource.trim().split(/\s+/u).length : 0
  const renderedPageTexts = useMemo(
    () => displayPages.map((html) => htmlToPlotterText(html)),
    [displayPages],
  )
  const plotterPageBlocks = useMemo(
    () => arrangedManualPages.map((blocks) => blocks.map((block) => ({
      ...block,
      layout: block.layout,
    }))),
    [arrangedManualPages],
  )
  const plotterWorkspace = useIntegratedPlotter({
    enabled: settings.fontType === 'plotter',
    fontId: settings.plotterFontId,
    customFont: customPlotterFont,
    pageTexts: renderedPageTexts.length ? renderedPageTexts : [activeSource],
    pageBlocks: plotterPageBlocks,
    settings: deferredSettings,
    metrics: layoutMetrics,
    activeSheetIndex,
    pending: calculationPending,
  })
  const updateManualBlock = useCallback((originPage, blockId, patch) => {
    setManualLayouts((current) => ({
      ...current,
      [originPage]: {
        ...(current[originPage] || {}),
        [blockId]: { ...(current[originPage]?.[blockId] || {}), ...patch, dirty: true },
      },
    }))
  }, [])
  const measureManualBlocks = useCallback((pageIndex, measurements) => {
    setManualLayouts((current) => {
      const next = { ...current }
      let changed = false
      Object.entries(measurements).forEach(([blockId, measurement]) => {
        const originPage = Number.isFinite(measurement.originPage) ? measurement.originPage : pageIndex
        const pageLayout = { ...(next[originPage] || {}) }
        if (!pageLayout[blockId]) {
          const { originPage: ignored, ...geometry } = measurement
          pageLayout[blockId] = { ...geometry, pageIndex, rotation: 0, align: 'left', noWrap: false, dirty: false }
          next[originPage] = pageLayout
          changed = true
        }
      })
      return changed ? next : current
    })
  }, [])
  const resetManualBlock = useCallback((pageIndex, blockId) => {
    setManualLayouts((current) => {
      const pageLayout = { ...(current[pageIndex] || {}) }
      delete pageLayout[blockId]
      return { ...current, [pageIndex]: pageLayout }
    })
  }, [])
  const commitManualBlock = useCallback((originPage, blockId, layout) => {
    if (sourceMode !== 'markdown' || !blockId.startsWith('md-')) return
    setMarkdown((current) => updatePlacementDirective(current, blockId.slice(3), layout))
  }, [sourceMode])

  return (
    <div className={`app ${previewOnly ? 'preview-only' : ''}`}>
      <style>{`@page { size: ${metrics.width}px ${metrics.height}px; margin: 0; }`}</style>
      <div className="workspace">
        <EditorPanel
          sourceMode={sourceMode}
          setSourceMode={setSourceMode}
          activeSource={activeSource}
          setActiveSource={setActiveSource}
          textareaRef={textareaRef}
          wordCount={wordCount}
          characterCount={activeSource.length}
        />
        <PreviewPanel
            pages={displayPages}
            manualPages={arrangedManualPages}
            manualEditing={manualEditing}
            setManualEditing={setManualEditing}
            onUpdateManualBlock={updateManualBlock}
            onCommitManualBlock={commitManualBlock}
            onMeasureManualBlocks={measureManualBlocks}
            onResetManualBlock={resetManualBlock}
            settings={settings}
            metrics={metrics}
            viewMode={viewMode}
            setViewMode={setViewMode}
            previewOnly={previewOnly}
            setPreviewOnly={setPreviewOnly}
            reshuffle={() => updateSetting('seed', Math.floor(Math.random() * 999999))}
            previewRef={previewRef}
            measureRef={measureRef}
            panHandlers={{
              onPointerDown: panHandlers.beginPan,
              onPointerMove: panHandlers.movePan,
              onPointerUp: panHandlers.endPan,
              onPointerCancel: panHandlers.endPan,
            }}
            plotterWorkspace={plotterWorkspace}
            activeSheetIndex={activeSheetIndex}
            onActiveSheetChange={setActiveSheetIndex}
          />
        <SettingsPanel
            settings={settings}
            metrics={metrics}
            updateSetting={updateSetting}
            updateFontSelection={updateFontSelection}
            customPlotterFonts={customPlotterFonts}
            uploadCustomFont={uploadCustomFont}
            updatePageSize={updatePageSize}
            resetSettings={() => setSettings({ ...DEFAULT_SETTINGS })}
            togglePoolFont={togglePoolFont}
            presets={presets}
            activePreset={activePreset}
            selectPreset={selectPreset}
            savePreset={savePreset}
            deletePreset={deletePreset}
            sourceMode={sourceMode}
            openSource={() => sourceImportRef.current?.click()}
            downloadSource={downloadSource}
            exportSettings={() => downloadFile('handwriting-settings.json', JSON.stringify(settings, null, 2), 'application/json')}
            importSettings={() => settingsImportRef.current?.click()}
            plotterWorkspace={plotterWorkspace}
          />
      </div>

      <input ref={sourceImportRef} type="file" accept=".md,.markdown,.txt,.tex,text/markdown,text/plain,application/x-tex" hidden onChange={importSource} />
      <input ref={settingsImportRef} type="file" accept=".json,application/json" hidden onChange={importSettingsFile} />
    </div>
  )
}
