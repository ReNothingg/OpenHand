import { useCallback, useEffect, useLayoutEffect, useRef } from "react";

export function usePreviewInteractions({
  previewRef,
  zoom,
  setZoom,
  viewMode,
  pageSize,
  previewOnly,
  sourceMode,
}) {
  const panRef = useRef(null);
  const zoomRef = useRef(zoom);
  const zoomAnchorRef = useRef(null);
  zoomRef.current = zoom;

  useEffect(() => {
    const viewport = previewRef.current;
    if (!viewport) return undefined;
    let gestureStartZoom = null;

    const applyZoomAtPoint = (nextZoom, clientX, clientY) => {
      const currentZoom = zoomRef.current;
      if (!Number.isFinite(nextZoom)) return;
      nextZoom = Math.min(400, Math.max(10, Math.round(nextZoom)));
      if (nextZoom === currentZoom) return;
      const bounds = viewport.getBoundingClientRect();
      zoomAnchorRef.current = {
        zoom: currentZoom,
        x: clientX - bounds.left,
        y: clientY - bounds.top,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      zoomRef.current = nextZoom;
      setZoom(nextZoom);
    };
    const zoomWithTrackpad = (event) => {
      event.preventDefault();
      const currentZoom = zoomRef.current;
      const direction = event.deltaY > 0 ? -1 : 1;
      const sensitivity = event.ctrlKey || event.metaKey ? 0.012 : 0.0015;
      let nextZoom = Math.round(currentZoom * Math.exp(-event.deltaY * sensitivity));
      if (nextZoom === currentZoom) nextZoom += direction;
      applyZoomAtPoint(nextZoom, event.clientX, event.clientY);
    };
    const startGestureZoom = (event) => {
      event.preventDefault();
      gestureStartZoom = zoomRef.current;
    };
    const changeGestureZoom = (event) => {
      if (gestureStartZoom == null) return;
      event.preventDefault();
      applyZoomAtPoint(
        gestureStartZoom * event.scale,
        event.clientX,
        event.clientY,
      );
    };
    const endGestureZoom = () => {
      gestureStartZoom = null;
    };

    viewport.addEventListener("wheel", zoomWithTrackpad, { passive: false });
    viewport.addEventListener("gesturestart", startGestureZoom, {
      passive: false,
    });
    viewport.addEventListener("gesturechange", changeGestureZoom, {
      passive: false,
    });
    viewport.addEventListener("gestureend", endGestureZoom);
    return () => {
      viewport.removeEventListener("wheel", zoomWithTrackpad);
      viewport.removeEventListener("gesturestart", startGestureZoom);
      viewport.removeEventListener("gesturechange", changeGestureZoom);
      viewport.removeEventListener("gestureend", endGestureZoom);
    };
  });

  useLayoutEffect(() => {
    const viewport = previewRef.current;
    const anchor = zoomAnchorRef.current;
    if (!viewport || !anchor) return;
    const ratio = zoom / anchor.zoom;
    viewport.scrollLeft = (anchor.left + anchor.x) * ratio - anchor.x;
    viewport.scrollTop = (anchor.top + anchor.y) * ratio - anchor.y;
    zoomAnchorRef.current = null;
  }, [previewRef, zoom]);

  useLayoutEffect(() => {
    const viewport = previewRef.current;
    if (!viewport) return undefined;
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
  }, [previewRef, viewMode, pageSize, previewOnly, sourceMode]);

  const beginPan = useCallback(
    (event) => {
      if (event.button !== 0) return;
      const viewport = previewRef.current;
      panRef.current = {
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
      };
      viewport.setPointerCapture(event.pointerId);
      viewport.classList.add("is-panning");
    },
    [previewRef],
  );

  const movePan = useCallback(
    (event) => {
      if (!panRef.current) return;
      const viewport = previewRef.current;
      viewport.scrollLeft =
        panRef.current.left - (event.clientX - panRef.current.x);
      viewport.scrollTop =
        panRef.current.top - (event.clientY - panRef.current.y);
    },
    [previewRef],
  );

  const endPan = useCallback(
    (event) => {
      const viewport = previewRef.current;
      panRef.current = null;
      if (viewport?.hasPointerCapture(event.pointerId))
        viewport.releasePointerCapture(event.pointerId);
      viewport?.classList.remove("is-panning");
    },
    [previewRef],
  );

  return { beginPan, movePan, endPan };
}
