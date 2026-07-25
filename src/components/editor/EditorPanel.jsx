import DOMPurify from 'dompurify'
import { useEffect, useMemo, useRef, useState } from 'react'

const MARKDOWN_TOOLS = [
  { label: 'H1', title: 'Заголовок 1', kind: 'line', before: '# ' },
  { label: 'H2', title: 'Заголовок 2', kind: 'line', before: '## ' },
  { label: 'B', title: 'Жирный · ⌘B', before: '**', after: '**', placeholder: 'жирный текст', className: 'is-bold' },
  { label: 'I', title: 'Курсив · ⌘I', before: '*', after: '*', placeholder: 'курсив', className: 'is-italic' },
  { label: 'U', title: 'Подчёркнутый', before: '++', after: '++', placeholder: 'подчёркнутый текст', className: 'is-underline' },
  { label: '==', title: 'Выделить маркером', before: '==', after: '==', placeholder: 'выделенный текст' },
  { label: '“', title: 'Цитата', kind: 'line', before: '> ' },
  { label: '•', title: 'Маркированный список', kind: 'line', before: '- ' },
  { label: '☑', title: 'Задача', kind: 'line', before: '- [ ] ' },
  { label: '</>', title: 'Код', before: '`', after: '`', placeholder: 'код' },
  { label: '∑', title: 'Формула', before: '$', after: '$', placeholder: 'E = mc^2' },
  { label: '⇤', title: 'Блок по левому краю', kind: 'block', before: ':::left', after: ':::', placeholder: 'Текст по левому краю', className: 'is-alignment is-alignment-start' },
  { label: '↔', title: 'Блок по центру', kind: 'block', before: ':::center', after: ':::', placeholder: 'Текст по центру', className: 'is-alignment' },
  { label: '⇥', title: 'Блок по правому краю', kind: 'block', before: ':::right', after: ':::', placeholder: 'Текст по правому краю', className: 'is-alignment' },
]

const TEX_TOOLS = [
  { label: 'Раздел', title: 'Добавить раздел', before: '\\section{', after: '}', placeholder: 'Название' },
  { label: 'B', title: 'Жирный · ⌘B', before: '\\textbf{', after: '}', placeholder: 'жирный текст', className: 'is-bold' },
  { label: 'I', title: 'Курсив · ⌘I', before: '\\textit{', after: '}', placeholder: 'курсив', className: 'is-italic' },
  { label: 'U', title: 'Подчёркнутый', before: '\\underline{', after: '}', placeholder: 'текст', className: 'is-underline' },
  { label: '∑', title: 'Формула', before: '\\(', after: '\\)', placeholder: 'E = mc^2' },
  { label: '≡', title: 'Формула отдельной строкой', before: '\\[\n', after: '\n\\]', placeholder: 'E = mc^2' },
]

const MARKDOWN_HELP_GROUPS = [
  {
    title: 'Текст',
    items: [
      ['Заголовки', '# H1 … ###### H6'],
      ['Жирный', '**текст**'],
      ['Курсив', '*текст*'],
      ['Жирный курсив', '***текст***'],
      ['Подчёркнутый', '++текст++'],
      ['Двойная линия', '+++текст+++'],
      ['Маркер', '==текст=='],
      ['Зачёркнутый', '~~текст~~'],
      ['Код', '`код`'],
    ],
  },
  {
    title: 'Выравнивание',
    items: [
      ['Слева', ':::left\nТекст\n:::'],
      ['По центру', ':::center\nТекст\n:::'],
      ['Справа', ':::right\nТекст\n:::'],
    ],
  },
  {
    title: 'Блоки',
    items: [
      ['Цитата', '> Текст цитаты'],
      ['Заметка', '> [!NOTE]\n> Текст'],
      ['Совет', '> [!TIP]\n> Текст'],
      ['Важно', '> [!IMPORTANT]\n> Текст'],
      ['Внимание', '> [!WARNING]\n> Текст'],
      ['Код-блок', '```js\nкод\n```'],
    ],
  },
  {
    title: 'Списки и таблицы',
    items: [
      ['Список', '- пункт'],
      ['Нумерация', '1. пункт'],
      ['Задача', '- [ ] задача'],
      ['Таблица', '| Имя | Балл |\n| --- | ---: |\n| Анна | 10 |'],
    ],
  },
  {
    title: 'Формулы и макет',
    items: [
      ['Формула', '$E = mc^2$'],
      ['Отдельно', '$$\nE = mc^2\n$$'],
      ['Ссылка', '[название](https://…)'],
      ['Разрыв', ':::pagebreak'],
      ['Размещение', ':::place id=note page=2 x=40 y=70 width=320 align=center\nТекст\n:::'],
      ['SVG', 'Кнопка SVG в панели'],
    ],
  },
]

