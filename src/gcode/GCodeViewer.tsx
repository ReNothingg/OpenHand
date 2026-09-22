import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { downloadFile } from "../lib/files";
import AppearanceControl from "../components/AppearanceControl";
import GCodePenControls from "./GCodePenControls";
import { readPenModel, type GCodePenModel } from "./penModel";
import {
  base64DecodedSize,
  MAX_GCODE_FILE_BYTES,
  previewSegments,
  validateGCodeFileSize,
} from "./limits";
import { parseGCodeAsync } from "./parseAsync";
import {
  normalizeGCodeSource,
  parseGCode,
  segmentsToPathChunks,
  type GCodeParseResult,
} from "./parser";

const EMPTY_RESULT = parseGCode("");
const SOURCE_ROW_HEIGHT = 18;
const SOURCE_OVERSCAN = 40;

interface GCodeDocument {
  name: string;
  text: string;
}

function decodePayload(
  payload?: OpenHandFilePayload | null,
): GCodeDocument | null {
  if (!payload) return null;
  if (typeof payload.content === "string") {
    validateGCodeFileSize(new Blob([payload.content]).size);
    return {
      name: payload.name || "openhand.gcode",
      text: normalizeGCodeSource(payload.content),
    };
  }
  if (typeof payload.data !== "string") return null;
  validateGCodeFileSize(base64DecodedSize(payload.data));
  let binary: string;
  try { binary = atob(payload.data); }
  catch { throw new Error("Не удалось прочитать переданный файл: данные повреждены. Откройте исходный G-code заново."); }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return {
    name: payload.name || "openhand.gcode",
    text: normalizeGCodeSource(new TextDecoder().decode(bytes)),
  };
}

function formatDistance(value: number) {
  if (value >= 1000) return `${(value / 1000).toFixed(2)} м`;
  return `${value.toFixed(1)} мм`;
}

function initialDocument(payload?: OpenHandFilePayload | null) {
  try {
    return decodePayload(payload);
  } catch {
    return null;
  }
}

function VirtualizedSource({
  source,
  offsets,
}: {
  source: string;
  offsets: Uint32Array;
}) {
  const containerRef = useRef<HTMLPreElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 640 });

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;
    const updateHeight = () =>
      setViewport((current) => ({
        ...current,
        height: container.clientHeight || current.height,
      }));
    updateHeight();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(updateHeight);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const start = Math.max(
    0,
    Math.floor(viewport.scrollTop / SOURCE_ROW_HEIGHT) - SOURCE_OVERSCAN,
  );
  const visibleCount =
    Math.ceil(viewport.height / SOURCE_ROW_HEIGHT) + SOURCE_OVERSCAN * 2;
  const end = Math.min(offsets.length, start + visibleCount);

  return (
    <pre
      ref={containerRef}
      onScroll={(event) =>
        setViewport({
          scrollTop: event.currentTarget.scrollTop,
          height: event.currentTarget.clientHeight,
        })
      }
    >
      <div
        className="gcode-source-virtual"
        style={{ height: `${offsets.length * SOURCE_ROW_HEIGHT}px` }}
      >
        {Array.from({ length: end - start }, (_, offset) => {
          const index = start + offset;
          const lineStart = offsets[index] ?? 0;
          const nextLineStart = offsets[index + 1];
          const lineEnd =
            nextLineStart === undefined
              ? source.length
              : Math.max(lineStart, nextLineStart - 1);
          const line = source.slice(lineStart, lineEnd);
          return (
            <code key={index} style={{ top: `${index * SOURCE_ROW_HEIGHT}px` }}>
              <i>{index + 1}</i>
              <span>{line || " "}</span>
            </code>
          );
        })}
      </div>
    </pre>
  );
}

