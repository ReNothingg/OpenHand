import { useEffect, useState } from "react";
import type { GCodePenModel } from "./penModel";
import { previewPenDescription, previewPenFromFields, previewPenKind, type PreviewPenKind } from "./previewPen";

export default function GCodePenControls({ model, fileModel, onChange }: {
  model?: GCodePenModel;
  fileModel?: GCodePenModel;
  onChange: (model?: GCodePenModel) => void;
}) {
  const [kind, setKind] = useState<PreviewPenKind>(previewPenKind(model));
  const [up, setUp] = useState("");
  const [down, setDown] = useState("");
  const [error, setError] = useState("");
  const fill = (value?: GCodePenModel) => {
    setUp(value && value.kind !== "spindle" ? String(value.up) : "");
    setDown(value && value.kind !== "spindle" ? String(value.down) : "");
  };
  useEffect(() => {
    setKind(previewPenKind(model));
    fill(model || fileModel);
    setError("");
  }, [model, fileModel]);
  const axis = kind === "Z" || kind === "E";
  const endpoints = kind !== "auto" && kind !== "spindle";
  const effective = model || fileModel;
  return <details className="gcode-pen-controls">
    <summary><span>Перо на предпросмотре</span>{" "}<span>{previewPenDescription(effective)}{!model && fileModel ? " · из файла" : ""}</span></summary>
    <div className="gcode-pen-content">
      <p>Настройте, какие перемещения считать письмом. Это меняет только просмотр, не команды файла и не настройки плоттера.</p>
      {!effective && <p>В файле нет описания пера. Пока штрихи определены приблизительно.</p>}
      <form onSubmit={event => {
        event.preventDefault();
        try { const next = previewPenFromFields(kind, up, down); setError(""); onChange(next); }
        catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      }}>
        <label className="gcode-pen-kind">Управление пером
          <select value={kind} onChange={event => {
            const next = event.target.value as PreviewPenKind;
            setKind(next); setError("");
            fill(previewPenKind(model) === next ? model : previewPenKind(fileModel) === next ? fileModel : undefined);
          }}>
            <option value="auto">Из файла / автоматически</option>
            <option value="Z">Шаговый механизм · Z</option>
            <option value="E">Шаговый механизм · E</option>
            <option value="M3">Сервопривод · M3 S</option>
            <option value="M280">Сервопривод · M280 P0</option>
            <option value="spindle">Включение / выключение · M3/M4/M5</option>
          </select>
        </label>
        {endpoints && <>
          <label>Поднято{axis ? ", мм" : ", значение S"}<input inputMode="decimal" value={up} onChange={event => { setUp(event.target.value); setError(""); }} /></label>
          <label>Опущено{axis ? ", мм" : ", значение S"}<input inputMode="decimal" value={down} onChange={event => { setDown(event.target.value); setError(""); }} /></label>
        </>}
        <div className="gcode-pen-actions">
          <button type="submit" className="button compact">Применить к просмотру</button>
          {model && <button type="button" className="button compact" onClick={() => onChange(undefined)}>Сбросить к файлу</button>}
        </div>
      </form>
      {axis && <p>Значения — координаты {kind} в миллиметрах, а не величина подъёма. Для файла в дюймах переведите их в миллиметры.</p>}
      {error && <p className="gcode-pen-error" role="alert">{error}</p>}
    </div>
  </details>;
}
