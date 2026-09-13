import { useState } from 'react';
import { createPenCalibration } from '../../plotter/penCalibration';
import { downloadFile } from '../../lib/files';

export default function PenCalibrationSheet({ workspace }) {
  const [selected, setSelected] = useState('');
  const [notice, setNotice] = useState('');
  const { config } = workspace;
  if (config.penMode === 'laser') return null;
  const sheet = createPenCalibration(config);
  const candidate = sheet.candidates.find(c => c.id === selected);
  const variablePressure = config.penMode === 'servo' && config.profile !== 'ebb';
  return <details className="studio-detail"><summary>Подобрать перо и скорость</summary><p>Лист с прямыми и петлями: строки меняют скорость, столбцы — усилие сервопривода. Скачайте задание, выполните его через обычный запуск плоттера и выберите чистый образец.</p>
    {!variablePressure && <p>Для этого привода сравнивается только скорость. Положение касания настраивается в механике.</p>}
    <svg className="calibration-sheet-preview" viewBox="0 0 104 78" role="img" aria-label="Калибровочный лист"><g fill="none" stroke="currentColor" strokeWidth=".35">{sheet.strokes.map((s, i) => <path key={i} d={s.map((p, j) => `${j ? 'L' : 'M'}${p.x} ${p.y}`).join(' ')} />)}</g>{sheet.candidates.map(c => <text key={c.id} x={8 + c.col * 32} y={7 + c.row * 24} fontSize="3">{c.id}</text>)}</svg>
    <button type="button" disabled={!sheet.withinWorkArea} onClick={() => downloadFile(config.profile === 'ebb' ? 'pen-calibration.ebb' : 'pen-calibration.gcode', sheet.commands.join('\n'), 'text/plain')}>Скачать тестовый лист</button>
    {!sheet.withinWorkArea && <p role="alert">Лист выходит за рабочую область. Проверьте размеры и преобразование осей.</p>}
    <label className="field">Лучший образец<select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Выберите после проверки</option>{sheet.candidates.map(c => <option key={c.id} value={c.id}>{c.id} · {c.feedRate} мм/мин{variablePressure ? ` · усилие ${Math.round(c.pressure * 100)}%` : ''}</option>)}</select></label>
    <button type="button" disabled={!candidate || workspace.running || workspace.calibrationActive} onClick={() => { if (candidate) { workspace.updateConfig('feedRate', candidate.feedRate); if (variablePressure) workspace.updateConfig('penDown', candidate.penDown); setSelected(''); setNotice('Скорость и положение пера сохранены в текущем профиле плоттера.'); } }}>Сохранить в профиль</button>
    {notice && <p role="status">{notice}</p>}
  </details>;
}
