import { useEffect, useRef, useState } from 'react'
import { fonts } from '../../../fonts.js'

export default function FontPicker({ value, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const selected = fonts.find((font) => font.family === value) || fonts[0]
  const filtered = fonts.filter((font) => font.name.toLowerCase().includes(query.toLowerCase()))

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  return (
    <div className="font-picker" ref={rootRef}>
      <span className="field-label">Основной шрифт</span>
      <button className="font-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span style={{ fontFamily: `'${selected.family}'` }}>{selected.name}</span><b>⌄</b>
      </button>
      {open && (
        <div className="font-picker-menu">
          <input autoFocus type="search" value={query} placeholder="Найти шрифт…" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }} />
          <div className="font-picker-list" role="listbox">
            {['Скриншот', 'Дополнительные'].map((group) => {
              const groupFonts = filtered.filter((font) => font.group === group)
              if (!groupFonts.length) return null
              return (
                <div className="font-picker-group" key={group}>
                  <small>{group}</small>
                  {groupFonts.map((font) => (
                    <button
                      className={font.family === value ? 'selected' : ''}
                      type="button"
                      role="option"
                      aria-selected={font.family === value}
                      key={font.family}
                      onClick={() => { onChange(font.family); setOpen(false); setQuery('') }}
                    >
                      <span style={{ fontFamily: `'${font.family}'` }}>{font.name}</span>
                      {font.cyrillic === false && <em>Latin</em>}
                      {font.cyrillic === 'partial' && <em>част. кир.</em>}
                    </button>
                  ))}
                </div>
              )
            })}
            {!filtered.length && <div className="font-picker-empty">Ничего не найдено</div>}
          </div>
        </div>
      )}
    </div>
  )
}
