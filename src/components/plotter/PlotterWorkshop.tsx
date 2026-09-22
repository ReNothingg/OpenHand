import { serializePlotterGcode } from "../../gcode/penModel";
import SceneCanvas from "./SceneCanvas";
import PlotterManualStart from "./PlotterManualStart";
import { mapSceneObjects, type SceneTool } from "../../plotter/scene";
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
  serializeWorkshop,
  shape,
  transform,
  validateStrokes,
  type Stroke,
  type SceneObject,
  sceneObject,
} from "../../plotter/workshop";
import { compilePlotJob } from "../../plotter/job";
import { downloadFile } from "../../lib/files";
import { formatNominalDuration, timingExplanation } from "./PlotterFooter";

const STORAGE_KEY = "openhand.workshop.v1";
const EMPTY = { name: "Новый рисунок", strokes: [] as Stroke[], objects: [] as SceneObject[], paperRotated: false };
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
  const stageRef = useRef<HTMLDivElement>(null);
  const dropPoint = useRef<{x:number;y:number}|null>(null);
  const [fitRequest, setFitRequest] = useState(0);
  const imageInput = useRef<HTMLInputElement>(null);
  const [footerCollapsed, setFooterCollapsed] = useState(false);
  const [inspectorCollapsed,setInspectorCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = usePanelWidth("openhand.workshop-width");
  const [document, setDocument] = useState(load);
  const [selected, setSelected] = useState<string[]>(() => document.objects.slice(0,1).map(o=>o.id));
  const [tool, setTool] = useState<SceneTool>("move");
  const [history, setHistory] = useState<(typeof document)[]>([]);
  const [future, setFuture] = useState<(typeof document)[]>([]);
  const [view, setView] = useState("drawing");
  const [error, setError] = useState("");
  const [drag, setDrag] = useState(false);
  const [kind, setKind] = useState("rectangle");
  const [width, setWidth] = useState(60),
    [height, setHeight] = useState(40);
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
  const paperWidth = document.paperRotated ? config.workAreaHeight : config.workAreaWidth;
  const paperHeight = document.paperRotated ? config.workAreaWidth : config.workAreaHeight;
  const withinPaper = box.minX >= 0 && box.minY >= 0 && box.maxX <= paperWidth && box.maxY <= paperHeight;
  const readiness = workspace.assessJob({ strokes: document.strokes, clipped: !withinPaper }, job.withinWorkArea, job.commands);
  const canRun = readiness.canStart;
  const recovery = workspace.assessPreparedRecovery(job);
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
          serializeWorkshop(document.strokes, document.name, document.objects, document.paperRotated),
        );
      } catch {
        setError("Не удалось сохранить черновик. Сохраните проект в файл.");
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [document]);
  useEffect(() => {
  }, [document, job.id]);
  const attempt = async (action: () => unknown) => {
    setError("");
    try {
      await action();
    } catch (e) {
      dropPoint.current = null;
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const commitObjects = (objects: SceneObject[], name = document.name, paperRotated = document.paperRotated) => {
    if (lockedRef.current) return;
    objects=objects.filter(o=>o.strokes.length);
    if(objects.length>1000)throw new Error("Лимит сцены — 1000 объектов.");
    const strokes = validateStrokes(objects.flatMap(o=>o.strokes));
    setHistory(items=>[...items.slice(-29),document]); setFuture([]);
    setDocument({name, objects, strokes, paperRotated});
    setSelected(ids=>ids.filter(id=>objects.some(o=>o.id===id)));
  };
  const addObject = (strokes: Stroke[], name: string) => void attempt(() => {
    if(lockedRef.current)return;
    const target=dropPoint.current;dropPoint.current=null;
    const b=bounds(strokes);
    const placed=target ? transform(strokes,{x:target.x-b.minX,y:target.y-b.minY}) : strokes;
    const object=sceneObject(placed,name);commitObjects([...document.objects,object]);setSelected([object.id]);setView("drawing");
  });
  const edit = (action: (strokes: Stroke[]) => Stroke[]) => void attempt(() => {
    if(!selected.length)throw new Error("Выберите объект на сцене.");
    commitObjects(document.objects.map(o=>selected.includes(o.id)?{...o,strokes:validateStrokes(action(o.strokes))}:o));
  });
  const deleteSelected = () => void attempt(()=>commitObjects(document.objects.filter(o=>!selected.includes(o.id))));
  const duplicateSelected = () => void attempt(()=>{
    const copies = mapSceneObjects(document.objects.filter(o=>selected.includes(o.id)), selected, p=>({x:p.x+10,y:p.y+10})).map(o=>({...o,id:crypto.randomUUID(),name:o.name+" · копия"}));
    if(!copies.length)return;commitObjects([...document.objects,...copies]);setSelected(copies.map(o=>o.id));
  });
  const reorderSelected = (front: boolean) => void attempt(()=>{
    const chosen=document.objects.filter(o=>selected.includes(o.id)), rest=document.objects.filter(o=>!selected.includes(o.id));
    if(chosen.length)commitObjects(front?[...rest,...chosen]:[...chosen,...rest]);
  });
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
        dropPoint.current=null;
        commitObjects(project.objects, project.name, project.paperRotated); setSelected(project.objects.slice(0,1).map(o=>o.id));
      } else if (/\.(hpgl|plt)$/i.test(file.name))
        addObject(alignToOrigin(parseHPGL(text)), file.name);
      else if (/\.(csv|tsv)$/i.test(file.name))
        addObject(parseCoordinateCSV(text), file.name);
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
      {imageFile && <ImageImportDialog file={imageFile} maxWidth={Math.max(1, config.workAreaWidth-20)} maxHeight={Math.max(1, config.workAreaHeight-20)} onClose={()=>{setImageFile(null);dropPoint.current=null;}} onApply={strokes => { addObject(strokes, imageFile.name); setImageFile(null); }} />}
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
                      serializeWorkshop(document.strokes, document.name, document.objects, document.paperRotated),
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
      <div className={`workshop-body ${inspectorCollapsed?"inspector-collapsed":""}`} style={{ "--inspector-width": `min(${panelWidth}px, 65vw)` } as React.CSSProperties}>
        <aside className="workshop-inspector" inert={inspectorCollapsed} aria-hidden={inspectorCollapsed}>
          <button className="button" type="button" disabled={locked}
            onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>
            Настроить плоттер →
          </button>
            <fieldset disabled={locked}>
              <section className="workshop-section">
                <h2>Объекты</h2>
                <div className="scene-object-list" role="listbox" aria-label="Объекты рисунка" aria-multiselectable="true">
                  {document.objects.map(o=><button key={o.id} role="option" aria-selected={selected.includes(o.id)} onClick={e=>setSelected(ids=>e.shiftKey?(ids.includes(o.id)?ids.filter(id=>id!==o.id):[...ids,o.id]):[o.id])}>{o.name}</button>)}
                </div>
                {selected.length===1 && <label className="workshop-field">Название объекта<input value={document.objects.find(o=>o.id===selected[0])?.name || ""} onChange={e=>{const name=e.target.value;setDocument(d=>({...d,objects:d.objects.map(o=>o.id===selected[0]?{...o,name}:o)}));}} /></label>}
                <div className="scene-order-actions">
                  <button disabled={!selected.length} onClick={()=>reorderSelected(true)}>На передний план</button>
                  <button disabled={!selected.length} onClick={()=>reorderSelected(false)}>На задний план</button>
                </div>
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
                    addObject(shape(kind, width, height), kind === "rectangle" ? "Прямоугольник" : kind === "ellipse" ? "Эллипс" : kind === "triangle" ? "Треугольник" : "Линия")
                  }
                >
                  Добавить фигуру
                </button>
                <button
                  disabled={
                    !workspace.activeLayout?.strokes?.length || workspace.busy
                  }
                  onClick={() =>
                    addObject(workspace.activeLayout.strokes, "Из документа")
                  }
                >
                  Взять штрихи из документа
                </button>


              </section>

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

                <button
                  onClick={() =>
                    edit((strokes) => [
                      ...strokes,
                      ...hatch(strokes, spacing, hatchAngle),
                    ])
                  }
                >
                  Добавить штриховку
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
                  onClick={() => void attempt(()=>commitObjects([]))}
                >
                  Очистить рисунок
                </button>
              </section>
            </fieldset>
        </aside>
        {!inspectorCollapsed && <PanelResizeHandle side="left" width={panelWidth} onChange={setPanelWidth} />}
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
                onClick={() => setZoom((z) => Math.min(8, z * 1.25))}
              >
                +
              </button>
            </div>
          </div>
          <div className="scene-toolstrip" role="toolbar" aria-label="Инструменты сцены">
            <button aria-label={inspectorCollapsed?"Показать инспектор":"Свернуть инспектор"} title={inspectorCollapsed?"Показать инспектор":"Свернуть инспектор"} onClick={()=>setInspectorCollapsed(v=>!v)}><Icon name={inspectorCollapsed?"panel-left-expand":"panel-left-collapse"}/></button>
            {view === "drawing" && <>
            {([ ["move","Перемещение","V"], ["rotate","Вращение","E"], ["scale","Масштаб","R"], ["warp","Warp","T"], ["pan","Обзор","H"] ] as const).map(([id,label,key])=>
              <button key={id} aria-label={label} aria-pressed={tool===id} disabled={locked&&id!=="pan"} title={`${label} · ${key}`} onClick={()=>setTool(id)}><Icon name={`scene-${id}`} /></button>)}
            <span className="scene-tool-divider" />
            <button disabled={locked} aria-label="Повернуть лист" title="Повернуть лист на 90°" onClick={()=>void attempt(()=>commitObjects(document.objects,document.name,!document.paperRotated))}><Icon name="paper-rotate" /></button>
            <button onClick={()=>setFitRequest(value=>value+1)} aria-label="Вписать" title="Вписать · F"><Icon name="window-expand" /></button>
            <button disabled={locked||!selected.length} onClick={duplicateSelected} aria-label="Дублировать" title="Дублировать · ⌘/Ctrl D"><Icon name="scene-duplicate" /></button>
            <button disabled={locked||!selected.length} onClick={deleteSelected} aria-label="Удалить" title="Удалить · Delete"><Icon name="scene-delete" /></button>
            </>}
          </div>
          {view === "code" ? (
            <pre className="workshop-code" tabIndex={0}>
              {job.commands.join("\n")}
            </pre>
          ) : (
            <div
              className={`workshop-canvas ${drag ? "dragging" : ""}`}
              ref={stageRef}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                if(locked)return;
                const matrix=stageRef.current?.querySelector("svg")?.getScreenCTM();
                if(matrix){const p=new DOMPoint(e.clientX,e.clientY).matrixTransform(matrix.inverse());dropPoint.current={x:p.x,y:p.y};}
                open(e.dataTransfer.files[0]);
              }}
            >
              <SceneCanvas objects={document.objects} selected={selected} onSelect={setSelected}
                onCommit={objects=>void attempt(()=>commitObjects(objects))} tool={tool} setTool={setTool} locked={locked}
                width={paperWidth} height={paperHeight} fitRequest={fitRequest} zoom={zoom} onZoom={setZoom}
                onUndo={undo} onRedo={redo} onDuplicate={duplicateSelected} onDelete={deleteSelected}
                travelPath={travel?travelPath:undefined} />
            </div>
          )}
          <div className="workshop-statistics">
            <span>Лист: {paperWidth} × {paperHeight} мм</span>
            <span title="Непрерывные проходы с опущенным пером; каждый может состоять из множества отрезков.">
              Проходов пера: {document.strokes.length.toLocaleString("ru-RU")}
            </span>
            <span>
              Рисунок: {box.width.toFixed(1)} × {box.height.toFixed(1)} мм
            </span>
            <span title="Суммарная длина линий с опущенным пером">
              {(job.drawDistance / 1000).toFixed(2)} м пером
            </span>
            <span title={timingExplanation}>
              {document.strokes.length
                ? `Без разгона: ${formatNominalDuration(job.estimatedSeconds)}`
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
            {!withinPaper && <p className="plotter-warning">Рисунок выходит за границы листа.</p>}
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
            {!running && <p className={canRun ? "plotter-note" : "plotter-warning"}>
              {canRun ? "Готово к записи" : readiness.blockers[0]}
            </p>}
            <PlotterManualStart workspace={workspace} workshop />
            {recovery.problem && !running && <p className="plotter-warning">Продолжение рисунка недоступно: {recovery.problem}</p>}
            {recovery.otherSource === "document" && !running && <button className="text-button"
              onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "document" }))}>К прерванной записи документа →</button>}
            {!workspace.placementReadiness.canStart && workspace.penPositionsVerified && !running && <button className="text-button"
              onClick={() => window.dispatchEvent(new CustomEvent("openhand:workspace", { detail: "device" }))}>Открыть настройки плоттера →</button>}
            <div className="workshop-run-actions">
              <button
                disabled={!document.strokes.length}
                onClick={() =>
                  void downloadFile(
                    "openhand-workshop.gcode",
                    serializePlotterGcode(job.commands, config),
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
                    workspace.runPreparedFrame(document.strokes, withinPaper),
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
                    return recovery.available
                      ? workspace.recoverPreparedJob(job, { strokes: document.strokes, clipped: !withinPaper })
                      : workspace.runPreparedJob(job, { strokes: document.strokes, clipped: !withinPaper });
                  })
                }
              >
                {recovery.available ? "Продолжить рисунок" : "Начать рисунок"}
              </button>
              <button disabled={running || workspace.calibrationActive} onClick={workspace.resetProgress}
                title="Сбросить прогресс без движения и изменения нуля">
                Сбросить прогресс
              </button>
              {running && (
                <button
                  onClick={
                    plotter.status === "paused"
                      ? workspace.resume
                      : workspace.pause
                  }
                >
                  {plotter.status === "paused" ? "Продолжить передачу" : "Приостановить"}
                </button>
              )}
              <button
                className="danger"
                disabled={!connected}
                onClick={() => {
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
              <small>Подключение и управление пером — в общей вкладке «Плоттер».</small>
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
