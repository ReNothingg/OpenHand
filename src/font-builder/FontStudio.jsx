import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGFont } from '../plotter/gfont.js'
import { ALL_CHARACTERS, CHARACTER_GROUPS, PREVIEW_TEXT } from './characters.js'
import FontCanvas from './FontCanvas.jsx'
import FontPreview from './FontPreview.jsx'
import PhotoFontImporter from './PhotoFontImporter.jsx'
import { createGFontBlob, safeFontFilename } from './gfontExport.js'
import { downloadBlob } from '../lib/files.js'
import './font-studio.css'

const DRAFT_KEY = 'openhand.font-studio.draft.v1'

function readDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}')
    return {
      name: typeof draft.name === 'string' ? draft.name : 'Мой почерк',
      glyphs: draft.glyphs && typeof draft.glyphs === 'object' ? draft.glyphs : {},
    }
  } catch {
    return { name: 'Мой почерк', glyphs: {} }
  }
}

function splitGlyph(glyph) {
  const strokes = []
  let stroke = null
  glyph.points.forEach((point, index) => {
    if (glyph.flags[index] === 0 || !stroke) {
      stroke = []
      strokes.push(stroke)
    }
    stroke.push({ x: point.x, y: point.y })
  })
  return strokes.filter((item) => item.length > 1)
}

