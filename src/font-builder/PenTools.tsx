import LiquidRange from "../components/controls/LiquidRange";
import type { PenSettings } from "./penInput";

export default function PenTools({
  settings,
  onChange,
  tool,
  onToolChange,
}: {
  settings: PenSettings;
  onChange: (settings: PenSettings) => void;
  tool: "pen" | "eraser" | "trim";
  onToolChange: (tool: "pen" | "eraser" | "trim") => void;
}) {
  return (
    <div className="font-pen-tools" role="group" aria-label="Инструменты пера">
      <div
        className="font-tool-group"
        role="group"
        aria-label="Режим рисования"
      >
        <button
          type="button"
          aria-pressed={tool === "pen"}
          onClick={() => onToolChange("pen")}
        >
          Перо
        </button>
        <button
          type="button"
          aria-pressed={tool === "eraser"}
          onClick={() => onToolChange("eraser")}
          title="Удаляет штрих целиком"
        >
          Штрих
        </button>
        <button
          type="button"
          aria-pressed={tool === "trim"}
          onClick={() => onToolChange("trim")}
          title="Стирает только часть линии"
        >
          Фрагмент
        </button>
      </div>
      <label className="font-pen-input">
        <span>Ввод</span>
        <select
          aria-label="Режим ввода"
          value={settings.inputMode}
          onChange={(event) =>
            onChange({
              ...settings,
              inputMode: event.target.value as PenSettings["inputMode"],
            })
          }
        >
          <option value="auto">Авто</option>
          <option value="pen">Только перо</option>
          <option value="all">Перо и палец</option>
        </select>
      </label>
      <details className="font-pen-options">
        <summary>Настройки</summary>
        <div className="font-pen-options-panel">
          <label className="font-pen-toggle">
            <input
              type="checkbox"
              checked={settings.pressureEnabled}
              onChange={(event) =>
                onChange({ ...settings, pressureEnabled: event.target.checked })
              }
            />
            Толщина по нажиму
          </label>
          <label className="font-pen-range">
            <span>Отклик нажима</span>
            <LiquidRange
              min={0.4}
              max={2}
              step={0.1}
              value={settings.pressureResponse}
              aria-label="Отклик нажима"
              disabled={!settings.pressureEnabled}
              onChange={(event) =>
                onChange({
                  ...settings,
                  pressureResponse: Number(event.target.value),
                })
              }
            />
          </label>
          <label className="font-pen-range">
            <span>Сглаживание</span>
            <LiquidRange
              min={0}
              max={70}
              value={settings.smoothing}
              aria-label="Сглаживание пера"
              onChange={(event) =>
                onChange({ ...settings, smoothing: Number(event.target.value) })
              }
            />
          </label>
          <label className="font-pen-toggle">
            <input
              type="checkbox"
              checked={settings.tiltEnabled}
              onChange={(event) =>
                onChange({ ...settings, tiltEnabled: event.target.checked })
              }
            />
            Ширина по наклону
          </label>
          <p>
            «Авто» отключает палец после обнаружения пера. «Только перо» сразу
            защищает от касаний ладонью.
          </p>
        </div>
      </details>
    </div>
  );
}
