import { useEffect, useMemo, useRef, useState } from "react";
import AppearanceControl from "../components/AppearanceControl";
import { loadGFont } from "../plotter/gfont";
import { ALL_CHARACTERS, CHARACTER_GROUPS, PREVIEW_TEXT } from "./characters";
import FontCanvas from "./FontCanvas";
import PenTools from "./PenTools";
import FontPreview from "./FontPreview";
import PhotoFontImporter from "./PhotoFontImporter";
import { createGFontBlob, safeFontFilename } from "./gfontExport";
import { downloadBlob } from "../lib/files";
import { loadStoredObject, saveStoredValues } from "../lib/storage";
import LiquidRange from "../components/controls/LiquidRange";
import PathEditor from './PathEditor';
import { validForms, repeatedForms, type LetterForm, type LetterForms } from './letterForms';

import { normalizePenSettings, type FontPoint, type FontStroke, type PenSettings } from "./penInput";

const DRAFT_KEY = "openhand.font-studio.draft.v1";

type GlyphMap = Record<string, FontStroke[]>;
type FontDraft = { name?: unknown; glyphs?: unknown; penSettings?: PenSettings; forms?: LetterForms };

function readDraft() {
  const draft = loadStoredObject<FontDraft>(DRAFT_KEY, {});
  return {
    forms: Object.fromEntries(Object.entries(draft.forms || {}).map(([c, f]) => [c, validForms(f)])),
    penSettings: normalizePenSettings(draft.penSettings),
    name: typeof draft.name === "string" ? draft.name : "Мой почерк",
    glyphs:
      draft.glyphs && typeof draft.glyphs === "object"
        ? (draft.glyphs as GlyphMap)
        : {},
  };
}

function splitGlyph(glyph: {
  points: FontPoint[];
  flags: number[];
}): FontStroke[] {
  const strokes: FontStroke[] = [];
  let stroke: FontStroke | null = null;
  glyph.points.forEach((point, index) => {
    if (glyph.flags[index] === 0 || !stroke) {
      stroke = [];
      strokes.push(stroke);
    }
    stroke.push({ ...point });
  });
  return strokes.filter((item) => item.length > 1);
}

