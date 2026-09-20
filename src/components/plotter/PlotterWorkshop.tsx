import ImageImportDialog from "./ImageImportDialog";
import Icon from "../Icon";
import PanelResizeHandle from "../PanelResizeHandle";
import usePanelWidth from "../../hooks/usePanelWidth";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  alignToOrigin,
  bounds,
  hatch,
  parseCoordinateCSV,
  parseHPGL,
  parseWorkshop,
  repeat,
  serializeWorkshop,
  shape,
  transform,
  validateStrokes,
  type Stroke,
} from "../../plotter/workshop";
import { compilePlotJob, createDryRunCommands } from "../../plotter/job";
import { downloadFile } from "../../lib/files";
import PlotterSettings from "./PlotterSettings";
import { formatDuration } from "./PlotterFooter";

const STORAGE_KEY = "openhand.workshop.v1";
const EMPTY = { name: "Новый рисунок", strokes: [] as Stroke[] };
function load() {
  try {
    const source = localStorage.getItem(STORAGE_KEY);
    return source ? parseWorkshop(source) : EMPTY;
  } catch {
    return EMPTY;
  }
}
function Numeric({
  label,
  value,
  set,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: number;
  set: (n: number) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <label className="workshop-field">
      <span>{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) =>
          set(e.target.value === "" ? 0 : Number(e.target.value))
        }
      />
    </label>
  );
}