export default function GCodeViewer({
  payload,
  onClose,
}: {
  payload?: OpenHandFilePayload | null;
  onClose: () => void;
}) {
  const [document, setDocument] = useState<GCodeDocument | null>(() =>
    initialDocument(payload),
  );
  const [result, setResult] = useState<GCodeParseResult>(EMPTY_RESULT);
  const [error, setError] = useState("");
  const [parseError, setParseError] = useState("");
  const [parsing, setParsing] = useState(false);
  const [showTravel, setShowTravel] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [previous, setPrevious] = useState<GCodeDocument | null>(null);
  const [previewPen, setPreviewPen] = useState<GCodePenModel | undefined>();
  const filePen = useMemo(() => readPenModel(document?.text || ""), [document?.text]);
  const inputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 640, height: 480 });
  const zoomAnchor = useRef<{ x: number; y: number } | null>(null);
  const hasDocument = Boolean(document);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const publish = (width: number, height: number) => {
      const next = { width: Math.max(1, Math.floor(width)), height: Math.max(1, Math.floor(height)) };
      setCanvasSize(current => current.width === next.width && current.height === next.height ? current : next);
    };
    const update = () => {
      const style = getComputedStyle(canvas);
      const rect = canvas.getBoundingClientRect();
      publish(rect.width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
        rect.height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect;
      if (rect) publish(rect.width, rect.height);
    });
    observer?.observe(canvas);
    window.addEventListener("resize", update);
    return () => { observer?.disconnect(); window.removeEventListener("resize", update); };
  }, [hasDocument]);

  const changeZoom = (next: number) => {
    const canvas = canvasRef.current, stage = canvas?.firstElementChild;
    if (canvas && stage) {
      const style = getComputedStyle(canvas), bounds = stage.getBoundingClientRect();
      zoomAnchor.current = {
        x: (canvas.scrollLeft + canvas.clientWidth / 2 - parseFloat(style.paddingLeft)) / Math.max(1, bounds.width),
        y: (canvas.scrollTop + canvas.clientHeight / 2 - parseFloat(style.paddingTop)) / Math.max(1, bounds.height),
      };
    }
    setZoom(next);
  };
  useLayoutEffect(() => {
    const anchor = zoomAnchor.current, canvas = canvasRef.current, stage = canvas?.firstElementChild;
    if (!anchor || !canvas || !stage) return;
    zoomAnchor.current = null;
    const style = getComputedStyle(canvas), bounds = stage.getBoundingClientRect();
    canvas.scrollLeft = anchor.x * bounds.width + parseFloat(style.paddingLeft) - canvas.clientWidth / 2;
    canvas.scrollTop = anchor.y * bounds.height + parseFloat(style.paddingTop) - canvas.clientHeight / 2;
  }, [zoom]);

  useEffect(() => {
    if (!payload) return;
    try {
      const nextDocument = decodePayload(payload);
      if (nextDocument) {
        setEditing(false);
        setPrevious(null);
        setPreviewPen(undefined);
        setDocument(nextDocument);
        setError("");
        setZoom(1);
      }
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось прочитать содержимое файла.",
      );
    }
  }, [payload]);

  useEffect(() => {
    let cancelled = false;
    setResult(EMPTY_RESULT);
    setParsing(true);
    setParseError("");
    parseGCodeAsync(document?.text || "", { penModel: previewPen })
      .then((parsed) => {
        if (!cancelled) setResult(parsed);
      })
      .catch((reason) => {
        if (!cancelled) {
          setResult(EMPTY_RESULT);
          setParseError(
            reason instanceof Error
              ? reason.message
              : "Не удалось разобрать G-code.",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setParsing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [document?.text, previewPen]);

  const drawingPreview = useMemo(
    () => previewSegments(result.drawing),
    [result.drawing],
  );
  const travelPreview = useMemo(
    () => previewSegments(result.travel),
    [result.travel],
  );
  const drawingPaths = useMemo(
    () => segmentsToPathChunks(drawingPreview),
    [drawingPreview],
  );
  const travelPaths = useMemo(
    () => segmentsToPathChunks(travelPreview),
    [travelPreview],
  );
  const previewReduced =
    drawingPreview.length < result.drawingSegmentCount ||
    travelPreview.length < result.travelSegmentCount;
  const padding = Math.max(
    4,
    Math.max(result.bounds.width, result.bounds.height) * 0.035,
  );
  const viewBox = [
    result.bounds.minX - padding,
    result.bounds.minY - padding,
    result.bounds.width + padding * 2,
    result.bounds.height + padding * 2,
  ].join(" ");

  const openFile = async (file?: File) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase();
    if (!extension || !["gcode", "nc", "tap"].includes(extension)) {
      setError("Выберите файл G-code с расширением .gcode, .nc или .tap.");
      return;
    }
    try {
      validateGCodeFileSize(file.size);
      const text = normalizeGCodeSource(await file.text());
      setEditing(false);
      setPrevious(null);
      setPreviewPen(undefined);
      setDocument({
        name: file.name,
        text,
      });
      setError("");
      setZoom(1);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Не удалось прочитать выбранный файл.",
      );
    }
  };

  const hasGeometry = result.drawing.length + result.travel.length > 0;

  return (
    <main
      className="gcode-viewer"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void openFile(event.dataTransfer.files[0]);
      }}
    >
      <header className="gcode-viewer-header">
        <div className="gcode-viewer-title">
          <button className="button compact" type="button" onClick={onClose}>
            ← К документу
          </button>
          <div>
            <strong>Редактор G-code</strong>
            <span>{document?.name || "Файл не выбран"}</span>
          </div>
        </div>
        {document && (
          <div className="gcode-viewer-stats" aria-label="Сведения о файле">
            <span>
              <strong>{result.commandCount.toLocaleString("ru-RU")}</strong>{" "}
              команд
            </span>
            <span>
              <strong>
                {result.drawingSegmentCount.toLocaleString("ru-RU")}
              </strong>{" "}
              сегментов
            </span>
            <span>
              <strong>{formatDistance(result.drawDistance)}</strong> пером
            </span>
          </div>
        )}
        <div className="gcode-viewer-actions">
          <AppearanceControl />
          {document && (
            <>
              <button
                className="button compact"
                disabled={editing}
                onClick={() => {
                  setDraft(document.text);
                  setEditing(true);
                }}
              >
                Редактировать
              </button>
              <button
                className="button compact"
                disabled={!previous || editing}
                onClick={() => {
                  if (previous) {
                    setDocument(previous);
                    setPrevious(null);
                  }
                }}
              >
                Отменить правку
              </button>
              <button
                className="button compact"
                disabled={editing || parsing}
                onClick={() =>
                  void downloadFile(document.name, document.text, "text/plain")
                }
              >
                Сохранить как…
              </button>
            </>
          )}
          <input
            ref={inputRef}
            type="file"
            accept=".gcode,.nc,.tap,text/plain"
            hidden
            onChange={(event) => {
              void openFile(event.target.files?.[0]);
              event.target.value = "";
            }}
          />
          <button
            className="button primary compact"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            Открыть файл
          </button>
        </div>
      </header>

      {(error || parseError) && (
        <p className="gcode-viewer-warning" role="alert">
          {error || parseError}
        </p>
      )}
      {parsing && (
        <p className="gcode-viewer-warning neutral" role="status">
          Разбор траектории в фоне…
        </p>
      )}
      {document && result.ignoredLines.length > 0 && (
        <p className="gcode-viewer-warning" role="status">
          Не распознаны строки: {result.ignoredLines.slice(0, 8).join(", ")}
          {result.ignoredLines.length > 8
            ? ` и ещё ${result.ignoredLines.length - 8}`
            : ""}
          . Они не показаны на траектории.
        </p>
      )}
      {document && result.unsupportedMotionLines.length > 0 && (
        <p className="gcode-viewer-warning" role="status">
          Упрощены неподдерживаемые движения в строках:{" "}
          {result.unsupportedMotionLines.slice(0, 8).join(", ")}
          {result.unsupportedMotionLines.length > 8
            ? ` и ещё ${result.unsupportedMotionLines.length - 8}`
            : ""}
          . Проверьте траекторию перед запуском.
        </p>
      )}
      {previewReduced && (
        <p className="gcode-viewer-warning neutral" role="status">
          Очень большая траектория показана с прореживанием; расстояния и
          статистика рассчитаны полностью.
        </p>
      )}

      {!document ? (
        <button
          className="gcode-dropzone"
          type="button"
          onClick={() => inputRef.current?.click()}
        >
          <strong>Перетащите сюда файл G-code</strong>
          <span>или нажмите, чтобы выбрать .gcode, .nc или .tap</span>
          <small>
            Файл обрабатывается только на этом устройстве, максимум{" "}
            {MAX_GCODE_FILE_BYTES / 1024 / 1024} МБ.
          </small>
        </button>
      ) : (
        <div className="gcode-viewer-workspace">
          <section
            className="gcode-preview-panel"
            aria-label="Траектория G-code"
          >
            <div className="gcode-preview-toolbar">
              <label>
                <input
                  type="checkbox"
                  checked={showTravel}
                  onChange={(event) => setShowTravel(event.target.checked)}
                />
                <span>Холостые перемещения</span>
              </label>
              <label className="gcode-zoom">
                <span>Масштаб</span>
                <input
                  type="range"
                  min="0.6"
                  max="3"
                  step="0.1"
                  value={zoom}
                  aria-label="Масштаб просмотра G-code"
                  onChange={(event) => changeZoom(Number(event.target.value))}
                />
                <output>{Math.round(zoom * 100)}%</output>
              </label>
            </div>
            <GCodePenControls model={previewPen} fileModel={filePen} onChange={setPreviewPen} />
            <div className="gcode-canvas" ref={canvasRef}>
              {hasGeometry ? (
                <div className="gcode-canvas-stage" style={{ width: canvasSize.width * Math.max(1, zoom), height: canvasSize.height * Math.max(1, zoom) }}>
                <svg
                  viewBox={viewBox}
                  width={canvasSize.width * zoom}
                  height={canvasSize.height * zoom}
                  preserveAspectRatio="xMidYMid meet"
                  role="img"
                  aria-label={`Траектория файла ${document.name}`}
                >
                  <rect
                    x={result.bounds.minX - padding}
                    y={result.bounds.minY - padding}
                    width={result.bounds.width + padding * 2}
                    height={result.bounds.height + padding * 2}
                    className="gcode-paper"
                  />
                  {showTravel &&
                    travelPaths.map((path, index) => (
                      <path
                        key={`travel-${index}`}
                        d={path}
                        className="gcode-travel-path"
                      />
                    ))}
                  {drawingPaths.map((path, index) => (
                    <path
                      key={`drawing-${index}`}
                      d={path}
                      className="gcode-draw-path"
                    />
                  ))}
                </svg>
                </div>
              ) : (
                <div className="gcode-empty-preview">
                  <strong>Нет перемещений для просмотра</strong>
                  <span>В файле не найдены поддерживаемые перемещения по листу.</span>
                </div>
              )}
            </div>
          </section>
          <aside className="gcode-source-panel" aria-label="Содержимое файла">
            <header>
              <strong>Команды</strong>
              <span>{result.lineCount.toLocaleString("ru-RU")} строк</span>
            </header>
            {editing ? (
              <div className="gcode-edit-panel">
                <textarea
                  aria-label="Редактор команд G-code"
                  spellCheck={false}
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <div>
                  <button
                    className="button compact"
                    onClick={() => {
                      try {
                        validateGCodeFileSize(new Blob([draft]).size);
                        setPrevious(document);
                        setDocument({
                          ...document,
                          text: normalizeGCodeSource(draft),
                        });
                        setEditing(false);
                        setError("");
                      } catch (reason) {
                        setError(
                          reason instanceof Error
                            ? reason.message
                            : String(reason),
                        );
                      }
                    }}
                  >
                    Применить и проверить
                  </button>
                  <button
                    className="button compact"
                    onClick={() => setEditing(false)}
                  >
                    Отмена
                  </button>
                </div>
                <small>
                  Правки меняют файл. Перед отправкой на станок проверьте
                  команды и траекторию.
                </small>
              </div>
            ) : (
              <VirtualizedSource
                source={document.text}
                offsets={result.lineOffsets}
              />
            )}
          </aside>
        </div>
      )}
    </main>
  );
}
