import { useRef, useState } from 'react';
import FontCanvas from '../../font-builder/FontCanvas';
import { DEFAULT_PEN_SETTINGS, type FontStroke } from '../../font-builder/penInput';
import { analyzeSamples, SAMPLE_PROMPTS } from '../../handwriting/sampleAnalysis';
import { validForms } from '../../font-builder/letterForms';
import { loadStoredObject, saveStoredValues } from '../../lib/storage';

const KEY = 'openhand.handwriting-samples.v1';
export default function HandwritingSamples({ onApply }: { onApply: (patch: Record<string, unknown>) => void }) {
  const [samples, setSamples] = useState<FontStroke[][]>(() => { const value = loadStoredObject<{ samples?: FontStroke[][] }>(KEY, {}); return SAMPLE_PROMPTS.map((_, i) => validForms([{ strokes: value.samples?.[i] }])[0]?.strokes || []); });
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState('');
  const penSeenRef = useRef(false);
  const result = analyzeSamples(samples);
  return <details className="studio-detail"><summary>Настроить по своему письму</summary><p>Напишите три слова привычным темпом и размером. Сохраняется весь жест: по нему оцениваются наклон, пропорции, ход строки и ритм. Это начальная настройка, её можно поправить.</p>
    <div className="studio-control-row">{SAMPLE_PROMPTS.map((word, i) => <button type="button" key={word} aria-pressed={i === active} onClick={() => setActive(i)}>{i === 3 ? 'Вся строка' : word}{samples[i]?.length ? ' ✓' : ''}</button>)}</div>
    <p>Напишите: <strong>{SAMPLE_PROMPTS[active]}</strong></p>
    {active === 3 && <p>Необязательно: напишите фразу целиком для оценки пробелов.</p>}
    <FontCanvas key={active} character="" strokes={samples[active] || []} settings={DEFAULT_PEN_SETTINGS} tool="pen" penSeenRef={penSeenRef} onChange={strokes => { const next = SAMPLE_PROMPTS.map((_, i) => i === active ? strokes : samples[i] || []); setSamples(next); if (!saveStoredValues({ [KEY]: JSON.stringify({ samples: next }) })) setNotice('Не удалось сохранить образцы.'); }} />
    <div className="studio-control-row"><button type="button" onClick={() => { const next = samples.map((s, i) => i === active ? [] : s); setSamples(next); saveStoredValues({ [KEY]: JSON.stringify({ samples: next }) }); }}>Переписать слово</button><button type="button" disabled={!result} onClick={() => { if (result) { onApply(result.settings); setNotice('Настройки применены. Образцы сохранены на этом устройстве.'); } }}>Применить измерения</button></div>
    {result && <p>Наклон: {result.settings.authorSlant}°. Ширина: {result.settings.authorWidth}%. {result.measuredPressure ? 'Нажатие учтено.' : 'Образцы без данных нажатия.'}</p>}
    {notice && <p role="status">{notice}</p>}
  </details>;
}
