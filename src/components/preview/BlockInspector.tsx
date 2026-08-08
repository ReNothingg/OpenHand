import { normalizeBlockLayout } from '../../lib/manualLayout'

export default function BlockInspector({ selected, onUpdate, onCommit, onReset }) {
  if (!selected) return (
    <div className="block-inspector empty">
      <span className="inspector-icon">↖</span>
      <span>Выберите блок или задайте его в MD:</span>
      <code>:::place id=name page=2 x=40 y=70 width=380 height=120 rotate=-2 align=center nowrap</code>
    </div>
  )
  const { pageIndex, block } = selected
  const originPage = block.originPage ?? pageIndex
  const layout = normalizeBlockLayout(block.layout, { pageIndex })
  const update = (patch) => {
    const next = { ...layout, ...patch }
    onUpdate(originPage, block.id, patch)
    onCommit(originPage, block.id, next)
  }
  return (
    <div className="block-inspector" aria-label="Свойства выбранного блока">
      <div className="block-identity">
        <span className={`block-kind ${block.kind}`}>{block.kind === 'formula' ? 'ƒ' : block.kind === 'svg' ? '◇' : 'T'}</span>
        <div><strong>{block.label}</strong><small>Лист {pageIndex + 1}</small></div>
      </div>
      <label><span>Лист</span><input type="number" min="1" value={(layout.pageIndex ?? pageIndex) + 1} onChange={(event) => update({ pageIndex: Math.max(0, Number(event.target.value) - 1) })} /></label>
      <label><span>X</span><input type="number" value={Math.round(layout.x)} onChange={(event) => update({ x: Number(event.target.value) })} /></label>
      <label><span>Y</span><input type="number" value={Math.round(layout.y)} onChange={(event) => update({ y: Number(event.target.value) })} /></label>
      <label><span>Ширина</span><input type="number" min="36" value={Math.round(layout.width)} onChange={(event) => update({ width: Number(event.target.value) })} /></label>
      <label><span>Высота</span><input type="number" min="24" value={Math.round(layout.height)} onChange={(event) => update({ height: Number(event.target.value) })} /></label>
      <label><span>Поворот</span><input type="number" min="-180" max="180" value={layout.rotation} onChange={(event) => update({ rotation: Number(event.target.value) })} /></label>
      <div className="alignment-control" role="group" aria-label="Выравнивание">
        {['left', 'center', 'right'].map((align) => <button type="button" className={layout.align === align ? 'active' : ''} onClick={() => update({ align })} key={align} aria-label={align === 'left' ? 'По левому краю' : align === 'center' ? 'По центру' : 'По правому краю'}>{align === 'left' ? '≡' : align === 'center' ? '≣' : '≡'}</button>)}
      </div>
      <label className="nowrap-control"><input type="checkbox" checked={layout.noWrap} onChange={(event) => update({ noWrap: event.target.checked })} /><span>Не переносить</span></label>
      <button className="text-button" type="button" onClick={() => onReset(originPage, block.id)}>Сбросить</button>
    </div>
  )
}
