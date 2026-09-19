import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export function usePreviewInteractions({
  previewRef,
  zoom,
  setZoom,
  viewMode,
  pageSize,
  layoutKey,
  sourceMode,
  active = true,
}) {
  const panRef = useRef(null);
  const zoomRef = useRef(zoom);
  const renderedZoomRef = useRef(zoom);
  const zoomAnchorRef = useRef(null);
  const zoomFrameRef = useRef(0);

  const applyPanPosition = useCallback((pan, clientX, clientY) => {
    const nextLeft = Math.min(
      pan.maxLeft,
      Math.max(0, pan.left - (clientX - pan.x)),
    );
    const nextTop = Math.min(
      pan.maxTop,
      Math.max(0, pan.top - (clientY - pan.y)),
    );
    pan.nextLeft = nextLeft;
    pan.nextTop = nextTop;
    pan.canvas.style.transform = `translate3d(${pan.left - nextLeft}px, ${pan.top - nextTop}px, 0)`;
  }, []);

  useEffect(() => {
    const viewport = previewRef.current as HTMLDivElement | null;
    if (!active || !viewport) return undefined;
    let gestureStartZoom: number | null = null;
    let lastGestureAt = -Infinity;
    let gesturePoint = { x: 0, y: 0 };
    let pointerPoint: { x: number; y: number } | null = null;
    const rememberPointer = (event: PointerEvent) => {
      pointerPoint = { x: event.clientX, y: event.clientY };
    };

    const applyZoomAtPoint = (
      nextZoom: number,
      clientX: number,
      clientY: number,
    ) => {
      if (
        !Number.isFinite(nextZoom) ||
        !Number.isFinite(clientX) ||
        !Number.isFinite(clientY)
      )
        return;
      nextZoom = Math.min(400, Math.max(10, Math.round(nextZoom * 100) / 100));
      if (nextZoom === zoomRef.current) return;
      if (!zoomAnchorRef.current) {
        const pages = Array.from(
          viewport.querySelectorAll<HTMLElement>(".page-shell"),
        );
        const page = pages.reduce<HTMLElement | null>((best, candidate) => {
          const distance = (element: HTMLElement) => {
            const r = element.getBoundingClientRect();
            return Math.hypot(
              Math.max(r.left - clientX, 0, clientX - r.right),
              Math.max(r.top - clientY, 0, clientY - r.bottom),
            );
          };
          return !best || distance(candidate) < distance(best)
            ? candidate
            : best;
        }, null);
        if (page) {
          const rect = page.getBoundingClientRect();
          if (rect.width && rect.height)
            zoomAnchorRef.current = {
              page,
              clientX,
              clientY,
              x: (clientX - rect.left) / rect.width,
              y: (clientY - rect.top) / rect.height,
            };
        }
      }
      zoomRef.current = nextZoom;
      if (!zoomFrameRef.current)
        zoomFrameRef.current = requestAnimationFrame(() => {
          zoomFrameRef.current = 0;
          setZoom(zoomRef.current);
        });
    };
    const zoomWithTrackpad = (event: WheelEvent) => {
      if (!event.deltaY) return;
      event.preventDefault();
      if (panRef.current) return;
      // WebKit can emit both gesture and Ctrl+wheel for the same pinch.
      if (
        gestureStartZoom !== null ||
        ((event.ctrlKey || event.metaKey) &&
          performance.now() - lastGestureAt < 180)
      )
        return;
      const unit =
        event.deltaMode === 1
          ? 16
          : event.deltaMode === 2
            ? viewport.clientHeight
            : 1;
      const delta = Math.max(-120, Math.min(120, event.deltaY * unit));
      const sensitivity = event.ctrlKey || event.metaKey ? 0.01 : 0.0015;
      applyZoomAtPoint(
        zoomRef.current * Math.exp(-delta * sensitivity),
        event.clientX,
        event.clientY,
      );
    };
    const startGestureZoom = (event) => {
      event.preventDefault();
      if (zoomFrameRef.current) {
        cancelAnimationFrame(zoomFrameRef.current);
        zoomFrameRef.current = 0;
        zoomRef.current = renderedZoomRef.current;
        zoomAnchorRef.current = null;
      }
      gestureStartZoom = zoomRef.current;
      lastGestureAt = performance.now();
      const rect = viewport.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      gesturePoint = inside
        ? { x: event.clientX, y: event.clientY }
        : pointerPoint || {
            x: rect.left + rect.width / 2,
            y: rect.top + rect.height / 2,
          };
    };
    const changeGestureZoom = (event) => {
      if (gestureStartZoom === null) return;
      event.preventDefault();
      lastGestureAt = performance.now();
      applyZoomAtPoint(
        gestureStartZoom * event.scale,
        gesturePoint.x,
        gesturePoint.y,
      );
    };
    const endGestureZoom = (event) => {
      if (gestureStartZoom === null) return;
      event.preventDefault();
      gestureStartZoom = null;
      lastGestureAt = performance.now();
    };

    viewport.addEventListener("wheel", zoomWithTrackpad, { passive: false });
    viewport.addEventListener("pointermove", rememberPointer, {
      passive: true,
    });
    viewport.addEventListener("gesturestart", startGestureZoom, {
      passive: false,
    });
    // Keep ownership until the gesture ends, even if the fingers move off the sheet.
    window.addEventListener("gesturechange", changeGestureZoom, {
      passive: false,
    });
    window.addEventListener("gestureend", endGestureZoom, { passive: false });
    return () => {
      viewport.removeEventListener("wheel", zoomWithTrackpad);
      viewport.removeEventListener("pointermove", rememberPointer);
      viewport.removeEventListener("gesturestart", startGestureZoom);
      window.removeEventListener("gesturechange", changeGestureZoom);
      window.removeEventListener("gestureend", endGestureZoom);
      cancelAnimationFrame(zoomFrameRef.current);
      zoomFrameRef.current = 0;
      zoomAnchorRef.current = null;
      const pan = panRef.current;
      if (pan) {
        cancelAnimationFrame(pan.frame);
        pan.canvas.style.transform = "";
        panRef.current = null;
        viewport.classList.remove("is-panning");
      }
    };
  }, [active, previewRef, setZoom]);

  useLayoutEffect(() => {
    const viewport = previewRef.current;
    const anchor = zoomAnchorRef.current;
    renderedZoomRef.current = zoom;
    if (!zoomFrameRef.current) zoomRef.current = zoom;
    if (!active || !viewport || !anchor?.page?.isConnected) return;
    const rect = anchor.page.getBoundingClientRect();
    // Use actual paper geometry: fixed canvas padding and centering do not scale.
    viewport.scrollLeft += rect.left + anchor.x * rect.width - anchor.clientX;
    viewport.scrollTop += rect.top + anchor.y * rect.height - anchor.clientY;
    if (!zoomFrameRef.current) zoomAnchorRef.current = null;
  }, [active, previewRef, zoom]);

  useLayoutEffect(() => {
    const viewport = previewRef.current;
    if (!active || !viewport) return undefined;
    const frame = requestAnimationFrame(() => {
      const firstPage = viewport.querySelector(".page-shell");
      if (!firstPage) return;
      viewport.scrollLeft = Math.max(
        0,
        firstPage.offsetLeft -
          (viewport.clientWidth - firstPage.offsetWidth) / 2,
      );
      const topGap =
        firstPage.offsetHeight < viewport.clientHeight
          ? Math.min(100, (viewport.clientHeight - firstPage.offsetHeight) / 2)
          : 40;
      viewport.scrollTop = Math.max(0, firstPage.offsetTop - topGap);
    });
    return () => cancelAnimationFrame(frame);
  }, [active, previewRef, viewMode, pageSize, layoutKey, sourceMode]);

  const beginPan = useCallback(
    (event) => {
      if (event.button !== 0) return;
      if (
        event.target.closest(
          "a, button, input, textarea, select, label, summary",
        )
      )
        return;
      const viewport = previewRef.current;
      const canvas = viewport?.querySelector(".pages-canvas");
      if (!viewport || !canvas) return;
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        nextLeft: viewport.scrollLeft,
        nextTop: viewport.scrollTop,
        maxLeft: Math.max(0, viewport.scrollWidth - viewport.clientWidth),
        maxTop: Math.max(0, viewport.scrollHeight - viewport.clientHeight),
        clientX: event.clientX,
        clientY: event.clientY,
        frame: 0,
        canvas,
      };
      canvas.style.transform = "translate3d(0, 0, 0)";
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
    },
    [previewRef],
  );

  const movePan = useCallback(
    (event) => {
      const pan = panRef.current;
      if (!pan) return;
      pan.clientX = event.clientX;
      pan.clientY = event.clientY;
      if (pan.frame) return;
      pan.frame = requestAnimationFrame(() => {
        pan.frame = 0;
        if (panRef.current === pan) {
          applyPanPosition(pan, pan.clientX, pan.clientY);
        }
      });
    },
    [applyPanPosition],
  );

  const endPan = useCallback(
    (event) => {
      const viewport = previewRef.current;
      const pan = panRef.current;
      if (!pan) return;
      if (pan.frame) cancelAnimationFrame(pan.frame);
      applyPanPosition(pan, event.clientX, event.clientY);
      viewport.scrollLeft = pan.nextLeft;
      viewport.scrollTop = pan.nextTop;
      pan.canvas.style.transform = "";
      panRef.current = null;
      if (viewport?.hasPointerCapture(event.pointerId))
        viewport.releasePointerCapture(event.pointerId);
      viewport?.classList.remove("is-panning");
    },
    [applyPanPosition, previewRef],
  );

  return { beginPan, movePan, endPan };
}
