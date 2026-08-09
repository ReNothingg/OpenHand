import { useRef, useState } from "react";
import {
  vectorizePhotoSheet,
  vectorizeSinglePhoto,
} from "./photoVectorization";

const TEMPLATE_FILENAME = "openhand-handwriting-sheet.svg";
const TEMPLATE_URL = `${import.meta.env.BASE_URL}templates/${TEMPLATE_FILENAME}`;

function downloadTemplateFile() {
  const anchor = document.createElement("a");
  anchor.href = TEMPLATE_URL;
  anchor.download = TEMPLATE_FILENAME;
  anchor.click();
}

export default function PhotoFontImporter({
  activeCharacter,
  characters,
  onImportCharacter,
  onImportSheet,
  onClose,
}: {
  activeCharacter: string;
  characters: string[];
  onImportCharacter: (strokes: Array<Array<{ x: number; y: number }>>) => void;
  onImportSheet: (
    glyphs: Record<string, Array<Array<{ x: number; y: number }>>>,
    options: { replaceExisting: boolean },
  ) => void;
  onClose: () => void;
}) {
  const singleRef = useRef<HTMLInputElement>(null);
  const sheetRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState(0);

  const importSingle = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setStatus(`Распознаём символ «${activeCharacter}»…`);
    try {
      const strokes = await vectorizeSinglePhoto(file);
      if (!strokes.length)
        throw new Error(
          "Не удалось выделить линии. Используйте тёмную ручку и ровный свет.",
        );
      onImportCharacter(strokes);
      setStatus(
        `Символ «${activeCharacter}» распознан. Проверьте линии на холсте.`,
      );
    } catch (reason) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "Не удалось обработать фотографию.",
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  const importSheet = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setProgress(0);
    setStatus("Ищем угловые метки и выравниваем лист…");
    try {
      const result = await vectorizePhotoSheet(
        file,
        characters,
        ({ phase, progress: value }) => {
          setProgress(value);
          if (phase === "glyphs")
            setStatus(`Распознаём символы: ${Math.round(value * 100)}%`);
        },
      );
      const count = Object.keys(result.glyphs).length;
      if (!count)
        throw new Error("На бланке не найдено ни одного уверенного символа.");
      onImportSheet(result.glyphs, { replaceExisting });
      setStatus(
        `${count} символов добавлено. ${
          result.markerCorrection
            ? "Перспектива исправлена по четырём меткам."
            : "Метки не найдены: использовано выравнивание по границам фотографии."
        }`,
      );
    } catch (reason) {
      setStatus(
        reason instanceof Error
          ? reason.message
          : "Не удалось обработать бланк.",
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  };

  return (
    <div
      className="photo-import-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section
        className="photo-import-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="photo-import-title"
      >
        {/* <header>
          <button type="button" aria-label="Закрыть" disabled={busy} onClick={onClose}>×</button>
        </header> */}

        <div className="photo-import-options">
          <article>
            <b>Один символ</b>
            <p>
              Сфотографируйте крупно текущий символ «{activeCharacter}». Линии
              появятся на холсте, где их можно поправить вручную.
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() => singleRef.current?.click()}
            >
              Загрузить «{activeCharacter}»
            </button>
          </article>
          <article>
            <b>Весь алфавит по бланку</b>
            <p>
              Скачайте бланк, заполните тёмной ручкой и сфотографируйте целиком.
              Четыре метки исправят наклон камеры.
            </p>
            <div>
              <button
                type="button"
                disabled={busy}
                onClick={downloadTemplateFile}
              >
                Скачать бланк
              </button>
              <button
                className="primary"
                type="button"
                disabled={busy}
                onClick={() => sheetRef.current?.click()}
              >
                Распознать бланк
              </button>
            </div>
            <label>
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />
              <span>Заменять уже нарисованные символы</span>
            </label>
          </article>
        </div>

        {(status || busy) && (
          <div className="photo-import-status" role="status">
            <span>{status}</span>
            {busy && <progress max="1" value={progress || undefined} />}
          </div>
        )}
        <footer>
          <button type="button" disabled={busy} onClick={onClose}>
            Готово
          </button>
        </footer>

        <input
          ref={singleRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={importSingle}
        />
        <input
          ref={sheetRef}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={importSheet}
        />
      </section>
    </div>
  );
}
