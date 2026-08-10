import { useEffect, useMemo, useRef, useState } from "react";
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

function decodePayload(payload?: OpenHandFilePayload | null): GCodeDocument | null {
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
  const binary = atob(payload.data);
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
            <code
              key={index}
              style={{ top: `${index * SOURCE_ROW_HEIGHT}px` }}
            >
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
  const [parsing, setParsing] = useState(false);
  const [showTravel, setShowTravel] = useState(true);
  const [zoom, setZoom] = useState(1);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!payload) return;
    try {
      const nextDocument = decodePayload(payload);
      if (nextDocument) {
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
    parseGCodeAsync(document?.text || "")
      .then((parsed) => {
        if (!cancelled) setResult(parsed);
      })
      .catch((reason) => {
        if (!cancelled) {
          setResult(EMPTY_RESULT);
          setError(
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
  }, [document?.text]);

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
      setDocument({
        name: file.name,
        text: normalizeGCodeSource(await file.text()),
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

  const hasDrawing = result.drawing.length > 0;

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
            <strong>Просмотр G-code</strong>
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

      {error && (
        <p className="gcode-viewer-warning" role="alert">
          {error}
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
          Очень большая траектория показана с прореживанием; расстояния и статистика рассчитаны полностью.
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
            Файл обрабатывается только на этом устройстве, максимум {MAX_GCODE_FILE_BYTES / 1024 / 1024} МБ.
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
                  onChange={(event) => setZoom(Number(event.target.value))}
                />
                <output>{Math.round(zoom * 100)}%</output>
              </label>
            </div>
            <div className="gcode-canvas">
              {hasDrawing ? (
                <svg
                  viewBox={viewBox}
                  style={{ transform: `scale(${zoom})` }}
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
              ) : (
                <div className="gcode-empty-preview">
                  <strong>Нет линий для просмотра</strong>
                  <span>В файле не найдены движения с опущенным пером.</span>
                </div>
              )}
            </div>
          </section>
          <aside className="gcode-source-panel" aria-label="Содержимое файла">
            <header>
              <strong>Команды</strong>
              <span>{result.lineCount.toLocaleString("ru-RU")} строк</span>
            </header>
            <VirtualizedSource
              source={document.text}
              offsets={result.lineOffsets}
            />
          </aside>
        </div>
      )}
    </main>
  );
}
