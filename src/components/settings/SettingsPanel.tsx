import { STRUCTURE_CONTROLS } from "../../handwriting/structure";
import { PAGE_SIZES } from "../../app/config";
import { fonts } from "../../fonts";
import FontPicker from "./controls/FontPicker";
import RangeControl from "./controls/RangeControl";
import SettingSection from "./controls/SettingSection";
import Toggle from "./controls/Toggle";
import NaturalnessReport from "./NaturalnessReport";
import { HANDWRITING_PROFILES } from "../../handwriting/profiles";
import HandwritingSamples from "./HandwritingSamples";
import { DOCUMENT_PRESETS } from "../../handwriting/documentPresets";

export default function SettingsPanel({
  settings,
  metrics,
  updateSetting,
  updateFontSelection,
  customPlotterFonts,
  uploadCustomFont,
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
  plotterWorkspace,
  naturalnessReport,
  applyNaturalnessFix,
  applyHandwritingProfile,
  closeSettings,
  settingsCollapsed,
}) {
  const maxTextWidth = Math.max(
    260,
    metrics.width - Math.max(settings.marginLeft, settings.marginLeftEven) - 24,
  );

  return (
    <aside
      className="settings-panel panel"
      aria-hidden={settingsCollapsed}
      inert={settingsCollapsed || plotterWorkspace.running}
    >
      <div className="settings-drawer-header">
        <strong>Настройки</strong>
        <button
          type="button"
          onClick={closeSettings}
          aria-label="Закрыть настройки"
        >
          ×
        </button>
      </div>
      <SettingSection title="Шрифт и текст">
        <details className="studio-detail">
          <summary>Оформление конспекта</summary>

          {DOCUMENT_PRESETS.map((p) => (
            <button
              className="document-preset"
              type="button"
              key={p.id}
              onClick={() =>
                Object.entries(p.settings).forEach(([key, value]) =>
                  updateSetting(key, value),
                )
              }
            >
              <strong>{p.label}</strong>
              <small>{p.description}</small>
            </button>
          ))}
        </details>
        <FontPicker
          fontType={settings.fontType}
          value={settings.fontFamily}
          plotterFontId={settings.plotterFontId}
          onChange={updateFontSelection}
          customFonts={customPlotterFonts}
          onUpload={uploadCustomFont}
        />
        {settings.fontType !== "plotter" && (
          <div className="font-compat-warning" role="note">
            <b>!</b>
            <span>
              Для записи этого документа выберите однолинейный GFont.
              Настройки устройства доступны во вкладке «Плоттер».
            </span>
          </div>
        )}
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
          disabled={settings.fontType === "plotter"}
          hint={
            settings.fontType === "plotter"
              ? "Поворот экранного текста не преобразуется в траекторию GFont, поэтому для плоттера настройка недоступна."
              : undefined
          }
        />
      </SettingSection>
      <SettingSection title="Страница и поля" open={false}>
          <div className="page-format-field">
            <div className="page-format-row">
              <select
                value={settings.pageSize}
                onChange={(event) => updatePageSize(event.target.value)}
                aria-label="Формат страницы"
              >
                {Object.entries(PAGE_SIZES).map(([key, page]) => (
                  <option value={key} key={key}>
                    {page.label}
                  </option>
                ))}
              </select>
              <button
                className="orientation-toggle"
                type="button"
                aria-label={`Сменить ориентацию. Сейчас ${settings.pageOrientation === "landscape" ? "альбомная" : "книжная"}`}
                title={
                  settings.pageOrientation === "landscape"
                    ? "Альбомная ориентация"
                    : "Книжная ориентация"
                }
                onClick={() =>
                  updateSetting(
                    "pageOrientation",
                    settings.pageOrientation === "landscape"
                      ? "portrait"
                      : "landscape",
                  )
                }
              >
                <span
                  className={
                    settings.pageOrientation === "landscape"
                      ? "landscape"
                      : "portrait"
                  }
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

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
      <button className="button settings-wide-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>Настроить плоттер →</button>
      <SettingSection title="Почерк" open={false}>
        <label className="field handwriting-profile-field">
          <span>Профиль автора</span>
          <select
            value={settings.handwritingProfile}
            onChange={(event) => applyHandwritingProfile(event.target.value)}
          >
            {Object.entries(HANDWRITING_PROFILES).map(([id, profile]) => (
              <option value={id} key={id}>
                {profile.label}
              </option>
            ))}
          </select>
          <small>
            {HANDWRITING_PROFILES[settings.handwritingProfile]?.description ||
              HANDWRITING_PROFILES.personal.description}
          </small>
        </label>
        <Toggle
          checked={settings.trueHandwriting}
          onChange={(value) => updateSetting("trueHandwriting", value)}
          label="Настоящий почерк"
        >

        </Toggle>
        {settings.trueHandwriting && (
          <>
            <SettingSection title="Изменение почерка по странице" open={false}>
            <Toggle
              checked={settings.fatigueEnabled}
              onChange={(value) => updateSetting("fatigueEnabled", value)}
              label="Изменение письма по странице"
            >

            </Toggle>
            {settings.fatigueEnabled && (
              <RangeControl
                label="Выраженность изменения"
                value={settings.fatigueStrength}
                min={5}
                max={100}
                suffix="%"
                onChange={(value) => updateSetting("fatigueStrength", value)}
              />
            )}
            </SettingSection>
            <SettingSection title="Форма букв и соединения" open={false}>
            <RangeControl
              label="Наклон автора"
              value={settings.authorSlant}
              min={-12}
              max={16}
              step={0.5}
              suffix="°"
              onChange={(value) => updateSetting("authorSlant", value)}
            />
            <RangeControl
              label="Ширина букв автора"
              value={settings.authorWidth}
              min={82}
              max={118}
              suffix="%"
              onChange={(value) => updateSetting("authorWidth", value)}
            />
            <RangeControl
              label="Живой ритм"
              value={settings.authorRhythm}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) => updateSetting("authorRhythm", value)}
            />
            <RangeControl
              label="Вариативность букв"
              value={settings.glyphVariation}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) => updateSetting("glyphVariation", value)}
              hint="Варьирует пропорции глифа; новые начертания букв не создаются."
            />
            <RangeControl
              label="Связность"
              value={settings.connectionStrength}
              min={0}
              max={100}
              suffix="%"
              onChange={(value) => updateSetting("connectionStrength", value)}
              hint="Частота контекстных соединений между соседними буквами."
            />
            <RangeControl
              label="Редкие исправления"
              value={settings.correctionChance}
              min={0}
              max={5}
              step={0.1}
              suffix="%"
              onChange={(value) => updateSetting("correctionChance", value)}
              hint="Вероятность естественного зачёркивания слова."
            />
            <RangeControl
              label="Изменение давления"
              value={settings.pressureVariation}
              min={0}
              max={50}
              suffix="%"
              onChange={(value) => updateSetting("pressureVariation", value)}
              hint="Слегка меняет толщину предпросмотра и усилие пера между штрихами."
            />
            </SettingSection>
            <SettingSection title="Абзацы, интервалы и строки" open={false}>
              {STRUCTURE_CONTROLS.map((control) => (
                <RangeControl
                  key={control.key}
                  label={control.label}
                  value={settings[control.key] ?? control.initial}
                  min={control.min}
                  max={control.max}
                  suffix="%"
                  disabled={
                    "plotterOnly" in control && settings.fontType !== "plotter"
                  }
                  hint={control.hint}
                  onChange={(value) => updateSetting(control.key, value)}
                />
              ))}
              <RangeControl
                label="Колебание строки"
                value={settings.authorBaseline}
                min={0}
                max={100}
                suffix="%"
                hint="Плавный ход строки без резких скачков отдельных букв."
                onChange={(value) => updateSetting("authorBaseline", value)}
              />
            </SettingSection>
            <SettingSection title="Проверка и образцы почерка" open={false}>
            <NaturalnessReport
              report={naturalnessReport}
              onAutofix={applyNaturalnessFix}
            />
            <HandwritingSamples
              onApply={(patch) =>
                Object.entries(patch).forEach(([key, value]) =>
                  updateSetting(key, value),
                )
              }
            />
            {plotterWorkspace?.activeLayout?.trajectoryReport?.length > 0 && (
              <details className="studio-detail">
                <summary>Траектории на странице</summary>

                <div className="form-audit">
                  {plotterWorkspace.activeLayout.trajectoryReport.map((r) => (
                    <span key={r.character}>
                      {r.character}: {r.distinct} форм на {r.count} букв
                    </span>
                  ))}
                </div>
              </details>
            )}
            </SettingSection>
          </>
        )}
        <SettingSection title="Случайные вариации" open={false}>
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
              aria-label="Создать новое зерно случайности"
              title="Создать новое зерно случайности"
              onClick={() =>
                updateSetting("seed", Math.floor(Math.random() * 999999))
              }
            >
              ↻
            </button>
          </span>
        </label>
        </SettingSection>
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
      <div className="settings-reset">
        <button
          className="button ghost settings-wide-button"
          type="button"
          onClick={resetSettings}
        >
          Сбросить все настройки
        </button>
      </div>
    </aside>
  );
}
