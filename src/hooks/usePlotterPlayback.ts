import { useCallback, useEffect, useMemo, useRef, useState } from "react";

function totalStrokeLength(strokes) {
  return strokes.reduce(
    (total, stroke) =>
      total +
      stroke
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum +
            Math.hypot(point.x - stroke[index].x, point.y - stroke[index].y),
          0,
        ),
    0,
  );
}

export function usePlotterPlayback(job, hardware) {
  const strokes = job?.strokes || [];
  const estimatedSeconds = job?.estimatedSeconds;
  const [progress, setProgress] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState("manual");
  const [speed, setSpeed] = useState(8);
  const frameRef = useRef(0);
  const previousTimeRef = useRef(0);
  const strokesRef = useRef(strokes);
  const totalLength = useMemo(() => totalStrokeLength(strokes), [strokes]);

  useEffect(() => {
    strokesRef.current = strokes;
    setPlaying(false);
    setProgress(1);
    setMode("manual");
  }, [strokes]);

  useEffect(() => {
    const hardwareActive =
      hardware?.status === "running" || hardware?.status === "paused";
    if (!hardwareActive || !hardware.progress?.total) return;
    setMode("hardware");
    setPlaying(false);
    setProgress(
      Math.max(
        0,
        Math.min(1, hardware.progress.current / hardware.progress.total),
      ),
    );
  }, [
    hardware?.status,
    hardware?.progress?.current,
    hardware?.progress?.total,
  ]);

  useEffect(() => {
    if (!playing) {
      cancelAnimationFrame(frameRef.current);
      previousTimeRef.current = 0;
      return undefined;
    }
    const seconds = Math.max(
      3.5,
      Math.min(90, Number(estimatedSeconds) || totalLength / 55 || 8),
    );
    const duration = (seconds * 1000) / Math.max(0.25, speed);
    const animate = (time) => {
      if (!previousTimeRef.current) previousTimeRef.current = time;
      const delta = Math.max(0, time - previousTimeRef.current);
      if (delta < 32) {
        frameRef.current = requestAnimationFrame(animate);
        return;
      }
      previousTimeRef.current = time;
      setProgress((current) => {
        const next = Math.min(1, current + delta / duration);
        if (next >= 1) setPlaying(false);
        return next;
      });
      frameRef.current = requestAnimationFrame(animate);
    };
    frameRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frameRef.current);
      previousTimeRef.current = 0;
    };
  }, [estimatedSeconds, playing, speed, totalLength]);

  const play = useCallback(() => {
    setMode("manual");
    setProgress((current) => (current >= 0.999 ? 0 : current));
    setPlaying(true);
  }, []);
  const pause = useCallback(() => setPlaying(false), []);
  const reset = useCallback(() => {
    setMode("manual");
    setPlaying(false);
    setProgress(0);
  }, []);
  const seek = useCallback((value) => {
    setMode("manual");
    setPlaying(false);
    setProgress(Math.max(0, Math.min(1, Number(value) || 0)));
  }, []);

  const strokeProgress = useMemo(() => {
    if (mode === "hardware" && hardware?.progress?.total) {
      const current = hardware.progress.current;
      return strokes.map((_, index) => {
        const range = job?.strokeCommandRanges?.[index];
        if (!range) return 0;
        if (current <= range.start) return 0;
        if (current >= range.end) return 1;
        return (current - range.start) / Math.max(1, range.end - range.start);
      });
    }
    const target = totalLength * progress;
    let consumed = 0;
    return strokes.map((stroke) => {
      const length = totalStrokeLength([stroke]);
      const value =
        length > 0 ? Math.max(0, Math.min(1, (target - consumed) / length)) : 1;
      consumed += length;
      return value;
    });
  }, [
    hardware?.progress?.current,
    hardware?.progress?.total,
    job?.strokeCommandRanges,
    mode,
    progress,
    strokes,
    totalLength,
  ]);

  return {
    strokes,
    strokeProgress,
    progress,
    playing,
    speed,
    setSpeed,
    play,
    pause,
    reset,
    seek,
    active:
      playing || progress < 0.999 || (mode === "hardware" && progress < 0.999),
    hardware: mode === "hardware",
  };
}
