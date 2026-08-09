import { useEffect } from "react";
import { STORAGE_KEYS } from "../app/config";
import { saveStoredValues } from "../lib/storage";

export function useDocumentPersistence({
  markdown,
  texSource,
  sourceMode,
  settings,
  onSaveError,
}) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = saveStoredValues({
        [STORAGE_KEYS.markdown]: markdown,
        [STORAGE_KEYS.tex]: texSource,
        [STORAGE_KEYS.sourceMode]: sourceMode,
        [STORAGE_KEYS.settings]: JSON.stringify(settings),
      });
      if (!saved) onSaveError?.();
    }, 350);
    return () => window.clearTimeout(timer);
  }, [markdown, onSaveError, settings, sourceMode, texSource]);
}