export default function FontStudio() {
  const initial = useMemo(readDraft, [])
  const [name, setName] = useState(initial.name)
  const [glyphs, setGlyphs] = useState(initial.glyphs)
  const [activeCharacter, setActiveCharacter] = useState('А')
  const [history, setHistory] = useState([])
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT.ru)
  const [previewSize, setPreviewSize] = useState(32)
  const [notice, setNotice] = useState('')
  const [photoOpen, setPhotoOpen] = useState(false)
  const importRef = useRef(null)
  const completedCount = ALL_CHARACTERS.filter((character) => glyphs[character]?.some((stroke) => stroke.length > 1)).length
  const currentIndex = ALL_CHARACTERS.indexOf(activeCharacter)
  const currentStrokes = glyphs[activeCharacter] || []

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, glyphs }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [name, glyphs])

  const updateGlyph = (strokes, options = {}) => {
    if (!options.transient) setHistory((current) => [...current.slice(-29), options.previous || currentStrokes])
    setGlyphs((current) => ({ ...current, [activeCharacter]: strokes }))
  }

  const undo = () => {
    const previous = history.at(-1)
    if (!previous) return
    setGlyphs((current) => ({ ...current, [activeCharacter]: previous }))
    setHistory((current) => current.slice(0, -1))
  }

  const clear = () => {
    if (!currentStrokes.length) return
    setHistory((current) => [...current.slice(-29), currentStrokes])
    setGlyphs((current) => ({ ...current, [activeCharacter]: [] }))
  }

  const moveCharacter = (direction) => {
    const index = (currentIndex + direction + ALL_CHARACTERS.length) % ALL_CHARACTERS.length
    setActiveCharacter(ALL_CHARACTERS[index])
    setHistory([])
  }

  const exportFont = () => {
    if (!completedCount) {
      setNotice('Нарисуйте хотя бы один символ перед скачиванием.')
      return
    }
    downloadBlob(createGFontBlob(glyphs), safeFontFilename(name))
    setNotice(`Шрифт скачан: ${completedCount} ${completedCount === 1 ? 'символ' : 'символов'}.`)
  }

  const importFont = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    setNotice('Читаем шрифт…')
    try {
      const font = await loadGFont(file)
      const imported = {}
      for (const character of ALL_CHARACTERS) {
        const glyph = await font.getGlyph(character.codePointAt(0))
        if (glyph) imported[character] = splitGlyph(glyph)
      }
      setGlyphs(imported)
      setName(file.name.replace(/\.gfont$/i, '') || 'Мой почерк')
      setNotice(`Загружено символов: ${Object.keys(imported).length}.`)
    } catch (reason) {
      setNotice(reason.message)
    }
    event.target.value = ''
  }

  const importPhotoCharacter = (strokes) => {
    setHistory((current) => [...current.slice(-29), currentStrokes])
    setGlyphs((current) => ({ ...current, [activeCharacter]: strokes }))
  }

  const importPhotoSheet = (imported, { replaceExisting = false } = {}) => {
    setGlyphs((current) => {
      if (replaceExisting) return { ...current, ...imported }
      return Object.fromEntries([
        ...Object.entries(current),
        ...Object.entries(imported).filter(([character]) => !current[character]?.length),
      ])
    })
    setHistory([])
  }

  return (
    <main className="font-studio">
      <header className="font-studio-toolbar">
        <a href="?">← В редактор</a>
        <label className="font-name-field">
          <span>Название</span>
          <input value={name} maxLength={48} onChange={(event) => setName(event.target.value)} aria-label="Название шрифта" />
        </label>
        <div className="font-studio-progress">
          <span>Готово</span>
          <strong>{completedCount} / {ALL_CHARACTERS.length}</strong>
        </div>
        <div className="font-studio-actions">
          <button type="button" onClick={() => setPhotoOpen(true)}>По фотографии</button>
          <button type="button" onClick={() => importRef.current?.click()}>Открыть .gfont</button>
          <button className="primary" type="button" onClick={exportFont}>Скачать .gfont</button>
        </div>
      </header>
      {notice && <p className="font-studio-notice" role="status">{notice}</p>}

      <div className="font-studio-workspace">
        <aside className="font-character-panel">
          <div className="font-character-panel-title">
            <strong>Символы</strong>
            <span>{completedCount} из {ALL_CHARACTERS.length}</span>
          </div>
          <div className="font-character-list">
            {CHARACTER_GROUPS.map((item) => {
              const ready = item.characters.filter((character) => glyphs[character]?.length).length
              return (
                <section className="font-character-group" key={item.id}>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{ready}/{item.characters.length}</small>
                  </div>
                  <div className="font-character-grid">
                    {item.characters.map((character) => (
                      <button
                        className={[
                          activeCharacter === character ? 'active' : '',
                          glyphs[character]?.length ? 'complete' : '',
                        ].filter(Boolean).join(' ')}
                        type="button"
                        key={character}
                        onClick={() => { setActiveCharacter(character); setHistory([]) }}
                        aria-label={`Редактировать символ ${character}`}
                      >
                        {character}
                        <i />
                      </button>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        </aside>

        <div className="font-studio-main">
          <section className="font-canvas-panel">
            <div className="font-canvas-toolbar">
              <div>
                <button type="button" aria-label="Предыдущий символ" onClick={() => moveCharacter(-1)}>←</button>
                <strong>{activeCharacter}</strong>
                <button type="button" aria-label="Следующий символ" onClick={() => moveCharacter(1)}>→</button>
                <span>{currentIndex + 1} из {ALL_CHARACTERS.length}</span>
              </div>
              <div>
                <button type="button" disabled={!history.length} onClick={undo}>Отменить</button>
                <button type="button" disabled={!currentStrokes.length} onClick={clear}>Очистить</button>
              </div>
            </div>
            <FontCanvas character={activeCharacter} strokes={currentStrokes} onChange={updateGlyph} />
          </section>

          <section className="font-live-preview">
            <div className="font-preview-toolbar">
              <label>
                <span>Предпросмотр</span>
                <input value={previewText} onChange={(event) => setPreviewText(event.target.value)} aria-label="Текст предпросмотра" />
              </label>
              <label className="font-preview-size">
                <span>Размер</span>
                <input
                  type="range"
                  min="14"
                  max="56"
                  value={previewSize}
                  onChange={(event) => setPreviewSize(Number(event.target.value))}
                  aria-label="Размер шрифта в предпросмотре"
                />
                <output>{previewSize} px</output>
              </label>
            </div>
            <FontPreview text={previewText} glyphs={glyphs} size={previewSize} />
          </section>
        </div>
      </div>

      <input ref={importRef} type="file" accept=".gfont,application/octet-stream" hidden onChange={importFont} />
      {photoOpen && (
        <PhotoFontImporter
          activeCharacter={activeCharacter}
          characters={ALL_CHARACTERS}
          onImportCharacter={importPhotoCharacter}
          onImportSheet={importPhotoSheet}
          onClose={() => setPhotoOpen(false)}
        />
      )}
    </main>
  )
}
