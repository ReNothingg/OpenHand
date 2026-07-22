import { useEffect, useMemo, useRef, useState } from 'react'

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
      <textarea
        ref={textareaRef}
        className="markdown-editor"
        value={activeSource}
        spellCheck={sourceMode === 'markdown'}
        onChange={(event) => setActiveSource(event.target.value)}
        onKeyDown={handleTab}
        aria-label={sourceMode === 'tex' ? 'Редактор TeX' : 'Редактор Markdown'}
      />
      {expanded && (
        <div className="expanded-editor-backdrop" role="presentation">
          <section className="expanded-editor" role="dialog" aria-modal="true" aria-label="Большой редактор текста">
            <header>
              <div className="expanded-editor-identity"><span className="editor-document-dot" /><div><strong>Большой редактор</strong></div></div>
              <div className="expanded-editor-header-actions">
                <div className="source-tabs" role="tablist" aria-label="Формат большого редактора">
                  <button type="button" role="tab" aria-selected={sourceMode === 'markdown'} className={sourceMode === 'markdown' ? 'active' : ''} onClick={() => setSourceMode('markdown')}>Markdown</button>
                  <button type="button" role="tab" aria-selected={sourceMode === 'tex'} className={sourceMode === 'tex' ? 'active' : ''} onClick={() => setSourceMode('tex')}>TeX</button>
                </div>
                <button className="expanded-editor-close" type="button" onClick={() => setExpanded(false)} aria-label="Закрыть большой редактор">×</button>
              </div>
            </header>
            <div className="expanded-editor-body">
              <textarea ref={expandedRef} value={activeSource} spellCheck={sourceMode === 'markdown'} onChange={(event) => setActiveSource(event.target.value)} onKeyDown={handleTab} aria-label="Большое поле редактирования" />
              <aside>
                <strong>Шпаргалка</strong>
                {sourceMode === 'markdown' ? <>
                  <code># Заголовок</code><code>**жирный**</code><code>*курсив*</code><code>++подчёркнутый++</code><code>+++двойная линия+++</code><code>~~зачёркнутый~~</code><code>==маркер==</code><code>$E = mc^2$</code><code>$$ ... $$</code><code>&gt; цитата</code><code>- список</code>
                </> : <>
                  <code>\section&#123;Раздел&#125;</code><code>\textbf&#123;жирный&#125;</code><code>\textit&#123;курсив&#125;</code><code>\underline&#123;текст&#125;</code><code>\(E = mc^2\)</code><code>\[ ... \]</code><code>\begin&#123;enumerate&#125;</code><code>\item пункт</code>
                </>}
              </aside>
            </div>
            <footer><span>{lineCount} строк</span><span>{wordCount} слов</span><span>{characterCount.toLocaleString('ru-RU')} знаков</span></footer>
          </section>
        </div>
      )}
    </section>
  )
}