export default function FontStudio() {
  const initial = useMemo(readDraft, []);
  const [penSettings, setPenSettings] = useState(initial.penSettings);
  const [tool, setTool] = useState<"pen" | "eraser" | "trim">("pen");
  const penSeenRef = useRef(false);
  const [redoHistory, setRedoHistory] = useState<LetterForm[]>([]);
  const [name, setName] = useState(initial.name);
  const [glyphs, setGlyphs] = useState<GlyphMap>(initial.glyphs);
  const [forms, setForms] = useState<LetterForms>(initial.forms);
  const [variant, setVariant] = useState(0);
  const [activeCharacter, setActiveCharacter] = useState("А");
  const [history, setHistory] = useState<LetterForm[]>([]);
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT.ru);
  const [previewSize, setPreviewSize] = useState(32);
  const [notice, setNotice] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const exportGlyphs = { ...glyphs, ...Object.fromEntries(Object.entries(forms).flatMap(([c, variants]) => { const filled = variants.find(f => f.strokes.some(s => s.length > 1)); return filled ? [[c, filled.strokes]] : []; })) };
  const completedCount = ALL_CHARACTERS.filter((character) =>
    exportGlyphs[character]?.some((stroke) => stroke.length > 1),
  ).length;
  const currentIndex = ALL_CHARACTERS.indexOf(activeCharacter);
  const characterForms = forms[activeCharacter]?.length ? forms[activeCharacter] : [{ strokes: glyphs[activeCharacter] || [], position: 'any' as const }];
  const currentForm = characterForms[variant] || characterForms[0];
  const currentStrokes = currentForm.strokes;
  const writeCurrent = (strokes: FontStroke[]) => {
    setForms(current => ({ ...current, [activeCharacter]: characterForms.map((f, i) => i === variant ? { ...f, strokes, entry: undefined, exit: undefined } : f) }));
    if (!variant) setGlyphs(current => ({ ...current, [activeCharacter]: strokes }));
  };
  const updateForm = (form: LetterForm) => {
    updateGlyph(form.strokes);
    setForms(current => ({ ...current, [activeCharacter]: characterForms.map((f, i) => i === variant ? form : f) }));
  };
  const restoreForm = (form: LetterForm) => {
    setForms(current => ({ ...current, [activeCharacter]: characterForms.map((f, i) => i === variant ? form : f) }));
    if (!variant) setGlyphs(current => ({ ...current, [activeCharacter]: form.strokes }));
  };

  useEffect(() => {
    const save = () => {
      if (!saveStoredValues({ [DRAFT_KEY]: JSON.stringify({ name, glyphs, forms, penSettings }) }))
        setNotice("Черновик шрифта не удалось сохранить локально. Скачайте .gfont, чтобы сохранить работу.");
    };
    const hide = () => { if (document.hidden) save(); };
    const timer = window.setTimeout(save, 300);
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", hide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", hide);
    };
  }, [name, glyphs, forms, penSettings]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const updateGlyph = (
    strokes: FontStroke[],
    options: { previous?: FontStroke[] } = {},
  ) => {
    setHistory((current) => [
        ...current.slice(-29),
        options.previous ? { ...currentForm, strokes: options.previous } : currentForm,
      ]);
    setRedoHistory([]);
    writeCurrent(strokes);
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setRedoHistory((current) => [...current.slice(-29), currentForm]);
    restoreForm(previous);
    setHistory((current) => current.slice(0, -1));
  };

  const redo = () => {
    const next = redoHistory.at(-1);
    if (!next) return;
    setHistory((current) => [...current.slice(-29), currentForm]);
    setRedoHistory((current) => current.slice(0, -1));
    restoreForm(next);
  };

  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable]")) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo(); else undo();
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [history, redoHistory, activeCharacter, currentStrokes]);

  const clear = () => {
    setRedoHistory([]);
    if (!currentStrokes.length) return;
    setHistory((current) => [...current.slice(-29), currentForm]);
    writeCurrent([]);
  };

  const clearAll = () => {
    if (
      !completedCount ||
      !window.confirm("Очистить все заполненные символы и начать заново?")
    )
      return;
    setGlyphs({});
    setForms({});
    setVariant(0);
    setHistory([]);
    setRedoHistory([]);
    setNotice("Все символы очищены. Можно создавать новый шрифт.");
  };

  const moveCharacter = (direction: number) => {
    const index =
      (currentIndex + direction + ALL_CHARACTERS.length) %
      ALL_CHARACTERS.length;
    setActiveCharacter(ALL_CHARACTERS[index]);
    setVariant(0);
    setHistory([]);
    setRedoHistory([]);
  };

  const exportFont = () => {
    if (!completedCount) {
      setNotice("Нарисуйте хотя бы один символ перед скачиванием.");
      return;
    }
    downloadBlob(createGFontBlob(exportGlyphs, forms), safeFontFilename(name));
    setNotice(
      `Шрифт скачан: ${completedCount} ${completedCount === 1 ? "символ" : "символов"}.`,
    );
  };

  const importFont = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setNotice("Читаем шрифт…");
    try {
      const font = await loadGFont(file);
      const imported: GlyphMap = {};
      const importedForms: LetterForms = {};
      for (const character of ALL_CHARACTERS) {
        const glyph = await font.getGlyph(character.codePointAt(0));
        if (glyph) imported[character] = splitGlyph(glyph);
        if (glyph) importedForms[character] = await font.getForms(character.codePointAt(0));
      }
      setHistory([]);
      setRedoHistory([]);
      setGlyphs(imported);
      setForms(importedForms);
      setVariant(0);
      setName(file.name.replace(/\.gfont$/i, "") || "Мой почерк");
      setNotice(`Загружено символов: ${Object.keys(imported).length}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
    event.target.value = "";
  };

  const importPhotoCharacter = (strokes: FontStroke[]) => {
    setHistory((current) => [...current.slice(-29), currentForm]);
    setRedoHistory([]);
    writeCurrent(strokes);
  };

  const importPhotoSheet = (imported, { replaceExisting = false } = {}) => {
    setForms(current => Object.fromEntries(Object.entries(current).filter(([character]) => !imported[character] || (!replaceExisting && glyphs[character]?.length))));
    setVariant(0);
    setGlyphs((current) => {
      if (replaceExisting) return { ...current, ...imported };
      return Object.fromEntries([
        ...Object.entries(current),
        ...Object.entries(imported).filter(
          ([character]) => !current[character]?.length,
        ),
      ]);
    });
    setHistory([]);
    setRedoHistory([]);
  };

  return (
    <main className="font-studio">
      <header className="font-studio-toolbar">
        <a href="?">← В редактор</a>
        <label className="font-name-field">
          <span>Название</span>
          <input
            value={name}
            maxLength={48}
            onChange={(event) => setName(event.target.value)}
            aria-label="Название шрифта"
          />
        </label>
        <div className="font-studio-progress">
          <span>Готово</span>
          <strong>
            {completedCount} / {ALL_CHARACTERS.length}
          </strong>
        </div>
        <div className="font-studio-actions">
          <button
            className="danger"
            type="button"
            disabled={!completedCount}
            onClick={clearAll}
          >
            Начать заново
          </button>
          <button type="button" onClick={() => setPhotoOpen(true)}>
            По фотографии
          </button>
          <button type="button" onClick={() => importRef.current?.click()}>
            Открыть .gfont
          </button>
          <button className="primary" type="button" onClick={exportFont}>
            Скачать .gfont
          </button>
        </div>
        <AppearanceControl />
      </header>
      {notice && (
        <p className="font-studio-notice" role="status">
          {notice}
        </p>
      )}

      <div className="font-studio-workspace">
        <aside className="font-character-panel">
          <div className="font-character-panel-title">
            <strong>Символы</strong>
          </div>
          <div className="font-character-list">
            {CHARACTER_GROUPS.map((item) => {
              const ready = item.characters.filter(
                (character) => exportGlyphs[character]?.length,
              ).length;
              return (
                <section className="font-character-group" key={item.id}>
                  <div>
                    <strong>{item.label}</strong>
                    <small>
                      {ready}/{item.characters.length}
                    </small>
                  </div>
                  <div className="font-character-grid">
                    {item.characters.map((character) => (
                      <button
                        className={[
                          activeCharacter === character ? "active" : "",
                          exportGlyphs[character]?.length ? "complete" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        key={character}
                        onClick={() => {
                          setActiveCharacter(character);
                          setVariant(0);
                          setHistory([]);
    setRedoHistory([]);
                        }}
                        aria-label={`Редактировать символ ${character}`}
                      >
                        {character}
                        <i />
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        </aside>

        <div className="font-studio-main">
          <section className="font-canvas-panel">
            <div className="font-canvas-toolbar">
              <div className="character-navigation">
                <button
                  type="button"
                  aria-label="Предыдущий символ"
                  onClick={() => moveCharacter(-1)}
                >
                  ←
                </button>
                <strong>{activeCharacter}</strong>
                <button
                  type="button"
                  aria-label="Следующий символ"
                  onClick={() => moveCharacter(1)}
                >
                  →
                </button>
                <span>
                  {currentIndex + 1} из {ALL_CHARACTERS.length}
                </span>
              </div>
              <div className="canvas-actions">
                <button type="button" disabled={!history.length} onClick={undo}>
                  Отменить
                </button>
                <button type="button" disabled={!redoHistory.length} onClick={redo}>Повторить</button>
                <button
                  type="button"
                  disabled={!currentStrokes.length}
                  onClick={clear}
                >
                  Очистить
                </button>
              </div>
            </div>
            <PenTools settings={penSettings} onChange={setPenSettings} tool={tool} onToolChange={setTool} />
            <div className="variant-toolbar" role="group" aria-label="Начертания буквы">
              <label><span>Начертание</span><select value={variant} onChange={e => { setVariant(Number(e.target.value)); setHistory([]); setRedoHistory([]); }}>{characterForms.map((_, i) => <option value={i} key={i}>{i + 1}{i === 0 ? ' · основное' : ''}</option>)}</select></label>
              <div className="variant-actions">
                <button type="button" disabled={characterForms.length >= 6 || !currentStrokes.length} onClick={() => { setForms(current => ({ ...current, [activeCharacter]: [...characterForms, { strokes: [], position: 'any' }] })); setVariant(characterForms.length); setHistory([]); setRedoHistory([]); }}>Добавить</button>
                <button className="variant-delete" type="button" disabled={!variant} onClick={() => { setForms(current => ({ ...current, [activeCharacter]: characterForms.filter((_, i) => i !== variant) })); setVariant(0); setHistory([]); setRedoHistory([]); }}>Удалить</button>
              </div>
              <label className="variant-position"><span>Позиция в слове</span><select value={currentForm.position || 'any'} onChange={e => updateForm({ ...currentForm, position: e.target.value as LetterForm['position'] })}><option value="any">Любая</option><option value="initial">Начало</option><option value="medial">Середина</option><option value="final">Конец</option></select></label>
            </div>
            <FontCanvas
              key={`${activeCharacter}:${variant}`}
              settings={penSettings}
              tool={tool}
              penSeenRef={penSeenRef}
              character={activeCharacter}
              strokes={currentStrokes}
              onChange={updateGlyph}
            />
            <PathEditor key={`nodes:${activeCharacter}:${variant}`} form={currentForm} onChange={updateForm} />
          </section>

          <section className="font-live-preview">
            <div className="font-preview-toolbar">
              <label>
                <span>Предпросмотр</span>
                <input
                  value={previewText}
                  onChange={(event) => setPreviewText(event.target.value)}
                  aria-label="Текст предпросмотра"
                />
              </label>
              <label className="font-preview-size">
                <span>Размер</span>
                <LiquidRange
                  min="14"
                  max="56"
                  value={previewSize}
                  onChange={(event) =>
                    setPreviewSize(Number(event.target.value))
                  }
                  aria-label="Размер шрифта в предпросмотре"
                />
                <output>{previewSize} px</output>
              </label>
            </div>
            <FontPreview
              text={previewText}
              glyphs={exportGlyphs}
              forms={forms}
              penSettings={penSettings}
              size={previewSize}
            />
          </section>
          <details className="studio-detail"><summary>Повторяемость начертаний</summary><p>Сравниваются формы штрихов с точностью 0,1 единицы, без учёта переноса буквы. Различия наклона и размера не заменяют записанные варианты.</p><div className="form-audit">{repeatedForms({ ...Object.fromEntries(Object.entries(glyphs).map(([c, strokes]) => [c, [{ strokes }]])), ...forms }).map(item => <span key={item.character}>{item.character}: {item.distinct} уник. из {item.count}</span>)}</div></details>
        </div>
      </div>

      <input
        ref={importRef}
        type="file"
        accept=".gfont,application/octet-stream"
        hidden
        onChange={importFont}
      />
      {photoOpen && (
        <PhotoFontImporter
          activeCharacter={activeCharacter}
          characters={ALL_CHARACTERS}
          onImportCharacter={importPhotoCharacter}
          onImportSheet={importPhotoSheet}
          onClose={() => setPhotoOpen(false)}
        />
      )}
    </main>
  );
}
