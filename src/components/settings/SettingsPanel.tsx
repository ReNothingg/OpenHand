import { STRUCTURE_CONTROLS } from "../../handwriting/structure";
import { PAGE_SIZES } from "../../app/config";
import { fonts } from "../../fonts";
import FontPicker from "./controls/FontPicker";
import RangeControl from "./controls/RangeControl";
import Toggle from "./controls/Toggle";
import NaturalnessReport from "./NaturalnessReport";
import { HANDWRITING_PROFILES } from "../../handwriting/profiles";
import HandwritingSamples from "./HandwritingSamples";
import { DOCUMENT_PRESETS } from "../../handwriting/documentPresets";
import { useId, useState } from "react";
import Icon from "../Icon";
import MenuButton from "../shell/MenuButton";

const TABS = [
  ["text", "Текст"],
  ["sheet", "Лист"],
  ["hand", "Почерк"],
] as const;
type SettingsTab = (typeof TABS)[number][0];

function readTab(): SettingsTab {
  try {
    const value = sessionStorage.getItem("openhand.settings-tab");
    return value === "sheet" || value === "hand" ? value : "text";
  } catch {
    return "text";
  }
}

const PARAGRAPH_KEYS = ["paragraphIndent", "paragraphGap", "wordSpacing"];

function MarginField({ label, value, onChange }) {
  const id = useId();
  return (
    <div className="oh-field">
      <label htmlFor={id}>{label}</label>
      <span className="oh-number">
        <input
          id={id}
          type="number"
          inputMode="numeric"
          min={0}
          max={220}
          value={value}
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next)) onChange(Math.max(0, Math.min(220, Math.round(next))));
          }}
        />
        <em aria-hidden="true">px</em>
      </span>
    </div>
  );
}

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
  exportSettings,
  importSettings,
  plotterWorkspace,
  naturalnessReport,
  applyNaturalnessFix,
  applyHandwritingProfile,
  closeSettings,
  settingsCollapsed,
}) {
  const tabsId = useId();
  const presetId = useId();
  const [tab, setTab] = useState<SettingsTab>(readTab);
  const chooseTab = (next: SettingsTab) => {
    setTab(next);
    try {
      sessionStorage.setItem("openhand.settings-tab", next);
    } catch {
      /* Optional preference. */
    }
  };
  const maxTextWidth = Math.max(
    260,
    metrics.width - Math.max(settings.marginLeft, settings.marginLeftEven) - 24,
  );

  const structureControl = (control) => (
    <RangeControl
      key={control.key}
      label={control.label}
      value={settings[control.key] ?? control.initial}
      min={control.min}
      max={control.max}
      suffix="%"
      disabled={"plotterOnly" in control && settings.fontType !== "plotter"}
      hint={control.hint}
      onChange={(value) => updateSetting(control.key, value)}
    />
  );
  const paragraphControls = STRUCTURE_CONTROLS.filter((control) => PARAGRAPH_KEYS.includes(control.key));
  const wordControls = STRUCTURE_CONTROLS.filter((control) => !PARAGRAPH_KEYS.includes(control.key));
  const profileLocked =
    plotterWorkspace.running || plotterWorkspace.calibrationActive ||
    plotterWorkspace.plotter.operationBusy || plotterWorkspace.plotter.status === "connecting";

  return (
    <aside
      className="settings-panel panel oh-inspector"
      aria-hidden={settingsCollapsed}
      inert={settingsCollapsed || plotterWorkspace.running}
    >
      <div className="oh-toolbar inspector-header">
        <label className="oh-inline-label" htmlFor={presetId}>
          Пресет
        </label>
        <select
          id={presetId}
          className="oh-select"
          value={activePreset}
          onChange={(event) => selectPreset(event.target.value)}
        >
          <option value="">Без пресета</option>
          {Object.keys(presets).map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <MenuButton
          iconOnly
          icon="more"
          label="Пресеты и файлы настроек"
          align="end"
          items={[
            { label: "Сохранить как пресет…", onSelect: savePreset },
            { label: "Удалить пресет", onSelect: deletePreset, disabled: !activePreset, danger: true },
            { label: "Экспорт настроек в JSON", onSelect: exportSettings },
            { label: "Импорт настроек из JSON…", onSelect: importSettings },
          ]}
        />
        <button
          type="button"
          className="oh-icon-button settings-close"
          onClick={closeSettings}
          aria-label="Закрыть настройки"
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="oh-tabs" role="tablist" aria-label="Группы настроек">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            id={`${tabsId}-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls={`${tabsId}-panel`}
            onClick={() => chooseTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="oh-inspector-body"
        role="tabpanel"
        id={`${tabsId}-panel`}
        aria-labelledby={`${tabsId}-${tab}`}
      >
        {tab === "text" && (
          <>
            <section className="oh-group">
              <h3 className="oh-group-title">Шрифт</h3>
              <FontPicker
                fontType={settings.fontType}
                value={settings.fontFamily}
                plotterFontId={settings.plotterFontId}
                onChange={updateFontSelection}
                customFonts={customPlotterFonts}
                onUpload={uploadCustomFont}
              />
              {settings.fontType !== "plotter" && (
                <p className="oh-callout" role="note">
                  Для записи пером выберите однолинейный GFont.
                </p>
              )}
            </section>
            <section className="oh-group">
              <h3 className="oh-group-title">Размер и строки</h3>
              <RangeControl
                label="Размер шрифта"
                value={settings.fontSize}
                min={12}
                max={64}
                suffix=" px"
                onChange={(value) => updateSetting("fontSize", value)}
              />
              <RangeControl
                label="Расстояние между строками"
                value={settings.lineHeight}
                min={1}
                max={2.5}
                step={0.01}
                suffix="×"
                onChange={(value) => updateSetting("lineHeight", value)}
              />
              <RangeControl
                label="Ширина текста"
                value={Math.min(settings.textWidth, maxTextWidth)}
                min={220}
                max={maxTextWidth}
                suffix=" px"
                onChange={(value) => updateSetting("textWidth", value)}
              />
              {settings.fontType !== "plotter" && (
                <RangeControl
                  label="Поворот текста"
                  value={settings.textRotation}
                  min={-8}
                  max={8}
                  step={0.1}
                  suffix="°"
                  onChange={(value) => updateSetting("textRotation", value)}
                />
              )}
            </section>
            <section className="oh-group">
              <h3 className="oh-group-title">Абзацы</h3>
              {paragraphControls.map(structureControl)}
              <Toggle checked={settings.compactLayout} onChange={(value) => updateSetting("compactLayout", value)} label="Компактная разбивка">
                <small>Убирает лишние пустые строки. Несколько заданий размещаются на одной странице, если хватает места; заголовок остаётся с началом решения.</small>
              </Toggle>
            </section>
            <section className="oh-group">
              <label className="oh-group-title" htmlFor={`${tabsId}-template`}>Шаблон оформления</label>
              <select
                id={`${tabsId}-template`}
                className="oh-select"
                value=""
                onChange={(event) => {
                  const preset = DOCUMENT_PRESETS.find((item) => item.id === event.target.value);
                  if (preset)
                    Object.entries(preset.settings).forEach(([key, value]) => updateSetting(key, value));
                }}
              >
                <option value="" disabled>
                  Применить шаблон…
                </option>
                {DOCUMENT_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} — {preset.description.toLowerCase().replace(/\.$/, "")}
                  </option>
                ))}
              </select>
              <p className="oh-note">Меняет размер, интервалы и отступы. Шрифт и почерк остаются.</p>
            </section>
          </>
        )}
        {tab === "sheet" && (
          <>
            <section className="oh-group">
              <h3 className="oh-group-title">Формат</h3>
              <div className="page-format-row oh-format-row">
                <select
                  className="oh-select"
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
                <div className="oh-segmented" role="group" aria-label="Ориентация">
                  <button
                    type="button"
                    aria-pressed={settings.pageOrientation !== "landscape"}
                    onClick={() => updateSetting("pageOrientation", "portrait")}
                  >
                    Книжная
                  </button>
                  <button
                    type="button"
                    aria-pressed={settings.pageOrientation === "landscape"}
                    onClick={() => updateSetting("pageOrientation", "landscape")}
                  >
                    Альбомная
                  </button>
                </div>
              </div>
            </section>
            <section className="oh-group">
              <h3 className="oh-group-title">Поля</h3>
              <div className="oh-field-grid">
                <MarginField label="Сверху" value={settings.marginTop} onChange={(value) => updateSetting("marginTop", value)} />
                <MarginField label="Снизу" value={settings.marginBottom} onChange={(value) => updateSetting("marginBottom", value)} />
                <MarginField label={settings.pageSize === "NotebookSpread" ? "От внешнего края" : "Слева"} value={settings.marginLeft} onChange={(value) => updateSetting("marginLeft", value)} />
                {settings.pageSize !== "NotebookSpread" && <MarginField label="Слева на чётных" value={settings.marginLeftEven} onChange={(value) => updateSetting("marginLeftEven", value)} />}
              </div>
            </section>
            <section className="oh-group">
              <h3 className="oh-group-title">Бумага</h3>
              <Toggle checked={settings.paperTexture} onChange={(value) => updateSetting("paperTexture", value)} label="Фактура бумаги" />
            </section>
          </>
        )}
        {tab === "hand" && (
          <>
            <section className="oh-group">
              <label className="oh-group-title" htmlFor={`${tabsId}-profile`}>Профиль автора</label>
              <select
                id={`${tabsId}-profile`}
                className="oh-select"
                value={settings.handwritingProfile}
                disabled={profileLocked}
                onChange={(event) => applyHandwritingProfile(event.target.value)}
              >
                {Object.entries(HANDWRITING_PROFILES).map(([id, profile]) => (
                  <option value={id} key={id}>
                    {profile.label}
                  </option>
                ))}
              </select>
              <p className="oh-note">
                {HANDWRITING_PROFILES[settings.handwritingProfile]?.description ||
                  HANDWRITING_PROFILES.personal.description}
              </p>
            </section>
            <section className="oh-group">
              <h3 className="oh-group-title">Основное</h3>
              <Toggle
                checked={settings.trueHandwriting}
                onChange={(value) => updateSetting("trueHandwriting", value)}
                label="Настоящий почерк"
              />
              {settings.trueHandwriting && (
                <RangeControl
                  label="Автоварианты формы букв"
                  value={settings.glyphVariation}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(value) => updateSetting("glyphVariation", value)}
                  hint="У GFont меняется геометрия петель, дуг и хвостов, а также пропорции букв. Варианты создаются автоматически из вашего начертания и сохраняются в траектории задания."
                />
              )}
              {settings.trueHandwriting && (
                <>
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
                    label="Связность"
                    value={settings.connectionStrength}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(value) => updateSetting("connectionStrength", value)}
                    hint="Частота контекстных соединений между соседними буквами."
                  />
                  <RangeControl
                    label="Живой ритм"
                    value={settings.authorRhythm}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(value) => updateSetting("authorRhythm", value)}
                    hint="Слегка меняет наклон и движение строки внутри слов, сохраняя форму букв."
                  />
                </>
              )}
            </section>
              {settings.trueHandwriting && (
                <section className="oh-group">
                  <h3 className="oh-group-title">Слова и строки</h3>
                  {wordControls.map(structureControl)}
                  <RangeControl
                    label="Колебание строки"
                    value={settings.authorBaseline}
                    min={0}
                    max={100}
                    suffix="%"
                    hint="Плавный ход строки без резких скачков отдельных букв."
                    onChange={(value) => updateSetting("authorBaseline", value)}
                  />
                  {settings.fontType === "plotter" && <RangeControl
                    label="Живые строки"
                    value={settings.lineLife ?? 0}
                    min={0}
                    max={100}
                    suffix="%"
                    hint="Строки начинаются не ровно с одного места, слегка уходят вверх или вниз, наклон и размер букв плавно меняются от строки к строке — как у руки, а не у станка. 0 — идеально ровные строки."
                    onChange={(value) => updateSetting("lineLife", value)}
                  />}
                </section>
              )}
              <section className="oh-group">
                  <h3 className="oh-group-title">Случайные отклонения</h3>
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
                  label="Случайное направление"
                  value={settings.directionChance}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(value) => updateSetting("directionChance", value)}
                  hint="Вероятность смены направления. 0 — без случайной смены знака."
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
                <RangeControl
                  label="Смешивание шрифтов"
                  value={settings.fontRandomization}
                  min={0}
                  max={100}
                  suffix="%"
                  onChange={(value) => updateSetting("fontRandomization", value)}
                  hint="Вероятность замены шрифта слова. 0 — только выбранный шрифт."
                />
                {settings.fontRandomization > 0 && (
                  <div className="font-pool oh-font-pool">
                    <span className="oh-note">Шрифты в смешивании · {settings.fontPool?.length || 0}</span>
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
                  </div>
                )}
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
              </section>
              {settings.trueHandwriting && (
                <section className="oh-group">
                  <h3 className="oh-group-title">Перо и чернила</h3>
                  <RangeControl
                    label="Толщина линии"
                    value={settings.penWidthMm}
                    min={0.1}
                    max={1.2}
                    step={0.01}
                    suffix=" мм"
                    disabled={settings.fontType !== "plotter"}
                    onChange={(value) => updateSetting("penWidthMm", value)}
                    hint="Толщина чернил на экране и в PDF. На бумаге она зависит от установленной ручки."
                  />
                  <RangeControl
                    label="Колебание толщины"
                    value={settings.inkVariation}
                    min={0}
                    max={50}
                    suffix="%"
                    disabled={settings.fontType !== "plotter"}
                    onChange={(value) => updateSetting("inkVariation", value)}
                    hint="Плавные изменения чернил внутри штриха на экране и в PDF. На команды плоттера не влияет."
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
                </section>
              )}
              {settings.trueHandwriting && (
                <section className="oh-group">
                  <h3 className="oh-group-title">Усталость к концу страницы</h3>
                  <Toggle
                    checked={settings.fatigueEnabled}
                    onChange={(value) => updateSetting("fatigueEnabled", value)}
                    label="Изменение письма по странице"
                  />
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
                </section>
              )}
              {settings.trueHandwriting && (
                <section className="oh-group">
                  <h3 className="oh-group-title">Проверка и образцы</h3>
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
                    <div className="oh-field">
                      <span className="oh-note">Траектории на странице</span>
                      <div className="form-audit">
                        {plotterWorkspace.activeLayout.trajectoryReport.map((r) => (
                          <span key={r.character}>
                            {r.character}: {r.distinct} форм на {r.count} букв
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              )}
          </>
        )}
      </div>
      <div className="oh-inspector-footer">
        <button className="oh-button is-quiet" type="button" onClick={resetSettings}>
          <Icon name="reset" />
          <span>Сбросить настройки</span>
        </button>
      </div>
    </aside>
  );
}