export default function PlotterWorkshop({
  workspace,
  toolbarHost,
}: {
  workspace: any;
  toolbarHost?: HTMLElement | null;
}) {
  const [imageFile, setImageFile] = useState<File | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const [footerCollapsed, setFooterCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = usePanelWidth("openhand.workshop-width");
  const [document, setDocument] = useState(load);
  const [history, setHistory] = useState<(typeof document)[]>([]);
  const [future, setFuture] = useState<(typeof document)[]>([]);
  const [tab, setTab] = useState("prepare");
  const [view, setView] = useState("drawing");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [kind, setKind] = useState("rectangle");
  const [width, setWidth] = useState(60),
    [height, setHeight] = useState(40);
  const [scale, setScale] = useState(100),
    [angle, setAngle] = useState(0);
  const [dx, setDx] = useState(0),
    [dy, setDy] = useState(0);
  const [columns, setColumns] = useState(2),
    [rows, setRows] = useState(2),
    [gap, setGap] = useState(5);
  const [spacing, setSpacing] = useState(2),
    [hatchAngle, setHatchAngle] = useState(45);
  const [travel, setTravel] = useState(false),
    [zoom, setZoom] = useState(1);
  const input = useRef<HTMLInputElement>(null);
  const { config, running, connected, plotter, calibrationActive } = workspace;
  const locked = running || calibrationActive;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const job = useMemo(
    () => compilePlotJob(document.strokes, config),
    [document.strokes, config],
  );
  const box = useMemo(() => bounds(document.strokes), [document.strokes]);
  const canRun =
    connected &&
    !locked &&
    workspace.armed &&
    workspace.originConfirmed &&
    workspace.activeProfile.calibratedAt &&
    job.withinWorkArea &&
    document.strokes.length > 0;
  const path = useMemo(
    () =>
      document.strokes
        .map((stroke) =>
          stroke
            .map(
              (p, i) => `${i ? "L" : "M"}${p.x.toFixed(3)} ${p.y.toFixed(3)}`,
            )
            .join(" "),
        )
        .join(" "),
    [document.strokes],
  );
  const travelPath = useMemo(
    () =>
      job.strokes
        .map((stroke, i) => {
          const last = i ? job.strokes[i - 1].at(-1) : { x: 0, y: 0 };
          return `M${last.x} ${last.y}L${stroke[0].x} ${stroke[0].y}`;
        })
        .join(" "),
    [job],
  );
  const previewWidth = Math.max(Number(config.workAreaWidth), box.maxX + 10),
    previewHeight = Math.max(Number(config.workAreaHeight), box.maxY + 10);
  const previewX = Math.min(-8, box.minX - 8),
    previewY = Math.min(-8, box.minY - 8);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          serializeWorkshop(document.strokes, document.name),
        );
      } catch {
        setError("Не удалось сохранить черновик. Сохраните проект в файл.");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [document]);
  useEffect(() => {
    workspace.setArmed(false);
  }, [document, job.id]);
  const attempt = async (action: () => unknown) => {
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const commit = (strokes: Stroke[], name = document.name) => {
    if (lockedRef.current) return;
    const safe = validateStrokes(strokes);
    setHistory((items) => [...items.slice(-11), document]);
    setFuture([]);
    setDocument({ name, strokes: safe });
  };
  const edit = (action: () => Stroke[]) => void attempt(() => commit(action()));
  const undo = () => {
    const last = history.at(-1);
    if (!last || locked) return;
    setHistory((h) => h.slice(0, -1));
    setFuture((f) => [...f, document]);
    setDocument(last);
  };
  const redo = () => {
    const next = future.at(-1);
    if (!next || locked) return;
    setFuture((f) => f.slice(0, -1));
    setHistory((h) => [...h, document]);
    setDocument(next);
  };
  const open = (file?: File) =>
    void attempt(async () => {
      if (!file || locked) return;
      if (/\.(png|jpe?g|webp)$/i.test(file.name)) { setImageFile(file); return; }
      if (file.size > 8_000_000) throw new Error("Файл больше 8 МБ.");
      const text = await file.text();
      if (/\.json$/i.test(file.name)) {
        const project = parseWorkshop(text);
        commit(project.strokes, project.name);
      } else if (/\.(hpgl|plt)$/i.test(file.name))
        commit(alignToOrigin(parseHPGL(text)), file.name);
      else if (/\.(csv|tsv)$/i.test(file.name))
        commit(parseCoordinateCSV(text), file.name);
      else
        throw new Error(
          "Откройте HPGL, CSV координат или проект JSON. SVG и DXF добавляются через редактор документа.",
        );
      setZoom(1);
    });
  const exportSVG = () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.max(1, box.width)}mm" height="${Math.max(1, box.height)}mm" viewBox="${box.minX} ${box.minY} ${Math.max(1, box.width)} ${Math.max(1, box.height)}"><path d="${path}" fill="none" stroke="black" stroke-width="0.3"/></svg>`;
    void downloadFile("drawing.svg", svg, "image/svg+xml");
  };
  return (
    <section className="plotter-workshop" aria-label="Мастерская плоттера">
      {imageFile && <ImageImportDialog file={imageFile} maxWidth={Math.max(1, config.workAreaWidth-20)} maxHeight={Math.max(1, config.workAreaHeight-20)} onClose={()=>setImageFile(null)} onApply={strokes => { commit([...document.strokes, ...strokes], document.strokes.length ? document.name : imageFile.name); setImageFile(null); }} />}
      <input type="file" hidden ref={imageInput} accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={e=>{ if (e.target.files?.[0] && !locked) setImageFile(e.target.files[0]); e.target.value=""; }} />
      {toolbarHost &&
        createPortal(
          <div className="workshop-toolbar" aria-label="Файл мастерской">
            <div>
              <input
                aria-label="Название рисунка"
                value={document.name}
                maxLength={120}
                disabled={locked}
                onChange={(e) =>
                  setDocument((d) => ({ ...d, name: e.target.value }))
                }
              />
            </div>
            <div className="workshop-buttons">
              <button disabled={locked} onClick={() => input.current?.click()}>
                Открыть
              </button>
              <button
                onClick={() =>
                  void attempt(() =>
                    downloadFile(
                      `${document.name || "drawing"}.json`,
                      serializeWorkshop(document.strokes, document.name),
                      "application/json",
                    ),
                  )
                }
              >
                Сохранить проект
              </button>
              <button disabled={!document.strokes.length} onClick={exportSVG}>
                SVG
              </button>
            </div>
            <input
              ref={input}
              type="file"
              hidden
              accept=".hpgl,.plt,.csv,.tsv,.json,.png,.jpg,.jpeg,.webp"
              onChange={(e) => {
                open(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>,
          toolbarHost,
        )}
      <div className="workshop-body" style={{ "--inspector-width": `min(${panelWidth}px, 65vw)` } as React.CSSProperties}>
        <aside className="workshop-inspector">
          <div
            className="workshop-tabs"
            role="tablist"
            aria-label="Панель мастерской"
          >
            <button
              role="tab"
              aria-selected={tab === "prepare"}
              onClick={() => setTab("prepare")}
            >
              Рисунок
            </button>
            <button
              role="tab"
              aria-selected={tab === "machine"}
              onClick={() => setTab("machine")}
            >
              Устройство
            </button>
          </div>
          {tab === "machine" ? (
            <PlotterSettings workspace={workspace} defaultOpen />
          ) : (
            <fieldset disabled={locked}>
              <section className="workshop-section">
                <h2>Добавить</h2>
                <button disabled={locked} onClick={()=>imageInput.current?.click()}>Изображение PNG / JPG</button>
                <label className="workshop-field">
                  <span>Фигура</span>
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                  >
                    <option value="rectangle">Прямоугольник</option>
                    <option value="ellipse">Эллипс</option>
                    <option value="triangle">Треугольник</option>
                    <option value="line">Линия</option>
                  </select>
                </label>
                <div className="workshop-pair">
                  <Numeric
                    label="Ширина, мм"
                    value={width}
                    set={setWidth}
                    min={0.1}
                    max={2000}
                  />
                  <Numeric
                    label="Высота, мм"
                    value={height}
                    set={setHeight}
                    min={0.1}
                    max={2000}
                  />
                </div>
                <button
                  onClick={() =>
                    edit(() => [
                      ...document.strokes,
                      ...shape(kind, width, height),
                    ])
                  }
                >
                  Добавить фигуру
                </button>
                <button
                  disabled={
                    !workspace.activeLayout?.strokes?.length || workspace.busy
                  }
                  onClick={() =>
                    edit(() => [
                      ...document.strokes,
                      ...workspace.activeLayout.strokes,
                    ])
                  }
                >
                  Взять штрихи из документа
                </button>
                <p>
                  SVG, DXF и почерк подготовьте в «Документе», затем перенесите
                  сюда. HPGL и CSV координат можно перетащить прямо на холст.
                </p>
                <p>
                  HPGL: один цвет, 40 единиц/мм. Скорость и перо берутся из
                  профиля устройства.
                </p>
              </section>
              <details className="workshop-section" open>
                <summary>Размер и положение</summary>
                <div className="workshop-pair">
                  <Numeric
                    label="Масштаб, %"
                    value={scale}
                    set={setScale}
                    min={1}
                    max={10000}
                  />
                  <Numeric
                    label="Поворот, °"
                    value={angle}
                    set={setAngle}
                    min={-360}
                    max={360}
                  />
                  <Numeric label="Сдвиг X, мм" value={dx} set={setDx} />
                  <Numeric label="Сдвиг Y, мм" value={dy} set={setDy} />
                </div>
                <button
                  disabled={!document.strokes.length}
                  onClick={() =>
                    edit(() =>
                      transform(document.strokes, {
                        scale: scale / 100,
                        angle,
                        x: dx,
                        y: dy,
                      }),
                    )
                  }
                >
                  Применить к рисунку
                </button>
                <div className="workshop-buttons">
                  <button
                    onClick={() =>
                      edit(() => transform(document.strokes, { mirrorX: true }))
                    }
                  >
                    Зеркало X
                  </button>
                  <button
                    onClick={() =>
                      edit(() => transform(document.strokes, { mirrorY: true }))
                    }
                  >
                    Зеркало Y
                  </button>
                </div>
                <button
                  onClick={() => edit(() => alignToOrigin(document.strokes))}
                >
                  К началу · отступ 10 мм
                </button>
              </details>
              <details className="workshop-section">
                <summary>Штриховка</summary>
                <div className="workshop-pair">
                  <Numeric
                    label="Шаг, мм"
                    value={spacing}
                    set={setSpacing}
                    min={0.2}
                    max={100}
                    step={0.2}
                  />
                  <Numeric
                    label="Угол, °"
                    value={hatchAngle}
                    set={setHatchAngle}
                  />
                </div>
                <p>
                  Заполняет замкнутые контуры и сохраняет отверстия. Исходный
                  контур остаётся.
                </p>
                <button
                  onClick={() =>
                    edit(() => [
                      ...document.strokes,
                      ...hatch(document.strokes, spacing, hatchAngle),
                    ])
                  }
                >
                  Добавить штриховку
                </button>
              </details>
              <details className="workshop-section">
                <summary>Повторить сеткой</summary>
                <div className="workshop-pair">
                  <Numeric
                    label="Столбцы"
                    value={columns}
                    set={setColumns}
                    min={1}
                    max={20}
                  />
                  <Numeric
                    label="Строки"
                    value={rows}
                    set={setRows}
                    min={1}
                    max={20}
                  />
                  <Numeric
                    label="Интервал, мм"
                    value={gap}
                    set={setGap}
                    min={0}
                    max={1000}
                  />
                </div>
                <button
                  onClick={() =>
                    edit(() => repeat(document.strokes, columns, rows, gap))
                  }
                >
                  Повторить рисунок
                </button>
              </details>
              <section className="workshop-section">
                <label className="workshop-check">
                  <input
                    type="checkbox"
                    checked={config.optimizePath}
                    onChange={(e) =>
                      workspace.updateConfig("optimizePath", e.target.checked)
                    }
                  />
                  Сокращать холостой путь
                </label>
                <p>
                  Подходит для отдельных фигур. Для связного почерка порядок
                  штрихов лучше сохранять.
                </p>
                <button
                  disabled={!document.strokes.length}
                  onClick={() => edit(() => [])}
                >
                  Очистить рисунок
                </button>
              </section>
            </fieldset>
          )}
        </aside>
        <PanelResizeHandle side="left" width={panelWidth} onChange={setPanelWidth} />
        <main className="workshop-main">
          <div className="workshop-canvas-toolbar">
            <div
              className="workshop-tabs"
              role="tablist"
              aria-label="Предпросмотр"
            >
              <button
                role="tab"
                aria-selected={view === "drawing"}
                onClick={() => setView("drawing")}
              >
                Траектория
              </button>
              <button
                role="tab"
                aria-selected={view === "code"}
                onClick={() => setView("code")}
              >
                G-code
              </button>
            </div>
            <div className="workshop-buttons">
              <button
                aria-label="Отменить изменение рисунка"
                disabled={!history.length || locked}
                onClick={undo}
              >
                <Icon name="undo" />
              </button>
              <button
                aria-label="Повторить изменение рисунка"
                disabled={!future.length || locked}
                onClick={redo}
              >
                <Icon name="redo" />
              </button>
              <button
                aria-label="Уменьшить масштаб"
                onClick={() => setZoom((z) => Math.max(0.5, z / 1.25))}
              >
                −
              </button>
              <button onClick={() => setZoom(1)}>
                {Math.round(zoom * 100)}%
              </button>
              <button
                aria-label="Увеличить масштаб"
                onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
              >
                +
              </button>
            </div>
          </div>
          {view === "code" ? (
            <pre className="workshop-code" tabIndex={0}>
              {job.commands.join("\n")}
            </pre>
          ) : (
            <div
              className={`workshop-canvas ${drag ? "dragging" : ""}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                open(e.dataTransfer.files[0]);
              }}
            >
              {document.strokes.length === 0 ? (
                <div className="workshop-empty">
                  <button onClick={() => input.current?.click()}>
                    Открыть рисунок
                  </button>
                </div>
              ) : (
                <svg
                  role="img"
                  aria-label="Предпросмотр рисунка в рабочей области плоттера"
                  viewBox={`${previewX} ${previewY} ${previewWidth - previewX + 8} ${previewHeight - previewY + 8}`}
                  style={{
                    width: `${zoom * 100}%`,
                    minWidth: `${zoom * 100}%`,
                  }}
                >
                  <defs>
                    <pattern
                      id="workshop-grid"
                      width="10"
                      height="10"
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        d="M10 0H0V10"
                        fill="none"
                        stroke="#dde2e1"
                        strokeWidth="0.15"
                      />
                    </pattern>
                  </defs>
                  <rect
                    width={config.workAreaWidth}
                    height={config.workAreaHeight}
                    fill="white"
                  />
                  <rect
                    width={config.workAreaWidth}
                    height={config.workAreaHeight}
                    fill="url(#workshop-grid)"
                    stroke="#a2aaa6"
                    strokeWidth="0.3"
                  />
                  {travel && (
                    <path
                      d={travelPath}
                      fill="none"
                      stroke="#bd8d53"
                      strokeDasharray="1.2 1.2"
                      strokeWidth="0.3"
                    />
                  )}
                  <path
                    d={path}
                    fill="none"
                    stroke={job.withinWorkArea ? "#226347" : "#b43b32"}
                    strokeWidth="0.35"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  <circle cx="0" cy="0" r="1" fill="#226347" />
                  <text x="2" y="-2" fontSize="3" fill="currentColor">
                    0 · мм
                  </text>
                </svg>
              )}
            </div>
          )}
          <div className="workshop-statistics">
            <span>
              Штрихов: {document.strokes.length.toLocaleString("ru-RU")}
            </span>
            <span>
              {box.width.toFixed(1)} × {box.height.toFixed(1)} мм
            </span>
            <span>
              {document.strokes.length
                ? `≈ ${formatDuration(job.estimatedSeconds)}`
                : "—"}
            </span>
            <label className="workshop-check">
              <input
                type="checkbox"
                checked={travel}
                onChange={(e) => setTravel(e.target.checked)}
              />
              Холостой ход
            </label>
          </div>
          <footer className="workshop-run">
            <div className="plotter-footer-heading">
              <button type="button" aria-expanded={!footerCollapsed} onClick={() => setFooterCollapsed(value => !value)}>{footerCollapsed ? "▸" : "▾"} Управление рисунком</button>
              {footerCollapsed && workspace.running && <button className="button danger" onClick={workspace.stop}>Стоп</button>}
            </div>
            <div className="workshop-run-body" hidden={footerCollapsed}>
            {(error || workspace.error) && (
              <p role="alert" className="plotter-error">
                {error || workspace.error}
              </p>
            )}
            {!job.withinWorkArea && (
              <p className="plotter-error">
                Рисунок выходит за рабочую область. Уменьшите или переместите
                его.
              </p>
            )}
            <div className="workshop-checklist">
              <span
                className={workspace.activeProfile.calibratedAt ? "ready" : ""}
              >
                {workspace.activeProfile.calibratedAt ? "✓" : "○"} Калибровка
              </span>
              <span className={workspace.originConfirmed ? "ready" : ""}>
                {workspace.originConfirmed ? "✓" : "○"} Ноль задан
              </span>
              <label className="workshop-check">
                <input
                  type="checkbox"
                  checked={workspace.armed}
                  disabled={locked}
                  onChange={(e) => workspace.setArmed(e.target.checked)}
                />
                Перо и лист проверены
              </label>
            </div>
            <div className="workshop-run-actions">
              <button
                disabled={!document.strokes.length}
                onClick={() =>
                  void downloadFile(
                    "openhand-workshop.gcode",
                    job.commands.join("\n") + "\n",
                    "text/plain",
                  )
                }
              >
                Экспорт G-code
              </button>
              <button
                disabled={!canRun || config.profile === "ebb"}
                onClick={() =>
                  void attempt(() =>
                    plotter.run(createDryRunCommands(document.strokes, config)),
                  )
                }
              >
                Обвести рамку
              </button>
              <button
                className="primary"
                disabled={!canRun}
                onClick={() =>
                  void attempt(() => {
                    if (canRun) return plotter.run(job);
                  })
                }
              >
                Начать рисунок
              </button>
              {running && (
                <button
                  onClick={
                    plotter.status === "paused"
                      ? workspace.resume
                      : workspace.pause
                  }
                >
                  {plotter.status === "paused" ? "Продолжить" : "Пауза"}
                </button>
              )}
              <button
                className="danger"
                disabled={!connected}
                onClick={() => {
                  workspace.setArmed(false);
                  void workspace.stop();
                }}
              >
                Стоп
              </button>
            </div>
            {running && (
              <progress
                aria-label="Отправлено команд"
                value={plotter.progress.current}
                max={Math.max(1, plotter.progress.total)}
              />
            )}
            {!connected && (
              <small>Подключение и калибровка — во вкладке «Устройство».</small>
            )}
            <details className="workshop-log">
              <summary>Журнал порта</summary>
              <button
                onClick={() =>
                  void downloadFile(
                    "plotter-log.txt",
                    plotter.logs
                      .map((e) => `${e.time} ${e.direction} ${e.message}`)
                      .join("\n"),
                    "text/plain",
                  )
                }
              >
                Сохранить журнал
              </button>
              <pre>
                {plotter.logs
                  .map(
                    (e) =>
                      `${e.time} ${e.direction === "in" ? "←" : "→"} ${e.message}`,
                  )
                  .join("\n") || "Команды ещё не отправлялись."}
              </pre>
            </details>
          </div>
          </footer>
        </main>
      </div>
    </section>
  );
}
