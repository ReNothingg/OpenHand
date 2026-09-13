import { useEffect, useMemo, useRef, useState } from "react";
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
import "./font-studio.css";

import { normalizePenSettings, type FontPoint, type FontStroke, type PenSettings } from "./penInput";

const DRAFT_KEY = "openhand.font-studio.draft.v1";

type GlyphMap = Record<string, FontStroke[]>;
type FontDraft = { name?: unknown; glyphs?: unknown; penSettings?: PenSettings };

function readDraft() {
  const draft = loadStoredObject<FontDraft>(DRAFT_KEY, {});
  return {
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
  const [tool, setTool] = useState<"pen" | "eraser">("pen");
  const penSeenRef = useRef(false);
  const [redoHistory, setRedoHistory] = useState<FontStroke[][]>([]);
  const [name, setName] = useState(initial.name);
  const [glyphs, setGlyphs] = useState<GlyphMap>(initial.glyphs);
  const [activeCharacter, setActiveCharacter] = useState("А");
  const [history, setHistory] = useState<FontStroke[][]>([]);
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT.ru);
  const [previewSize, setPreviewSize] = useState(32);
  const [notice, setNotice] = useState("");
  const [photoOpen, setPhotoOpen] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const completedCount = ALL_CHARACTERS.filter((character) =>
    glyphs[character]?.some((stroke) => stroke.length > 1),
  ).length;
  const currentIndex = ALL_CHARACTERS.indexOf(activeCharacter);
  const currentStrokes = glyphs[activeCharacter] || [];

  useEffect(() => {
    const save = () => {
      if (!saveStoredValues({ [DRAFT_KEY]: JSON.stringify({ name, glyphs, penSettings }) }))
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
  }, [name, glyphs, penSettings]);

  const updateGlyph = (
    strokes: FontStroke[],
    options: { previous?: FontStroke[] } = {},
  ) => {
    setHistory((current) => [
        ...current.slice(-29),
        options.previous || currentStrokes,
      ]);
    setRedoHistory([]);
    setGlyphs((current) => ({ ...current, [activeCharacter]: strokes }));
  };

  const undo = () => {
    const previous = history.at(-1);
    if (!previous) return;
    setRedoHistory((current) => [...current.slice(-29), currentStrokes]);
    setGlyphs((current) => ({ ...current, [activeCharacter]: previous }));
    setHistory((current) => current.slice(0, -1));
  };

  const redo = () => {
    const next = redoHistory.at(-1);
    if (!next) return;
    setHistory((current) => [...current.slice(-29), currentStrokes]);
    setRedoHistory((current) => current.slice(0, -1));
    setGlyphs((current) => ({ ...current, [activeCharacter]: next }));
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
    setHistory((current) => [...current.slice(-29), currentStrokes]);
    setGlyphs((current) => ({ ...current, [activeCharacter]: [] }));
  };

  const clearAll = () => {
    if (
      !completedCount ||
      !window.confirm("Очистить все заполненные символы и начать заново?")
    )
      return;
    setGlyphs({});
    setHistory([]);
    setRedoHistory([]);
    setNotice("Все символы очищены. Можно создавать новый шрифт.");
  };

  const moveCharacter = (direction: number) => {
    const index =
      (currentIndex + direction + ALL_CHARACTERS.length) %
      ALL_CHARACTERS.length;
    setActiveCharacter(ALL_CHARACTERS[index]);
    setHistory([]);
    setRedoHistory([]);
  };

  const exportFont = () => {
    if (!completedCount) {
      setNotice("Нарисуйте хотя бы один символ перед скачиванием.");
      return;
    }
    downloadBlob(createGFontBlob(glyphs), safeFontFilename(name));
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
      for (const character of ALL_CHARACTERS) {
        const glyph = await font.getGlyph(character.codePointAt(0));
        if (glyph) imported[character] = splitGlyph(glyph);
      }
      setHistory([]);
      setRedoHistory([]);
      setGlyphs(imported);
      setName(file.name.replace(/\.gfont$/i, "") || "Мой почерк");
      setNotice(`Загружено символов: ${Object.keys(imported).length}.`);
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : String(reason));
    }
    event.target.value = "";
  };

  const importPhotoCharacter = (strokes: FontStroke[]) => {
    setHistory((current) => [...current.slice(-29), currentStrokes]);
    setRedoHistory([]);
    setGlyphs((current) => ({ ...current, [activeCharacter]: strokes }));
  };

  const importPhotoSheet = (imported, { replaceExisting = false } = {}) => {
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
            <span>
              {completedCount} из {ALL_CHARACTERS.length}
            </span>
          </div>
          <div className="font-character-list">
            {CHARACTER_GROUPS.map((item) => {
              const ready = item.characters.filter(
                (character) => glyphs[character]?.length,
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
                          glyphs[character]?.length ? "complete" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                        type="button"
                        key={character}
                        onClick={() => {
                          setActiveCharacter(character);
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
              <div>
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
              <div>
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
            <FontCanvas
              key={activeCharacter}
              settings={penSettings}
              tool={tool}
              penSeenRef={penSeenRef}
              character={activeCharacter}
              strokes={currentStrokes}
              onChange={updateGlyph}
            />
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
              glyphs={glyphs}
              penSettings={penSettings}
              size={previewSize}
            />
          </section>
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
