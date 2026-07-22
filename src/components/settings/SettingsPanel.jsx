import { PAGE_SIZES } from "../../app/config.js";
import { fonts } from "../../fonts.js";
import FontPicker from "./controls/FontPicker.jsx";
import RangeControl from "./controls/RangeControl.jsx";
import SettingSection from "./controls/SettingSection.jsx";
import Toggle from "./controls/Toggle.jsx";

export default function SettingsPanel({
  settings,
  metrics,
  updateSetting,
  updatePageSize,
  resetSettings,
  togglePoolFont,
  presets,
  activePreset,
  selectPreset,
  savePreset,
  deletePreset,
  sourceMode,
  openSource,
  downloadSource,
  exportSettings,
  importSettings,
}) {
  const maxTextWidth = Math.max(
    260,
    metrics.width - Math.max(settings.marginLeft, settings.marginLeftEven) - 24,
  );

  return (
    <aside className="settings-panel panel">
      <div className="panel-title">
        <div>
          <strong>Настройки</strong>
          <small>Все изменения применяются сразу</small>
        </div>
        <button className="text-button" type="button" onClick={resetSettings}>
          Сбросить
        </button>
      </div>
      <SettingSection title="Шрифт и текст">
        <FontPicker
          value={settings.fontFamily}
          onChange={(value) => updateSetting("fontFamily", value)}
        />
        <div className="color-grid">
          <label className="field">
            <span>Чернила</span>
            <input
              type="color"
              value={settings.inkColor}
              onChange={(event) =>
                updateSetting("inkColor", event.target.value)
              }
            />
          </label>
          <label className="field">
            <span>Бумага</span>
            <input
              type="color"
              value={settings.pageColor}
              onChange={(event) =>
                updateSetting("pageColor", event.target.value)
              }
            />
          </label>
        </div>
        <RangeControl
          label="Размер шрифта"
          value={settings.fontSize}
          min={12}
          max={64}
          suffix=" px"
          onChange={(value) => updateSetting("fontSize", value)}
        />
        <RangeControl
          label="Ширина текста"
          value={Math.min(settings.textWidth, maxTextWidth)}
          min={220}
          max={maxTextWidth}
          suffix=" px"
          onChange={(value) => updateSetting("textWidth", value)}
        />
        <RangeControl
          label="Расстояние между строками"
          value={settings.lineHeight}
          min={1}
          max={2.5}
          step={0.05}
          suffix="×"
          onChange={(value) => updateSetting("lineHeight", value)}
        />
        <RangeControl
          label="Поворот текста"
          value={settings.textRotation}
          min={-8}
          max={8}
          step={0.1}
          suffix="°"
          onChange={(value) => updateSetting("textRotation", value)}
        />
      </SettingSection>
      ы
      <SettingSection title="Страница и поля">
        <label className="field">
          <span>Формат страницы</span>
          <select
            value={settings.pageSize}
            onChange={(event) => updatePageSize(event.target.value)}
          >
            {Object.entries(PAGE_SIZES).map(([key, page]) => (
              <option value={key} key={key}>
                {page.label}
              </option>
            ))}
          </select>
        </label>
        <RangeControl
          label="Отступ сверху"
          value={settings.marginTop}
          min={0}
          max={220}
          suffix=" px"
          onChange={(value) => updateSetting("marginTop", value)}
        />
        <RangeControl
          label="Отступ слева"
          value={settings.marginLeft}
          min={0}
          max={220}
          suffix=" px"
          onChange={(value) => updateSetting("marginLeft", value)}
        />
        <RangeControl
          label="Слева на чётных страницах"
          value={settings.marginLeftEven}
          min={0}
          max={220}
          suffix=" px"
          onChange={(value) => updateSetting("marginLeftEven", value)}
        />
        <RangeControl
          label="Отступ снизу"
          value={settings.marginBottom}
          min={0}
          max={220}
          suffix=" px"
          onChange={(value) => updateSetting("marginBottom", value)}
        />
      </SettingSection>
      <SettingSection title="Живой почерк">
        <RangeControl
          label="Случайное направление"
          value={settings.directionChance}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => updateSetting("directionChance", value)}
          hint="Вероятность смены направления. 0 — без случайной смены знака."
        />
        <RangeControl
          label="Наклон слов"
          value={settings.maxWordTilt}
          min={0}
          max={12}
          step={0.1}
          suffix="°"
          onChange={(value) => updateSetting("maxWordTilt", value)}
          hint="0 — без случайного наклона."
        />
        <RangeControl
          label="Высота подъёма"
          value={settings.maxLift}
          min={0}
          max={12}
          step={0.1}
          suffix=" px"
          onChange={(value) => updateSetting("maxLift", value)}
          hint="0 — без смещения слов вверх и вниз."
        />
        <RangeControl
          label="Расстояние между буквами"
          value={settings.maxLetterSpacing}
          min={0}
          max={4}
          step={0.05}
          suffix=" px"
          onChange={(value) => updateSetting("maxLetterSpacing", value)}
          hint="0 — обычные интервалы между буквами."
        />
        <RangeControl
          label="Рандомизация шрифта"
          value={settings.fontRandomization}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => updateSetting("fontRandomization", value)}
          hint="Вероятность замены шрифта слова. 0 — только выбранный шрифт."
        />
        <details className="font-pool">
          <summary>
            Шрифты в смешивании · {settings.fontPool?.length || 0}
          </summary>
          <div>
            {fonts.map((font) => (
              <label key={font.family}>
                <input
                  type="checkbox"
                  checked={settings.fontPool?.includes(font.family) || false}
                  onChange={() => togglePoolFont(font.family)}
                />
                <span style={{ fontFamily: `'${font.family}'` }}>
                  {font.name}
                </span>
              </label>
            ))}
          </div>
        </details>
        <RangeControl
          label="Съезд линий"
          value={settings.maxLineDrift}
          min={0}
          max={8}
          step={0.1}
          suffix=" px"
          onChange={(value) => updateSetting("maxLineDrift", value)}
          hint="0 — линии не съезжают."
        />
        <RangeControl
          label="Отступ линии"
          value={settings.maxLineIndent}
          min={0}
          max={80}
          suffix=" px"
          onChange={(value) => updateSetting("maxLineIndent", value)}
          hint="0 — без случайного отступа."
        />
        <RangeControl
          label="Частота слов"
          value={settings.wordFrequency}
          min={0}
          max={20}
          onChange={(value) => updateSetting("wordFrequency", value)}
          hint="0–1 — каждое слово; чем больше значение, тем реже применяются эффекты."
        />
        <RangeControl
          label="Частота букв"
          value={settings.letterFrequency}
          min={0}
          max={100}
          suffix="%"
          onChange={(value) => updateSetting("letterFrequency", value)}
          hint="Чем меньше значение, тем реже меняется интервал."
        />
        <label className="field seed-field">
          <span>Зерно случайности</span>
          <span>
            <input
              type="number"
              value={settings.seed}
              onChange={(event) =>
                updateSetting("seed", Number(event.target.value))
              }
            />
            <button
              type="button"
              onClick={() =>
                updateSetting("seed", Math.floor(Math.random() * 999999))
              }
            >
              ↻
            </button>
          </span>
        </label>
      </SettingSection>
      <SettingSection title="Пресеты и файлы" open={false}>
        <label className="field">
          <span>Сохранённый пресет</span>
          <select
            value={activePreset}
            onChange={(event) => selectPreset(event.target.value)}
          >
            <option value="">Не выбран</option>
            {Object.keys(presets).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <div className="button-grid">
          <button
            className="button ghost compact"
            type="button"
            onClick={openSource}
          >
            Открыть исходник
          </button>
          <button
            className="button ghost compact"
            type="button"
            onClick={downloadSource}
          >
            Скачать .{sourceMode === "tex" ? "tex" : "md"}
          </button>
          <button
            className="button ghost compact"
            type="button"
            onClick={savePreset}
          >
            Сохранить пресет
          </button>
          <button
            className="button ghost compact"
            type="button"
            disabled={!activePreset}
            onClick={deletePreset}
          >
            Удалить
          </button>
          <button
            className="button ghost compact"
            type="button"
            onClick={exportSettings}
          >
            Экспорт JSON
          </button>
          <button
            className="button ghost compact"
            type="button"
            onClick={importSettings}
          >
            Импорт JSON
          </button>
        </div>
      </SettingSection>
    </aside>
  );
}
