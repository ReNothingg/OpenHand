import { useEffect, useMemo, useRef, useState } from 'react'
import { fonts } from '../../../fonts.js'
import { BUILTIN_GFONT_FAMILIES, BUILTIN_GFONT_OPTIONS } from '../../../plotter/gfont.js'

const HANDWRITTEN_GROUP = 'Рукописные · кириллица'
const SCREEN_GROUPS = [HANDWRITTEN_GROUP, 'Скриншот', 'Дополнительные']

function pluralize(count, one, few, many) {
  const tens = count % 100
  const units = count % 10
  if (tens >= 11 && tens <= 19) return many
  if (units === 1) return one
  if (units >= 2 && units <= 4) return few
  return many
}

export default function FontPicker({ fontType, value, plotterFontId, onChange }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const rootRef = useRef(null)
  const selectedScreen = fonts.find((font) => font.family === value) || fonts[0]
  const selectedPlotter = BUILTIN_GFONT_OPTIONS.find((font) => font.id === plotterFontId) || BUILTIN_GFONT_OPTIONS[0]
  const [activeFamilyId, setActiveFamilyId] = useState(selectedPlotter.familyId)
  const selected = fontType === 'plotter'
    ? { name: selectedPlotter.label, kind: 'plotter' }
    : { ...selectedScreen, kind: 'screen' }
  const normalizedQuery = query.trim().toLocaleLowerCase('ru')
  const filtered = useMemo(() => fonts.filter((font) => (
    `${font.name} ${font.group}`.toLocaleLowerCase('ru').includes(normalizedQuery)
  )), [normalizedQuery])
  const filteredFamilies = useMemo(() => BUILTIN_GFONT_FAMILIES.filter((family) => (
    `${family.label} ${family.description} ${family.variants.map((variant) => variant.label).join(' ')}`
      .toLocaleLowerCase('ru')
      .includes(normalizedQuery)
  )), [normalizedQuery])
  const activeFamily = BUILTIN_GFONT_FAMILIES.find((family) => family.id === activeFamilyId)
    || BUILTIN_GFONT_FAMILIES[0]
  const activeVariantIndex = Math.max(0, activeFamily.variants.findIndex((variant) => variant.id === plotterFontId))

  useEffect(() => {
    if (fontType === 'plotter') setActiveFamilyId(selectedPlotter.familyId)
  }, [fontType, selectedPlotter.familyId])

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [])

  const chooseFamily = (family) => {
    setActiveFamilyId(family.id)
    if (selectedPlotter.familyId !== family.id || fontType !== 'plotter') {
      onChange({ type: 'plotter', value: family.variants[0].id })
    }
  }

  const chooseVariant = (variant) => {
    onChange({ type: 'plotter', value: variant.id })
  }

  return (
    <div className="font-picker" ref={rootRef}>
      <span className="field-label">Основной шрифт</span>
      <button className="font-picker-trigger" type="button" aria-haspopup="listbox" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span className={selected.kind === 'plotter' ? 'plotter-font-name' : ''} style={selected.kind === 'screen' ? { fontFamily: `'${selected.family}'` } : undefined}>{selected.name}</span>
        <em className={`font-kind-badge ${selected.kind}`}>{selected.kind === 'plotter' ? 'GFont' : 'Экранный'}</em>
        <b>⌄</b>
      </button>
      {open && (
        <div className="font-picker-menu">
          <input autoFocus type="search" value={query} placeholder="Найти шрифт…" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false) }} />
          <div className="font-picker-list">
            {filteredFamilies.length > 0 && (
              <div className="plotter-font-section">
                <div className="font-section-heading">
                  <span>Для плоттера</span>
                  <em>
                    {BUILTIN_GFONT_FAMILIES.length} {pluralize(BUILTIN_GFONT_FAMILIES.length, 'шрифт', 'шрифта', 'шрифтов')}
                    {' · '}
                    {BUILTIN_GFONT_OPTIONS.length} {pluralize(BUILTIN_GFONT_OPTIONS.length, 'стиль', 'стиля', 'стилей')}
                  </em>
                </div>
                <div className="plotter-family-tabs" role="listbox" aria-label="Однолинейный шрифт">
                  {filteredFamilies.map((family) => (
                    <button
                      className={[
                        activeFamily.id === family.id ? 'active' : '',
                        fontType === 'plotter' && selectedPlotter.familyId === family.id ? 'selected' : '',
                      ].filter(Boolean).join(' ')}
                      type="button"
                      role="option"
                      aria-selected={fontType === 'plotter' && selectedPlotter.familyId === family.id}
                      key={family.id}
                      onClick={() => chooseFamily(family)}
                    >
                      <span>{family.label}</span>
                      <small>
                        {family.variants.length} {pluralize(family.variants.length, 'вариант', 'варианта', 'вариантов')}
                      </small>
                    </button>
                  ))}
                </div>
                {filteredFamilies.some((family) => family.id === activeFamily.id) && (
                  <div className="font-variant-panel">
                    <div className="font-variant-heading">
                      <span>Характер почерка</span>
                      <strong>{activeFamily.variants[activeVariantIndex].label}</strong>
                    </div>
                    <input
                      className="font-variant-range"
                      type="range"
                      min="0"
                      max={activeFamily.variants.length - 1}
                      step="1"
                      value={activeVariantIndex}
                      aria-label={`Вариант шрифта ${activeFamily.label}`}
                      onChange={(event) => chooseVariant(activeFamily.variants[Number(event.target.value)])}
                    />
                    <div className="font-variant-labels" style={{ '--variant-count': activeFamily.variants.length }}>
                      {activeFamily.variants.map((variant, index) => (
                        <button
                          className={index === activeVariantIndex && fontType === 'plotter' ? 'selected' : ''}
                          type="button"
                          key={variant.id}
                          onClick={() => chooseVariant(variant)}
                        >
                          {variant.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {SCREEN_GROUPS.map((group) => {
              const groupFonts = filtered.filter((font) => font.group === group)
              if (!groupFonts.length) return null
              return (
                <div className={`font-picker-group ${group === HANDWRITTEN_GROUP ? 'featured-font-group' : ''}`} key={group}>
                  <div className="font-section-heading">
                    <span>{group}</span>
                    <em>{groupFonts.length} {groupFonts.length === 1 ? 'шрифт' : 'шрифтов'}</em>
                  </div>
                  <div className="screen-font-grid">
                  {groupFonts.map((font) => (
                    <button
                      className={`screen-font-card ${fontType !== 'plotter' && font.family === value ? 'selected' : ''}`}
                      type="button"
                      role="option"
                      aria-selected={fontType !== 'plotter' && font.family === value}
                      key={font.family}
                      title={font.name}
                      onClick={() => { onChange({ type: 'screen', value: font.family }); setOpen(false); setQuery('') }}
                    >
                      <span style={{ fontFamily: `'${font.family}'` }}>{font.name}</span>
                      {font.cyrillic === false && <em>Latin</em>}
                      {font.cyrillic === 'partial' && <em>част. кир.</em>}
                    </button>
                  ))}
                  </div>
                </div>
              )
            })}
            {!filtered.length && !filteredFamilies.length && <div className="font-picker-empty">Ничего не найдено</div>}
          </div>
        </div>
      )}
    </div>
  )
}
