import { useEffect, useMemo, useRef, useState } from 'react'

function FormattingBar({ sourceMode, onFormat, compact = false }) {
  const markdownActions = [
    ['B', 'Жирный', '**', '**', 'жирный текст'],
    ['I', 'Курсив', '*', '*', 'курсив'],
    ['U', 'Подчёркивание', '++', '++', 'подчёркнутый текст'],
    ['U═', 'Двойное подчёркивание', '+++', '+++', 'двойное подчёркивание'],
    ['U≈', 'Волнистое подчёркивание', '<span class="underline-wavy">', '</span>', 'важный фрагмент'],
    ['S', 'Зачёркивание', '~~', '~~', 'зачёркнутый текст'],
    ['▰', 'Маркер', '==', '==', 'выделенный текст'],
    ['$x$', 'Формула в строке', '$', '$', 'E = mc^2'],
    ['$$', 'Формула отдельной строкой', '\n$$\n', '\n$$\n', '\\int_a^b f(x)\\,dx'],
  ]
  const texActions = [
    ['B', 'Жирный', '\\textbf{', '}', 'жирный текст'],
    ['I', 'Курсив', '\\textit{', '}', 'курсив'],
    ['U', 'Подчёркивание', '\\underline{', '}', 'подчёркнутый текст'],
    ['$x$', 'Формула в строке', '\\(', '\\)', 'E = mc^2'],
    ['$$', 'Формула отдельной строкой', '\n\\[\n', '\n\\]\n', '\\int_a^b f(x)\\,dx'],
  ]
  const actions = sourceMode === 'tex' ? texActions : markdownActions

  return (
    <div className={`formatting-bar ${compact ? 'compact' : ''}`} aria-label="Форматирование текста">
      {actions.map(([label, title, before, after, placeholder]) => (
        <button type="button" title={title} aria-label={title} key={title} onClick={() => onFormat(before, after, placeholder)}>{label}</button>
      ))}
    </div>
  )
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
  const expandedRef = useRef(null)
  const lineCount = useMemo(() => activeSource.split('\n').length, [activeSource])

  useEffect(() => {
    if (!expanded) return undefined
    const close = (event) => event.key === 'Escape' && setExpanded(false)
    window.addEventListener('keydown', close)
    requestAnimationFrame(() => expandedRef.current?.focus())
    return () => window.removeEventListener('keydown', close)
  }, [expanded])

  const applyFormat = (targetRef, before, after, placeholder) => {
    const target = targetRef.current
    if (!target) return
    const start = target.selectionStart
    const end = target.selectionEnd
    const selected = activeSource.slice(start, end) || placeholder
    const replacement = `${before}${selected}${after}`
    setActiveSource(`${activeSource.slice(0, start)}${replacement}${activeSource.slice(end)}`)
    requestAnimationFrame(() => {
      target.focus()
      target.setSelectionRange(start + before.length, start + before.length + selected.length)
    })
  }

  const handleTab = (event) => {
    if (event.key === 'Tab') {
      event.preventDefault()
      const ref = event.currentTarget === expandedRef.current ? expandedRef : textareaRef
      const target = ref.current
      const start = target.selectionStart
      const end = target.selectionEnd
      setActiveSource(`${activeSource.slice(0, start)}  ${activeSource.slice(end)}`)
      requestAnimationFrame(() => target.setSelectionRange(start + 2, start + 2))
    }
  }

  return (
    <section className={`editor-panel panel ${expanded ? 'has-expanded-editor' : ''}`}>
      <div className="panel-title editor-title">
        <div><strong>{sourceMode === 'tex' ? 'TeX' : 'Markdown'}</strong><small>{wordCount} слов · {characterCount} знаков</small></div>
        <div className="editor-title-actions">
          <div className="source-tabs" role="tablist" aria-label="Формат исходника">
            <button type="button" role="tab" aria-selected={sourceMode === 'markdown'} className={sourceMode === 'markdown' ? 'active' : ''} onClick={() => setSourceMode('markdown')}>MD</button>
            <button type="button" role="tab" aria-selected={sourceMode === 'tex'} className={sourceMode === 'tex' ? 'active' : ''} onClick={() => setSourceMode('tex')}>TeX</button>
          </div>
          <button type="button" className="editor-expand-button" onClick={() => setExpanded(true)} aria-label="Открыть большой редактор" title="Открыть большой редактор">↗</button>
          <button type="button" className="text-button" onClick={() => setActiveSource('')}>Очистить</button>
        </div>
      </div>
      <FormattingBar sourceMode={sourceMode} compact onFormat={(before, after, placeholder) => applyFormat(textareaRef, before, after, placeholder)} />
      <textarea
        ref={textareaRef}
        className="markdown-editor"
        value={activeSource}
        spellCheck={sourceMode === 'markdown'}
        onChange={(event) => setActiveSource(event.target.value)}
        onKeyDown={handleTab}
        aria-label={sourceMode === 'tex' ? 'Редактор TeX' : 'Редактор Markdown'}
      />
      <div className="editor-footer"><span>Автосохранение в браузере</span><span>Ctrl/⌘ + S — скачать</span></div>

      {expanded && (
        <div className="expanded-editor-backdrop" role="presentation">
          <section className="expanded-editor" role="dialog" aria-modal="true" aria-label="Большой редактор текста">
            <header>
              <div className="expanded-editor-identity"><span className="editor-document-dot" /><div><strong>Большой редактор</strong><small>{sourceMode === 'tex' ? 'Документ TeX' : 'Документ Markdown'} · сохраняется автоматически</small></div></div>
              <div className="expanded-editor-header-actions">
                <div className="source-tabs" role="tablist" aria-label="Формат большого редактора">
                  <button type="button" role="tab" aria-selected={sourceMode === 'markdown'} className={sourceMode === 'markdown' ? 'active' : ''} onClick={() => setSourceMode('markdown')}>Markdown</button>
                  <button type="button" role="tab" aria-selected={sourceMode === 'tex'} className={sourceMode === 'tex' ? 'active' : ''} onClick={() => setSourceMode('tex')}>TeX</button>
                </div>
                <button className="expanded-editor-close" type="button" onClick={() => setExpanded(false)} aria-label="Закрыть большой редактор">×</button>
              </div>
            </header>
            <FormattingBar sourceMode={sourceMode} onFormat={(before, after, placeholder) => applyFormat(expandedRef, before, after, placeholder)} />
            <div className="expanded-editor-body">
              <textarea ref={expandedRef} value={activeSource} spellCheck={sourceMode === 'markdown'} onChange={(event) => setActiveSource(event.target.value)} onKeyDown={handleTab} aria-label="Большое поле редактирования" />
              <aside>
                <strong>Шпаргалка</strong>
                {sourceMode === 'markdown' ? <>
                  <code># Заголовок</code><code>**жирный**</code><code>*курсив*</code><code>++подчёркнутый++</code><code>+++двойная линия+++</code><code>~~зачёркнутый~~</code><code>==маркер==</code><code>$E = mc^2$</code><code>$$ ... $$</code><code>&gt; цитата</code><code>- список</code>
                </> : <>
                  <code>\section&#123;Раздел&#125;</code><code>\textbf&#123;жирный&#125;</code><code>\textit&#123;курсив&#125;</code><code>\underline&#123;текст&#125;</code><code>\(E = mc^2\)</code><code>\[ ... \]</code><code>\begin&#123;enumerate&#125;</code><code>\item пункт</code>
                </>}
                <p>Esc закрывает окно. Tab вставляет два пробела.</p>
              </aside>
            </div>
            <footer><span>{lineCount} строк</span><span>{wordCount} слов</span><span>{characterCount.toLocaleString('ru-RU')} знаков</span><i /> <span>Изменения сохранены</span></footer>
          </section>
        </div>
      )}
    </section>
  )
}