const TEX_HELP_GROUPS = [
  {
    title: 'Основное',
    items: [
      ['Раздел', '\\section{Текст}'],
      ['Жирный', '\\textbf{текст}'],
      ['Курсив', '\\textit{текст}'],
      ['Подчёркнутый', '\\underline{текст}'],
      ['Формула', '\\(E = mc^2\\)'],
      ['Отдельно', '\\[E = mc^2\\]'],
      ['Список', '\\begin{itemize}\n\\item пункт\n\\end{itemize}'],
      ['Разрыв', '\\newpage'],
    ],
  },
]

function cleanSvg(source) {
  const parsed = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (parsed.querySelector('parsererror') || parsed.documentElement.tagName.toLowerCase() !== 'svg') {
    throw new Error('Файл не является корректным SVG.')
  }
  const clean = DOMPurify.sanitize(parsed.documentElement.outerHTML, {
    USE_PROFILES: { svg: true, svgFilters: true },
    ADD_ATTR: ['viewBox', 'preserveAspectRatio'],
  })
  if (!clean.includes('<svg')) throw new Error('В SVG не осталось допустимого содержимого.')
  return clean
}

export default function EditorPanel({
  sourceMode,
  setSourceMode,
  activeSource,
  setActiveSource,
  textareaRef,
  insertText,
  wordCount,
  characterCount,
}) {
  const [expanded, setExpanded] = useState(false)
  const [helpOpen, setHelpOpen] = useState(false)
  const expandedRef = useRef(null)
  const svgInputRef = useRef(null)
  const lineCount = useMemo(() => activeSource.split('\n').length, [activeSource])

  useEffect(() => {
    if (!expanded) return undefined
    const close = (event) => event.key === 'Escape' && setExpanded(false)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', close)
    requestAnimationFrame(() => expandedRef.current?.focus())
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', close)
    }
  }, [expanded])

  useEffect(() => {
    setHelpOpen(false)
  }, [sourceMode])

  const updateSelection = ({ before = '', after = '', placeholder = 'текст', kind }) => {
    const target = expanded ? expandedRef.current : textareaRef.current
    if (!target) return
    const start = target.selectionStart
    const end = target.selectionEnd
    const selected = activeSource.slice(start, end)
    let replacement
    let selectionStart
    let selectionEnd

    if (kind === 'line') {
      const lineStart = activeSource.lastIndexOf('\n', Math.max(0, start - 1)) + 1
      const nextLineBreak = activeSource.indexOf('\n', end)
      const lineEnd = nextLineBreak === -1 ? activeSource.length : nextLineBreak
      const block = activeSource.slice(lineStart, lineEnd)
      replacement = block.split('\n').map((line) => `${before}${line}`).join('\n')
      setActiveSource(`${activeSource.slice(0, lineStart)}${replacement}${activeSource.slice(lineEnd)}`)
      selectionStart = lineStart + before.length
      selectionEnd = lineStart + replacement.length
    } else if (kind === 'block') {
      const content = selected || placeholder
      const leadingBreak = start > 0 && activeSource[start - 1] !== '\n' ? '\n\n' : ''
      const trailingBreak = end < activeSource.length && activeSource[end] !== '\n' ? '\n\n' : ''
      replacement = `${leadingBreak}${before}\n${content}\n${after}${trailingBreak}`
      setActiveSource(`${activeSource.slice(0, start)}${replacement}${activeSource.slice(end)}`)
      selectionStart = start + leadingBreak.length + before.length + 1
      selectionEnd = selectionStart + content.length
    } else {
      const content = selected || placeholder
      replacement = `${before}${content}${after}`
      setActiveSource(`${activeSource.slice(0, start)}${replacement}${activeSource.slice(end)}`)
      selectionStart = start + before.length
      selectionEnd = selectionStart + content.length
    }

    requestAnimationFrame(() => {
      target.focus()
      target.setSelectionRange(selectionStart, selectionEnd)
    })
  }

  const handleEditorKeyDown = (event) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      const target = event.currentTarget
      const start = target.selectionStart
      const end = target.selectionEnd
      setActiveSource(`${activeSource.slice(0, start)}  ${activeSource.slice(end)}`)
      requestAnimationFrame(() => target.setSelectionRange(start + 2, start + 2))
      return
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
      event.preventDefault()
      updateSelection(sourceMode === 'tex' ? TEX_TOOLS[1] : MARKDOWN_TOOLS[2])
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'i') {
      event.preventDefault()
      updateSelection(sourceMode === 'tex' ? TEX_TOOLS[2] : MARKDOWN_TOOLS[3])
    }
  }

  const importSvg = async (event) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 5 * 1024 * 1024) throw new Error('SVG больше 5 МБ — сначала упростите его.')
      const svg = cleanSvg(await file.text())
      const target = expanded ? expandedRef.current : textareaRef.current
      const start = target?.selectionStart ?? activeSource.length
      const end = target?.selectionEnd ?? start
      const block = `\n\n<figure class="imported-svg">\n${svg}\n</figure>\n\n`
      setActiveSource(`${activeSource.slice(0, start)}${block}${activeSource.slice(end)}`)
      requestAnimationFrame(() => {
        const position = start + block.length
        target?.focus()
        target?.setSelectionRange(position, position)
      })
    } catch (error) {
      window.alert(error.message)
    }
  }

  return (
    <section className={`editor-panel panel ${expanded ? 'has-expanded-editor' : ''}`}>
      <div className="panel-title editor-title">
        <div className="source-tabs" role="tablist" aria-label="Формат исходника">
          <button type="button" role="tab" aria-selected={sourceMode === 'markdown'} className={sourceMode === 'markdown' ? 'active' : ''} onClick={() => setSourceMode('markdown')}>MD</button>
          <button type="button" role="tab" aria-selected={sourceMode === 'tex'} className={sourceMode === 'tex' ? 'active' : ''} onClick={() => setSourceMode('tex')}>TeX</button>
        </div>
        <div className="editor-title-actions">
          {sourceMode === 'markdown' && <button type="button" className="editor-expand-button editor-svg-button" onClick={() => svgInputRef.current?.click()} title="Вставить SVG">SVG</button>}
          <button type="button" className="editor-expand-button" onClick={() => setExpanded(true)} aria-label="Открыть большой редактор" title="Открыть большой редактор">↗</button>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className="markdown-editor"
        value={activeSource}
        spellCheck={sourceMode === 'markdown'}
        onChange={(event) => setActiveSource(event.target.value)}
        onKeyDown={handleEditorKeyDown}
        aria-label={sourceMode === 'tex' ? 'Редактор TeX' : 'Редактор Markdown'}
      />
      {expanded && (
        <div className="expanded-editor-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setExpanded(false)}>
          <section className="expanded-editor" role="dialog" aria-modal="true" aria-label="Большой редактор текста">
            <header>
              <div className="expanded-editor-identity">
                <strong>Редактор</strong>
                <span aria-hidden="true">/</span>
                <small>{sourceMode === 'tex' ? 'TeX' : 'Markdown'}</small>
              </div>
              <div className="expanded-editor-header-actions">
                <div className="source-tabs" role="tablist" aria-label="Формат большого редактора">
                  <button type="button" role="tab" aria-selected={sourceMode === 'markdown'} className={sourceMode === 'markdown' ? 'active' : ''} onClick={() => setSourceMode('markdown')}>Markdown</button>
                  <button type="button" role="tab" aria-selected={sourceMode === 'tex'} className={sourceMode === 'tex' ? 'active' : ''} onClick={() => setSourceMode('tex')}>TeX</button>
                </div>
                <button className="expanded-editor-close" type="button" onClick={() => setExpanded(false)} aria-label="Закрыть большой редактор" title="Закрыть · Esc">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
                </button>
              </div>
            </header>
            <div className="expanded-editor-toolbar">
              <div className="editor-format-tools" role="toolbar" aria-label="Форматирование">
                {(sourceMode === 'tex' ? TEX_TOOLS : MARKDOWN_TOOLS).map((tool) => (
                  <button
                    key={tool.title}
                    type="button"
                    className={tool.className || ''}
                    onClick={() => updateSelection(tool)}
                    title={tool.title}
                    aria-label={tool.title}
                  >
                    {tool.label}
                  </button>
                ))}
              </div>
              <div className="editor-toolbar-actions">
                {sourceMode === 'markdown' && (
                  <button type="button" onClick={() => svgInputRef.current?.click()} title="Вставить SVG">
                    <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4 15.5V5.8A1.8 1.8 0 0 1 5.8 4h8.4A1.8 1.8 0 0 1 16 5.8v8.4a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 14.2Z" /><path d="m5 13 3.2-3.2 2.2 2.1 1.5-1.4L16 14.4M13.5 7.1h.01" /></svg>
                    <span>SVG</span>
                  </button>
                )}
                <button type="button" className={helpOpen ? 'active' : ''} onClick={() => setHelpOpen((value) => !value)} aria-expanded={helpOpen} aria-controls="editor-help" title="Синтаксис">
                  <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.5" /><path d="M7.9 7.7a2.3 2.3 0 0 1 4.4.9c0 1.7-2.3 1.8-2.3 3.3M10 14.4h.01" /></svg>
                  <span>Синтаксис</span>
                </button>
              </div>
            </div>
            <div className="expanded-editor-body">
              <textarea ref={expandedRef} value={activeSource} spellCheck={sourceMode === 'markdown'} onChange={(event) => setActiveSource(event.target.value)} onKeyDown={handleEditorKeyDown} aria-label="Большое поле редактирования" />
              {helpOpen && <aside id="editor-help" aria-label="Справка по синтаксису">
                <div className="editor-help-heading">
                  <div><strong>Синтаксис</strong><small>Короткая шпаргалка</small></div>
                  <button type="button" onClick={() => setHelpOpen(false)} aria-label="Закрыть справку">×</button>
                </div>
                {(sourceMode === 'markdown' ? MARKDOWN_HELP_GROUPS : TEX_HELP_GROUPS).map((group) => (
                  <section className="editor-help-group" key={group.title}>
                    <h3>{group.title}</h3>
                    <div className="editor-help-list">
                      {group.items.map(([label, example]) => (
                        <div className="editor-help-row" key={`${group.title}-${label}`}>
                          <span>{label}</span>
                          <code>{example}</code>
                        </div>
                      ))}
                    </div>
                  </section>
                ))}
              </aside>}
            </div>
            <footer>
              <div><span>{lineCount} строк</span><span>{wordCount} слов</span><span>{characterCount.toLocaleString('ru-RU')} знаков</span></div>
              <span><kbd>Esc</kbd> закрыть</span>
            </footer>
          </section>
        </div>
      )}
      <input ref={svgInputRef} type="file" accept=".svg,image/svg+xml" hidden onChange={importSvg} />
    </section>
  )
}
