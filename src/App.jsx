import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { DEFAULT_SETTINGS, normalizeSettings, PAGE_SIZES, STORAGE_KEYS } from './app/config.js'
import { SAMPLE_MARKDOWN, SAMPLE_TEX } from './app/samples.js'
import EditorPanel from './components/editor/EditorPanel.jsx'
import PreviewPanel from './components/preview/PreviewPanel.jsx'
import SettingsPanel from './components/settings/SettingsPanel.jsx'
import { useDocumentPersistence } from './hooks/useDocumentPersistence.js'
import { useIntegratedPlotter } from './hooks/useIntegratedPlotter.js'
import { usePreviewInteractions } from './hooks/usePreviewInteractions.js'
import { useLineEffects, useRenderedPages } from './hooks/useRenderedPages.js'
import { downloadFile } from './lib/files.js'
import { getPageMetrics } from './lib/pagination.js'
import { loadStoredObject, loadStoredText } from './lib/storage.js'
import { renderMarkdown } from './markdown.js'
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
  const deferredMarkdown = useDeferredValue(markdown)
  const deferredTexSource = useDeferredValue(texSource)
  const renderSettings = useMemo(() => ({
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
  }), [
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
  const renderedHtml = useMemo(
    () => sourceMode === 'tex'
      ? renderTex(deferredTexSource, renderSettings, selectedPool)
      : renderMarkdown(deferredMarkdown, renderSettings, selectedPool),
    [sourceMode, deferredTexSource, deferredMarkdown, renderSettings, selectedPool],
  )
  const { pages, measureRef } = useRenderedPages(renderedHtml, settings)
  const setZoom = useCallback((zoom) => updateSetting('zoom', zoom), [updateSetting])

  useDocumentPersistence({ markdown, texSource, sourceMode, settings })
  useLineEffects(previewRef, pages, settings)
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
        marginBottom: 44,
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
    () => pages.map((html) => htmlToPlotterText(html)),
    [pages],
  )
  const plotterWorkspace = useIntegratedPlotter({
    enabled: settings.fontType === 'plotter',
    fontId: settings.plotterFontId,
    pageTexts: renderedPageTexts.length ? renderedPageTexts : [activeSource],
    settings,
    metrics,
    activeSheetIndex,
  })

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
            pages={pages}
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
