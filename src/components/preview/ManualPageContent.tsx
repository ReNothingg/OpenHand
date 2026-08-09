import { useLayoutEffect, useRef } from "react";
import { normalizeBlockLayout } from "../../lib/manualLayout";

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function findPageAtPoint(
  clientX: number,
  clientY: number,
): HTMLElement | undefined {
  const pages = [
    ...document.querySelectorAll<HTMLElement>(
      ".manual-page-content[data-page-index]",
    ),
  ];
  const geometricTarget = pages.find((page) => {
    const bounds = (page.closest(".paper") || page).getBoundingClientRect();
    return (
      clientX >= bounds.left &&
      clientX <= bounds.right &&
      clientY >= bounds.top &&
      clientY <= bounds.bottom
    );
  });
  if (geometricTarget) return geometricTarget;
  return document
    .elementsFromPoint(clientX, clientY)
    .find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement &&
        element.matches(".manual-page-content[data-page-index]"),
    );
}

export default function ManualPageContent({
  blocks,
  pageIndex,
  contentStyle,
  editing,
  selected,
  zoom,
  onSelect,
  onUpdate,
  onCommit,
  onMeasure,
}: any) {
  const hostRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!editing || !hostRef.current) return;
    const measurements = {};
    hostRef.current
      .querySelectorAll<HTMLElement>("[data-manual-block]")
      .forEach((element) => {
        const id = element.dataset.manualBlock;
        const block = blocks.find((item) => item.id === id);
        if (block?.layout) return;
        measurements[id] = {
          originPage: block?.originPage ?? pageIndex,
          x: element.offsetLeft,
          y: element.offsetTop,
          width: element.offsetWidth,
          height: element.offsetHeight,
        };
      });
    if (Object.keys(measurements).length) onMeasure(pageIndex, measurements);
  }, [blocks, editing, onMeasure, pageIndex]);

  const beginInteraction = (event, block, mode) => {
    if (!editing) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect({ pageIndex, block });
    const originPage = block.originPage ?? pageIndex;
    const current = normalizeBlockLayout(block.layout, { pageIndex });
    const blockBounds = event.currentTarget.getBoundingClientRect();
    const scale = Math.max(0.1, zoom / 100);
    const start = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      blockX: current.x,
      blockY: current.y,
      width: current.width,
      height: current.height,
      grabX: (event.clientX - blockBounds.left) / scale,
      grabY: (event.clientY - blockBounds.top) / scale,
    };
    let latestLayout = current;
    const move = (moveEvent) => {
      const dx = (moveEvent.clientX - start.pointerX) / scale;
      const dy = (moveEvent.clientY - start.pointerY) / scale;
      if (mode === "move") {
        const patch = {
          x: clamp(
            start.blockX + dx,
            -start.width + 20,
            contentStyle.width - 20,
          ),
          y: clamp(
            start.blockY + dy,
            -start.height + 20,
            contentStyle.height - 20,
          ),
        };
        latestLayout = { ...latestLayout, ...patch };
        onUpdate(originPage, block.id, patch);
        const viewport = hostRef.current?.closest(".pages-viewport");
        if (viewport) {
          const bounds = viewport.getBoundingClientRect();
          const edge = 54;
          if (moveEvent.clientY < bounds.top + edge) viewport.scrollTop -= 18;
          else if (moveEvent.clientY > bounds.bottom - edge)
            viewport.scrollTop += 18;
          if (moveEvent.clientX < bounds.left + edge) viewport.scrollLeft -= 18;
          else if (moveEvent.clientX > bounds.right - edge)
            viewport.scrollLeft += 18;
        }
        document
          .querySelectorAll<HTMLElement>(".manual-page-content.is-drop-target")
          .forEach((element) => element.classList.remove("is-drop-target"));
        const target = findPageAtPoint(moveEvent.clientX, moveEvent.clientY);
        if (target && Number(target.dataset.pageIndex) !== pageIndex)
          target.classList.add("is-drop-target");
      } else {
        const patch = {
          width: clamp(start.width + dx, 36, contentStyle.width * 1.5),
          height: clamp(start.height + dy, 24, contentStyle.height * 1.5),
        };
        latestLayout = { ...latestLayout, ...patch };
        onUpdate(originPage, block.id, patch);
      }
    };
    const end = (endEvent) => {
      document
        .querySelectorAll<HTMLElement>(".manual-page-content.is-drop-target")
        .forEach((element) => element.classList.remove("is-drop-target"));
      if (mode === "move") {
        const target = findPageAtPoint(endEvent.clientX, endEvent.clientY);
        if (target) {
          const targetPage = Number(target.dataset.pageIndex);
          if (Number.isFinite(targetPage) && targetPage !== pageIndex) {
            const bounds = target.getBoundingClientRect();
            const patch = {
              pageIndex: targetPage,
              x: clamp(
                (endEvent.clientX - bounds.left) / scale - start.grabX,
                -start.width + 20,
                contentStyle.width - 20,
              ),
              y: clamp(
                (endEvent.clientY - bounds.top) / scale - start.grabY,
                -start.height + 20,
                contentStyle.height - 20,
              ),
            };
            latestLayout = { ...latestLayout, ...patch };
            onUpdate(originPage, block.id, patch);
            onSelect({
              pageIndex: targetPage,
              block: {
                ...block,
                layout: { ...current, pageIndex: targetPage },
              },
            });
          }
        }
      }
      onCommit(originPage, block.id, latestLayout);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div
      ref={hostRef}
      className={`page-content markdown-body manual-page-content ${editing ? "is-editing" : ""}`}
      data-page-index={pageIndex}
      data-page-label={`Лист ${pageIndex + 1}`}
      style={contentStyle}
    >
      {blocks.map((block) => {
        const layout = block.layout;
        const positioned = Boolean(layout);
        const active =
          selected?.pageIndex === pageIndex && selected?.block?.id === block.id;
        const normalized = normalizeBlockLayout(layout);
        return (
          <div
            className={`manual-block ${positioned ? "is-positioned" : ""} ${active ? "is-selected" : ""}`}
            data-manual-block={block.id}
            data-block-kind={block.kind}
            key={block.id}
            style={
              positioned
                ? {
                    left: normalized.x,
                    top: normalized.y,
                    width: normalized.width,
                    height: normalized.height,
                    transform: `rotate(${normalized.rotation}deg)`,
                    textAlign: normalized.align,
                    whiteSpace: normalized.noWrap ? "nowrap" : undefined,
                  }
                : undefined
            }
            onPointerDown={(event) => beginInteraction(event, block, "move")}
          >
            <div
              className="manual-block-body"
              dangerouslySetInnerHTML={{ __html: block.html }}
            />
            {editing && (
              <span className="manual-block-kind" aria-hidden="true">
                {block.kind === "formula"
                  ? "ƒ"
                  : block.kind === "svg"
                    ? "◇"
                    : "T"}
              </span>
            )}
            {editing && (
              <button
                className="manual-resize-handle"
                type="button"
                aria-label={`Изменить размер: ${block.label}`}
                onPointerDown={(event) =>
                  beginInteraction(event, block, "resize")
                }
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
