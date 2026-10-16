import { formatNominalDuration, timingExplanation } from "../plotter/PlotterFooter";
import PlotterPaper from "../plotter/PlotterPaper";
import { useEffect, useMemo, useRef, useState } from "react";
import WritingStartLine from "../plotter/WritingStartLine";
import { writingStartY } from "../../plotter/writingStart";
import Icon from "../Icon";
import BlockInspector from "./BlockInspector";
import ManualPageContent from "./ManualPageContent";
import { plural } from "../../lib/plural";

const ZOOM_STEPS = [10, 25, 33, 50, 67, 75, 90, 100, 125, 150, 200, 300, 400];

function stepZoom(zoom: number, direction: 1 | -1) {
  const next = direction > 0
    ? ZOOM_STEPS.find((step) => step > zoom + 0.5)
    : [...ZOOM_STEPS].reverse().find((step) => step < zoom - 0.5);
  return next ?? zoom;
}

export default function PreviewPanel({
  pages,
  manualPages,
  manualEditing,
  setManualEditing,
  onUpdateManualBlock,
  onCommitManualBlock,
  onMeasureManualBlocks,
  onResetManualBlock,
  settings,
  metrics,
  viewMode,
  setViewMode,
  editorCollapsed,
  setEditorCollapsed,
  rightPanelOpen,
  toggleRightPanel,
  setZoom,
  reshuffle,
  previewRef,
  measureRef,
  panHandlers,
  plotterWorkspace,
  activeSheetIndex,
  onActiveSheetChange,
  onWritingStartChange,
}: any) {
  const [selectedBlock, setSelectedBlock] = useState(null);
  const activeSheetFrameRef = useRef(0);
  const isNotebookSpread = settings.pageSize === "NotebookSpread";
  const plotterMode = plotterWorkspace.enabled;
  const displayedPages = useMemo(
    () =>
      plotterMode
        ? Array.from(
            { length: Math.max(1, plotterWorkspace.layouts.length) },
            () => [],
          )
        : isNotebookSpread
          ? Array.from({ length: Math.ceil(pages.length / 2) }, (_, index) =>
              pages.slice(index * 2, index * 2 + 2),
            )
          : pages.map((page) => [page]),
    [isNotebookSpread, pages, plotterMode, plotterWorkspace.layouts.length],
  );
  const startPage = settings.writingStartEnabled ? settings.writingStartPage : 0;
  const navigatedStart = useRef(startPage);
  useEffect(() => {
    if (navigatedStart.current === startPage || (plotterMode && plotterWorkspace.busy)) return;
    const frame = requestAnimationFrame(() => {
      const viewport = previewRef.current;
      const physical = isNotebookSpread ? Math.floor(startPage / 2) : startPage;
      const shell = viewport?.querySelector(`[data-sheet-index="${physical}"]`) as HTMLElement | null;
      if (!shell) return;
      const y = writingStartY(settings, metrics.height, startPage) * settings.zoom / 100;
      viewport.scrollTo({ top: Math.max(0, shell.offsetTop + y - 80),
        left: Math.max(0, shell.offsetLeft + (isNotebookSpread && startPage % 2 ? shell.offsetWidth / 2 : 0) - 40) });
      onActiveSheetChange(physical);
      navigatedStart.current = startPage;
    });
    return () => cancelAnimationFrame(frame);
  }, [startPage, plotterMode, plotterWorkspace.busy, displayedPages.length, isNotebookSpread]);
  useEffect(() => {
    if (!manualEditing) setSelectedBlock(null);
  }, [manualEditing]);
  useEffect(() => {
    if (!selectedBlock) return;
    for (let pageIndex = 0; pageIndex < manualPages.length; pageIndex += 1) {
      const block = manualPages[pageIndex]?.find(
        (item) => item.id === selectedBlock.block.id,
      );
      if (
        block &&
        (pageIndex !== selectedBlock.pageIndex ||
          block.layout !== selectedBlock.block.layout)
      ) {
        setSelectedBlock({ pageIndex, block });
        return;
      }
    }
  }, [manualPages, selectedBlock]);
  useEffect(() => () => cancelAnimationFrame(activeSheetFrameRef.current), []);
  const sheetCount = displayedPages.length;
  const goToSheet = (index: number) => {
    const target = Math.max(0, Math.min(sheetCount - 1, index));
    const shell = previewRef.current?.querySelector(`[data-sheet-index="${target}"]`) as HTMLElement | null;
    shell?.scrollIntoView({ behavior: "smooth", block: "start", inline: "center" });
    onActiveSheetChange(target);
  };

  const detectActiveSheet = (event: React.UIEvent<HTMLElement>) => {
    const viewport = event.currentTarget;
    if (activeSheetFrameRef.current) return;
    activeSheetFrameRef.current = requestAnimationFrame(() => {
      activeSheetFrameRef.current = 0;
      const centerX = viewport.scrollLeft + viewport.clientWidth / 2;
      const centerY = viewport.scrollTop + viewport.clientHeight / 2;
      const shells: HTMLElement[] = Array.from(
        viewport.querySelectorAll<HTMLElement>(".page-shell"),
      );
      if (!shells.length) return;
      const closest = shells.reduce(
        (best, shell, index) => {
          const distance = Math.hypot(
            shell.offsetLeft + shell.offsetWidth / 2 - centerX,
            shell.offsetTop + shell.offsetHeight / 2 - centerY,
          );
          return distance < best.distance ? { index, distance } : best;
        },
        { index: 0, distance: Infinity },
      );
      if (closest.index !== activeSheetIndex)
        onActiveSheetChange(closest.index);
    });
  };

  return (
    <main className="preview-panel">
      <div className="oh-toolbar preview-toolbar" role="toolbar" aria-label="Управление листами">
        <button
          className="oh-icon-button"
          type="button"
          aria-label={editorCollapsed ? "Показать редактор" : "Скрыть редактор"}
          title={editorCollapsed ? "Показать редактор" : "Скрыть редактор"}
          aria-pressed={!editorCollapsed}
          onClick={() => setEditorCollapsed((value) => !value)}
        >
          <Icon name={editorCollapsed ? "panel-left-expand" : "panel-left-collapse"} />
        </button>
        <div className="oh-pager">
          <button
            className="oh-icon-button"
            type="button"
            aria-label="Предыдущий лист"
            disabled={activeSheetIndex <= 0}
            onClick={() => goToSheet(activeSheetIndex - 1)}
          >
            <Icon name="chevron-left" />
          </button>
          <span className="oh-pager-label">
            Лист {Math.min(activeSheetIndex + 1, sheetCount)} из {sheetCount}
          </span>
          <button
            className="oh-icon-button"
            type="button"
            aria-label="Следующий лист"
            disabled={activeSheetIndex >= sheetCount - 1}
            onClick={() => goToSheet(activeSheetIndex + 1)}
          >
            <Icon name="chevron-right" />
          </button>
        </div>
        <div className="oh-segmented" role="group" aria-label="Раскладка страниц">
          <button type="button" aria-pressed={viewMode === "single"} onClick={() => setViewMode("single")}>
            1 лист
          </button>
          <button type="button" aria-pressed={viewMode === "spread"} onClick={() => setViewMode("spread")}>
            2 листа
          </button>
        </div>
        <span className="oh-spacer" />
        <button
          className="oh-button is-quiet"
          disabled={plotterWorkspace.running}
          type="button"
          aria-pressed={manualEditing}
          aria-label={manualEditing ? "Готово" : "Расставить блоки на листе"}
          title={manualEditing ? "Закончить расстановку" : "Расставить блоки на листе"}
          onClick={() => setManualEditing((value) => !value)}
        >
          <Icon name="move" />
          <span className="oh-collapsible-label">{manualEditing ? "Готово" : "Расставить"}</span>
        </button>
        {!plotterWorkspace.running && (
          <button className="oh-button is-quiet" type="button" onClick={reshuffle} aria-label="Перемешать" title="Новое зерно случайности: текст останется прежним">
            <Icon name="shuffle" />
            <span className="oh-collapsible-label">Перемешать</span>
          </button>
        )}
        <span className="oh-divider" aria-hidden="true" />
        <div className="oh-zoom">
          <button className="oh-icon-button" type="button" aria-label="Уменьшить" disabled={settings.zoom <= ZOOM_STEPS[0]} onClick={() => setZoom(stepZoom(settings.zoom, -1))}>
            <Icon name="minus" />
          </button>
          <button className="oh-zoom-value" type="button" title="Масштаб 100%" onClick={() => setZoom(100)}>
            {Math.round(settings.zoom)}%
          </button>
          <button className="oh-icon-button" type="button" aria-label="Увеличить" disabled={settings.zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]} onClick={() => setZoom(stepZoom(settings.zoom, 1))}>
            <Icon name="plus" />
          </button>
        </div>
        <button
          className="oh-icon-button"
          type="button"
          aria-label={rightPanelOpen ? "Скрыть правую панель" : "Показать настройки"}
          title={rightPanelOpen ? "Скрыть правую панель" : "Показать настройки"}
          aria-pressed={rightPanelOpen}
          onClick={toggleRightPanel}
        >
          <Icon name={rightPanelOpen ? "panel-right-collapse" : "panel-right-expand"} />
        </button>
      </div>
      {manualEditing && (
        <BlockInspector
          selected={selectedBlock}
          onUpdate={onUpdateManualBlock}
          onCommit={onCommitManualBlock}
          onReset={(originPage, blockId) => {
            onResetManualBlock(originPage, blockId);
            setSelectedBlock(null);
          }}
        />
      )}
      <div
        className="pages-viewport"
        ref={previewRef}
        {...panHandlers}
        onScroll={detectActiveSheet}
      >
        <div className={`pages-canvas ${viewMode}`}>
          {displayedPages.map((spreadPages, index) => {
            const left = isNotebookSpread
              ? settings.marginLeft
              : index % 2 === 1
                ? settings.marginLeftEven
                : settings.marginLeft;
            const firstPageIndex = isNotebookSpread ? index * 2 : index;
            return (
              <div
                className="page-shell"
                data-page-index={firstPageIndex}
                data-sheet-index={index}
                key={`${index}-${settings.seed}`}
                style={{
                  width: (metrics.width * settings.zoom) / 100,
                  height: (metrics.height * settings.zoom) / 100,
                }}
              >
                <article
                  className={`paper ${plotterMode && !manualEditing ? "trajectory-paper" : ""} ${manualEditing ? "manual-editing" : ""} ${settings.ruledPaper || settings.pageSize.startsWith("Notebook") ? "ruled" : ""} ${settings.pageSize.startsWith("Notebook") ? "notebook-paper" : ""} ${settings.pageSize === "NotebookSpread" ? "notebook-spread" : ""} ${settings.pageSize === "Notebook" ? (index % 2 === 0 ? "notebook-right-page" : "notebook-left-page") : ""}`}
                  style={{
                    width: metrics.width,
                    height: metrics.height,
                    transform: `scale(${settings.zoom / 100})`,
                    backgroundColor: settings.pageColor,
                    color: settings.inkColor,
                    fontFamily: `'${settings.fontFamily}'`,
                    "--document-font": JSON.stringify(settings.fontFamily),
                    fontSize: settings.fontSize,
                    lineHeight: settings.lineHeight,
                    "--rule-size": `${settings.fontSize * settings.lineHeight}px`,
                  }}
                >
                  {settings.paperTexture && (!plotterMode || manualEditing) && <div className="paper-grain" aria-hidden="true" />}
                  {plotterMode && !manualEditing ? (
                    <>
                      <PlotterPaper
                        layout={plotterWorkspace.layouts[index]}
                        settings={settings}
                        metrics={metrics}
                        pageIndex={index}
                        playback={
                          index === plotterWorkspace.activeIndex
                            ? plotterWorkspace.playback
                            : null
                        }
                      />
                      {plotterWorkspace.busy && (
                        <div className="integrated-plotter-loading">
                          Строю траекторию…
                        </div>
                      )}
                    </>
                  ) : (
                    <>
                      <ManualPageContent
                        blocks={manualPages[firstPageIndex] || []}
                        pageIndex={firstPageIndex}
                        editing={manualEditing}
                        selected={selectedBlock}
                        zoom={settings.zoom}
                        onSelect={setSelectedBlock}
                        onUpdate={onUpdateManualBlock}
                        onCommit={onCommitManualBlock}
                        onMeasure={onMeasureManualBlocks}
                        contentStyle={{
                          top: writingStartY(settings, metrics.height, firstPageIndex),
                          left,
                          width: metrics.contentWidth,
                          height: Math.max(
                            20,
                            metrics.height -
                              writingStartY(settings, metrics.height, firstPageIndex) -
                              settings.marginBottom,
                          ),
                          transform: `rotate(${settings.textRotation}deg)`,
                        }}
                      />
                      {isNotebookSpread && (
                        <ManualPageContent
                          blocks={manualPages[firstPageIndex + 1] || []}
                          pageIndex={firstPageIndex + 1}
                          editing={manualEditing}
                          selected={selectedBlock}
                          zoom={settings.zoom}
                          onSelect={setSelectedBlock}
                          onUpdate={onUpdateManualBlock}
                          onCommit={onCommitManualBlock}
                          onMeasure={onMeasureManualBlocks}
                          contentStyle={{
                            top: writingStartY(settings, metrics.height, firstPageIndex + 1),
                            left: metrics.width / 2 + settings.marginLeftEven,
                            width: metrics.contentWidth,
                            height: Math.max(
                              20,
                              metrics.height -
                                writingStartY(settings, metrics.height, firstPageIndex + 1) -
                                settings.marginBottom,
                            ),
                            transform: `rotate(${settings.textRotation}deg)`,
                          }}
                        />
                      )}
                    </>
                  )}
                </article>
                  {!manualEditing && Math.floor((settings.writingStartEnabled ? settings.writingStartPage : 0) / (isNotebookSpread ? 2 : 1)) === index && (
                    <WritingStartLine
                      settings={settings}
                      metrics={metrics}
                      sheet={settings.writingStartEnabled ? settings.writingStartPage : 0}
                      disabled={
                        plotterWorkspace.running ||
                        (plotterMode && plotterWorkspace.busy)
                      }
                      onChange={onWritingStartChange}
                    />
                  )}
              </div>
            );
          })}
        </div>
      </div>
      {plotterMode && (
        <footer className="oh-statusbar" aria-label="Статистика задания плоттера">
          <strong>Задание для пера</strong>
          <span title="Непрерывные проходы пера, а не число отдельных отрезков">
            {plural(plotterWorkspace.activeLayout.strokes.length, "проход", "прохода", "проходов")}
          </span>
          <span title="Количество команд">
            {plural(plotterWorkspace.job.commands.length, "команда", "команды", "команд")}
          </span>
          <span title="Длина линий пером">
            {(plotterWorkspace.job.drawDistance / 1000).toLocaleString("ru-RU", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} м пером
          </span>
          <span title={timingExplanation}>
            {formatNominalDuration(plotterWorkspace.job.estimatedSeconds)}
          </span>
        </footer>
      )}
      <div className="measure-host" ref={measureRef} aria-hidden="true" />
    </main>
  );
}
