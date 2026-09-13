import LiquidRange from "../components/controls/LiquidRange";
import type { PenSettings } from "./penInput";

export default function PenTools({ settings, onChange, tool, onToolChange }: {
  settings: PenSettings;
  onChange: (settings: PenSettings) => void;
  tool: "pen" | "eraser";
  onToolChange: (tool: "pen" | "eraser") => void;
}) {
  return (
    <div className="font-pen-tools" role="group" aria-label="Инструменты пера">
      <button type="button" aria-pressed={tool === "pen"} onClick={() => onToolChange("pen")}>
        Перо
      </button>
      <button type="button" aria-pressed={tool === "eraser"} onClick={() => onToolChange("eraser")}>
        Ластик штрихов
      </button>
      <label>
        Ввод
        <select aria-label="Режим ввода" value={settings.inputMode}
          onChange={(event) => onChange({ ...settings, inputMode: event.target.value as PenSettings["inputMode"] })}>
          <option value="auto">Авто</option>
          <option value="pen">Только перо</option>
          <option value="all">Перо и палец</option>
        </select>
      </label>
      <details className="font-pen-options">
        <summary>Настроить перо</summary>
        <label>
          <input type="checkbox" checked={settings.pressureEnabled}
            onChange={(event) => onChange({ ...settings, pressureEnabled: event.target.checked })} />
          Толщина по нажиму
        </label>
        <label>
          Отклик нажима
          <LiquidRange min={0.4} max={2} step={0.1} value={settings.pressureResponse}
            aria-label="Отклик нажима" disabled={!settings.pressureEnabled}
            onChange={(event) => onChange({ ...settings, pressureResponse: Number(event.target.value) })} />
        </label>
        <label>
          Сглаживание
          <LiquidRange min={0} max={70} value={settings.smoothing} aria-label="Сглаживание пера"
            onChange={(event) => onChange({ ...settings, smoothing: Number(event.target.value) })} />
        </label>
        <label>
          <input type="checkbox" checked={settings.tiltEnabled}
            onChange={(event) => onChange({ ...settings, tiltEnabled: event.target.checked })} />
          Расширять линию при наклоне
        </label>
        <p>
          В режиме «Авто» касания пальцем блокируются после обнаружения пера.
          «Только перо» защищает от ладони с первого касания. Нажим зависит от модели пера и браузера.
        </p>
      </details>
    </div>
  );
}
