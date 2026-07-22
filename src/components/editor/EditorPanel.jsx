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
  return (
    <section className="editor-panel panel">
      <div className="panel-title editor-title">
        <div><strong>{sourceMode === 'tex' ? 'TeX' : 'Markdown'}</strong><small>{wordCount} слов · {characterCount} знаков</small></div>
        <div className="editor-title-actions">
          <div className="source-tabs" role="tablist" aria-label="Формат исходника">
            <button type="button" role="tab" aria-selected={sourceMode === 'markdown'} className={sourceMode === 'markdown' ? 'active' : ''} onClick={() => setSourceMode('markdown')}>MD</button>
            <button type="button" role="tab" aria-selected={sourceMode === 'tex'} className={sourceMode === 'tex' ? 'active' : ''} onClick={() => setSourceMode('tex')}>TeX</button>
          </div>
          <button type="button" className="text-button" onClick={() => setActiveSource('')}>Очистить</button>
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className="markdown-editor"
        value={activeSource}
        spellCheck={sourceMode === 'markdown'}
        onChange={(event) => setActiveSource(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Tab') {
            event.preventDefault()
            insertText('  ')
          }
        }}
        aria-label={sourceMode === 'tex' ? 'Редактор TeX' : 'Редактор Markdown'}
      />
      <div className="editor-footer"><span>Автосохранение в браузере</span><span>Ctrl/⌘ + S — скачать</span></div>
    </section>
  )
}
