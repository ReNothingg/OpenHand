import { useEffect, useMemo, useRef, useState } from "react";
import LiquidRange from "../../controls/LiquidRange";
import { fonts } from "../../../fonts";
import {
  BUILTIN_GFONT_FAMILIES,
  BUILTIN_GFONT_OPTIONS,
} from "../../../plotter/gfont";

function pluralize(count: number, one: string, few: string, many: string) {
  const tens = count % 100;
  const units = count % 10;
  if (tens >= 11 && tens <= 19) return many;
  if (units === 1) return one;
  if (units >= 2 && units <= 4) return few;
  return many;
}

export default function FontPicker({
  fontType,
  value,
  plotterFontId,
  onChange,
  customFonts = [],
  onUpload,
}: {
  fontType: string;
  value: string;
  plotterFontId: string;
  onChange: (selection: { type: string; value: string }) => void;
  customFonts?: Array<{
    id: string;
    name: string;
    size: number;
    plotterFontId: string;
  }>;
  onUpload: (file?: File) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useRef(null);
  const uploadRef = useRef(null);
  const selectedScreen =
    fonts.find((font) => font.family === value) || fonts[0];
  const selectedCustom = customFonts.find(
    (font) => font.plotterFontId === plotterFontId,
  );
  const customSelected = fontType === "plotter" && Boolean(selectedCustom);
  const selectedPlotter =
    BUILTIN_GFONT_OPTIONS.find((font) => font.id === plotterFontId) ||
    BUILTIN_GFONT_OPTIONS[0];
  const [activeFamilyId, setActiveFamilyId] = useState(
    selectedPlotter.familyId,
  );
  const selected: { name: string; kind: string; family?: string } =
    fontType === "plotter"
      ? { name: selectedCustom?.name || selectedPlotter.label, kind: "plotter" }
      : { ...selectedScreen, kind: "screen" };
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const filtered = useMemo(
    () =>
      fonts.filter((font) =>
        `${font.name} ${font.group}`
          .toLocaleLowerCase("ru")
          .includes(normalizedQuery),
      ),
    [normalizedQuery],
  );
  const filteredFamilies = useMemo(
    () =>
      BUILTIN_GFONT_FAMILIES.filter((family) =>
        `${family.label} ${family.description} ${family.variants.map((variant) => variant.label).join(" ")}`
          .toLocaleLowerCase("ru")
          .includes(normalizedQuery),
      ),
    [normalizedQuery],
  );
  const filteredCustomFonts = useMemo(
    () =>
      customFonts.filter((font) =>
        font.name.toLocaleLowerCase("ru").includes(normalizedQuery),
      ),
    [customFonts, normalizedQuery],
  );
  const activeFamily =
    BUILTIN_GFONT_FAMILIES.find((family) => family.id === activeFamilyId) ||
    BUILTIN_GFONT_FAMILIES[0];
  const activeVariantIndex = Math.max(
    0,
    activeFamily.variants.findIndex((variant) => variant.id === plotterFontId),
  );

  useEffect(() => {
    if (fontType === "plotter" && !customSelected)
      setActiveFamilyId(selectedPlotter.familyId);
  }, [customSelected, fontType, selectedPlotter.familyId]);

  useEffect(() => {
    const close = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const chooseFamily = (family: (typeof BUILTIN_GFONT_FAMILIES)[number]) => {
    setActiveFamilyId(family.id);
    if (selectedPlotter.familyId !== family.id || fontType !== "plotter") {
      onChange({ type: "plotter", value: family.variants[0].id });
    }
  };

  const chooseVariant = (variant: { id: string }) => {
    onChange({ type: "plotter", value: variant.id });
  };

  return (
    <div className="font-picker" ref={rootRef}>
      <div className="font-picker-row">
        <button
          className="font-picker-trigger"
          type="button"
          aria-haspopup="listbox"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <span
            className={selected.kind === "plotter" ? "plotter-font-name" : ""}
            style={
              selected.kind === "screen"
                ? { fontFamily: `'${selected.family}'` }
                : undefined
            }
          >
            {selected.name}
          </span>
          <em className={`font-kind-badge ${selected.kind}`}>
            {selected.kind === "plotter" ? "GFont" : "Экранный"}
          </em>
          <b>⌄</b>
        </button>
        <button
          className="font-upload-button"
          type="button"
          title="Загрузить свой .gfont"
          onClick={() => uploadRef.current?.click()}
        >
          <span aria-hidden="true">↑</span>
          Загрузить
        </button>
      </div>
      <a className="font-studio-link" href="?view=font">
        Создать свой шрифт в мастерской <span>→</span>
      </a>
      <input
        ref={uploadRef}
        type="file"
        accept=".gfont,application/octet-stream"
        hidden
        onChange={(event) => {
          onUpload(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      {open && (
        <div className="font-picker-menu">
          <input
            autoFocus
            type="search"
            value={query}
            placeholder="Найти шрифт…"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setOpen(false);
            }}
          />
          <div className="font-picker-list">
            {filteredCustomFonts.length > 0 && (
              <div className="custom-gfont-section">
                <div className="font-section-heading">
                  <span>Мои GFont</span>
                  <em>сохранены в браузере</em>
                </div>
                <div
                  className="custom-gfont-grid"
                  role="listbox"
                  aria-label="Мои шрифты"
                >
                  {filteredCustomFonts.map((font) => (
                    <button
                      className={
                        font.plotterFontId === plotterFontId &&
                        fontType === "plotter"
                          ? "selected"
                          : ""
                      }
                      type="button"
                      role="option"
                      aria-selected={
                        font.plotterFontId === plotterFontId &&
                        fontType === "plotter"
                      }
                      key={font.id}
                      onClick={() => {
                        onChange({
                          type: "plotter",
                          value: font.plotterFontId,
                        });
                        setOpen(false);
                        setQuery("");
                      }}
                    >
                      <span>{font.name}</span>
                      <small>
                        {Math.max(1, Math.round(font.size / 1024))} КБ
                      </small>
                    </button>
                  ))}
                </div>
              </div>
            )}
            {(filteredFamilies.length > 0 || filtered.length > 0) && (
              <div className="unified-font-section">
                {filteredFamilies.length > 0 && (
                  <>
                    <div
                      className="plotter-family-tabs"
                      role="listbox"
                      aria-label="Однолинейный шрифт"
                    >
                      {filteredFamilies.map((family) => (
                        <button
                          className={[
                            activeFamily.id === family.id ? "active" : "",
                            fontType === "plotter" &&
                            !customSelected &&
                            selectedPlotter.familyId === family.id
                              ? "selected"
                              : "",
                          ]
                            .filter(Boolean)
                            .join(" ")}
                          type="button"
                          role="option"
                          aria-selected={
                            fontType === "plotter" &&
                            !customSelected &&
                            selectedPlotter.familyId === family.id
                          }
                          key={family.id}
                          onClick={() => chooseFamily(family)}
                        >
                          <span>{family.label}</span>
                          <small>
                            {family.variants.length}{" "}
                            {pluralize(
                              family.variants.length,
                              "вариант",
                              "варианта",
                              "вариантов",
                            )}
                          </small>
                        </button>
                      ))}
                    </div>
                    {filteredFamilies.some(
                      (family) => family.id === activeFamily.id,
                    ) && (
                      <div className="font-variant-panel">
                        <LiquidRange
                          className="font-variant-range"
                          min="0"
                          max={activeFamily.variants.length - 1}
                          step="1"
                          value={activeVariantIndex}
                          aria-label={`Вариант шрифта ${activeFamily.label}`}
                          onChange={(event) =>
                            chooseVariant(
                              activeFamily.variants[Number(event.target.value)],
                            )
                          }
                        />
                        <div
                          className="font-variant-labels"
                          style={{
                            "--variant-count": activeFamily.variants.length,
                          }}
                        >
                          {activeFamily.variants.map((variant, index) => (
                            <button
                              className={
                                index === activeVariantIndex &&
                                fontType === "plotter" &&
                                !customSelected
                                  ? "selected"
                                  : ""
                              }
                              type="button"
                              key={variant.id}
                              onClick={() => chooseVariant(variant)}
                            >
                              {variant.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
                {filtered.length > 0 && (
                  <div className="font-picker-group unified-font-group">
                    <div className="screen-font-grid">
                      {filtered.map((font) => (
                        <button
                          className={`screen-font-card ${fontType !== "plotter" && font.family === value ? "selected" : ""}`}
                          type="button"
                          role="option"
                          aria-selected={
                            fontType !== "plotter" && font.family === value
                          }
                          key={font.family}
                          title={font.name}
                          onClick={() => {
                            onChange({ type: "screen", value: font.family });
                            setOpen(false);
                            setQuery("");
                          }}
                        >
                          <span style={{ fontFamily: `'${font.family}'` }}>
                            {font.name}
                          </span>
                          {font.cyrillic === false && <em>Latin</em>}
                          {font.cyrillic === "partial" && <em>част. кир.</em>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {!filtered.length &&
              !filteredFamilies.length &&
              !filteredCustomFonts.length && (
                <div className="font-picker-empty">Ничего не найдено</div>
              )}
          </div>
        </div>
      )}
    </div>
  );
}
