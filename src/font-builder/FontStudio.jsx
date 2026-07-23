import { useEffect, useMemo, useRef, useState } from 'react'
import { loadGFont } from '../plotter/gfont.js'
import { ALL_CHARACTERS, CHARACTER_GROUPS, PREVIEW_TEXT } from './characters.js'
import FontCanvas from './FontCanvas.jsx'
import FontPreview from './FontPreview.jsx'
import { createGFontBlob, safeFontFilename } from './gfontExport.js'
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

function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
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
  const [activeGroup, setActiveGroup] = useState('ru')
  const [activeCharacter, setActiveCharacter] = useState('А')
  const [history, setHistory] = useState([])
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT.ru)
  const [notice, setNotice] = useState('')
  const importRef = useRef(null)
  const group = CHARACTER_GROUPS.find((item) => item.id === activeGroup) || CHARACTER_GROUPS[0]
  const completedCount = ALL_CHARACTERS.filter((character) => glyphs[character]?.some((stroke) => stroke.length > 1)).length
  const currentIndex = group.characters.indexOf(activeCharacter)
  const currentStrokes = glyphs[activeCharacter] || []

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ name, glyphs }))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [name, glyphs])

  const switchGroup = (id) => {
    const next = CHARACTER_GROUPS.find((item) => item.id === id)
    setActiveGroup(id)
    setActiveCharacter(next.characters[0])
    setPreviewText(PREVIEW_TEXT[id])
    setHistory([])
  }

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
    const index = (currentIndex + direction + group.characters.length) % group.characters.length
    setActiveCharacter(group.characters[index])
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

  return (
    <main className="font-studio">
      <header className="font-studio-header">
        <a className="font-studio-brand" href="/">
          <span>OH</span>
          <strong>OpenHand</strong>
        </a>
        <div className="font-studio-header-copy">
          <span>Мастерская шрифта</span>
          <small>Черновик сохраняется на этом устройстве</small>
        </div>
        <div className="font-studio-header-actions">
          <button type="button" onClick={() => importRef.current?.click()}>Открыть .gfont</button>
          <button className="font-primary-action" type="button" onClick={exportFont}>Скачать шрифт</button>
        </div>
      </header>

      <section className="font-studio-intro">
        <div>
          <p>ОДНОЛИНЕЙНЫЙ ШРИФТ</p>
          <h1>Сделайте почерк своим</h1>
          <span>Нарисуйте буквы одним или несколькими штрихами. Файл сразу готов для OpenHand и плоттера.</span>
        </div>
        <label>
          <span>Название шрифта</span>
          <input value={name} maxLength={48} onChange={(event) => setName(event.target.value)} />
        </label>
        <div className="font-studio-progress">
          <strong>{completedCount}<small> / {ALL_CHARACTERS.length}</small></strong>
          <span>готово символов</span>
          <i><b style={{ width: `${completedCount / ALL_CHARACTERS.length * 100}%` }} /></i>
        </div>
      </section>

      <nav className="font-language-tabs" aria-label="Наборы символов">
        {CHARACTER_GROUPS.map((item) => {
          const ready = item.characters.filter((character) => glyphs[character]?.length).length
          return (
            <button className={activeGroup === item.id ? 'active' : ''} type="button" key={item.id} onClick={() => switchGroup(item.id)}>
              <span>{item.label}</span>
              <small>{ready}/{item.characters.length}</small>
            </button>
          )
        })}
      </nav>

      <div className="font-studio-workspace">
        <aside className="font-character-panel">
          <div className="font-character-panel-title">
            <strong>{group.label}</strong>
            <span>Выберите символ</span>
          </div>
          <div className="font-character-grid">
            {group.characters.map((character) => (
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
        </aside>

        <section className="font-canvas-panel">
          <div className="font-canvas-toolbar">
            <div>
              <button type="button" aria-label="Предыдущий символ" onClick={() => moveCharacter(-1)}>←</button>
              <strong>{activeCharacter}</strong>
              <button type="button" aria-label="Следующий символ" onClick={() => moveCharacter(1)}>→</button>
              <span>{currentIndex + 1} из {group.characters.length}</span>
            </div>
            <div>
              <button type="button" disabled={!history.length} onClick={undo}>Отменить</button>
              <button type="button" disabled={!currentStrokes.length} onClick={clear}>Очистить</button>
            </div>
          </div>
          <FontCanvas character={activeCharacter} strokes={currentStrokes} onChange={updateGlyph} />
          <div className="font-canvas-hint">
            <span><i /> Рисуйте мышью, пером или пальцем</span>
            <span>Отпустите указатель, чтобы закончить штрих</span>
          </div>
        </section>

        <aside className="font-help-panel">
          <div>
            <span className="font-step-number">01</span>
            <strong>Нарисуйте знак</strong>
            <p>Серый символ — ориентир. Начинайте новый штрих после отрыва пера.</p>
          </div>
          <div>
            <span className="font-step-number">02</span>
            <strong>Заполните алфавит</strong>
            <p>Можно скачать и неполный шрифт. Пропущенные знаки будут отмечены в редакторе.</p>
          </div>
          <div>
            <span className="font-step-number">03</span>
            <strong>Загрузите в OpenHand</strong>
            <p>В основном редакторе нажмите «Загрузить» рядом с выбором шрифта.</p>
          </div>
          <button type="button" onClick={exportFont}>Скачать .gfont <span>↓</span></button>
          {notice && <p className="font-studio-notice" role="status">{notice}</p>}
        </aside>
      </div>

      <section className="font-live-preview">
        <div>
          <span>Живой предпросмотр</span>
          <input value={previewText} onChange={(event) => setPreviewText(event.target.value)} aria-label="Текст предпросмотра" />
        </div>
        <FontPreview text={previewText} glyphs={glyphs} />
      </section>

      <input ref={importRef} type="file" accept=".gfont,application/octet-stream" hidden onChange={importFont} />
    </main>
  )
}
