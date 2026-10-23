import { memo, useMemo } from "react";
import { inkCorePath, inkRibbonPath, penWidthMm } from "../../handwriting/inkAppearance";

function svgPath(strokes) {
  return strokes
    .map((stroke) =>
      stroke
        .map(
          (point, index) =>
            `${index ? "L" : "M"}${point.x.toFixed(2)} ${point.y.toFixed(2)}`,
        )
        .join(""),
    )
    .join("");
}

function pointOnStroke(stroke, progress) {
  const segments = [];
  let total = 0;
  for (let index = 1; index < stroke.length; index += 1) {
    const length = Math.hypot(
      stroke[index].x - stroke[index - 1].x,
      stroke[index].y - stroke[index - 1].y,
    );
    if (length > 0) {
      total += length;
      segments.push({
        start: stroke[index - 1],
        end: stroke[index],
        length,
        endDistance: total,
      });
    }
  }
  if (!segments.length) return null;
  const target = total * Math.max(0, Math.min(1, progress));
  let low = 0;
  let high = segments.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (segments[middle].endDistance < target) low = middle + 1;
    else high = middle;
  }
  const segment = segments[low];
  const startDistance = segment.endDistance - segment.length;
  const ratio = Math.max(
    0,
    Math.min(1, (target - startDistance) / segment.length),
  );
  return {
    x: segment.start.x + (segment.end.x - segment.start.x) * ratio,
    y: segment.start.y + (segment.end.y - segment.start.y) * ratio,
  };
}

const ribbonCache = new WeakMap<object, Map<string, string>>();
const coreCache = new WeakMap<object, string>();

function cachedRibbon(stroke, width, variation, seed) {
  const key = `${width}|${variation}|${seed}`;
  let byKey = ribbonCache.get(stroke);
  if (!byKey) ribbonCache.set(stroke, byKey = new Map());
  let path = byKey.get(key);
  if (path === undefined) byKey.set(key, path = inkRibbonPath(stroke, width, variation, seed));
  return path;
}

function cachedCore(stroke) {
  let path = coreCache.get(stroke);
  if (path === undefined) coreCache.set(stroke, path = inkCorePath(stroke));
  return path;
}

const InkStroke = memo(function InkStroke({ stroke, inkPath, inkCore, completed, active, inkWidthMm, inkColor, coreOpacity }: any) {
  const pressure = stroke.pressure || 1;
  const path = active || (completed > 0 && !(completed >= 1 && inkPath)) ? svgPath([stroke]) : "";
  return (
    <g>
      {active && (
        <path
          className="plotter-strokes playback-pending"
          d={path}
          style={{
            stroke: "#64748b",
            strokeWidth: inkWidthMm * pressure,
            opacity: 0.22,
          }}
        />
      )}
      {completed >= 1 && inkPath ? (<>
        <path d={inkPath} fill={inkColor} opacity={Math.min(1, (inkCore ? .8 : .88) + pressure * .1)} />
        {inkCore && <path d={inkCore} fill="none" stroke={inkColor} strokeWidth={inkWidthMm * .42}
          strokeLinecap="round" strokeLinejoin="round" strokeOpacity={coreOpacity} />}
      </>) : completed > 0 && (
        <path
          className="plotter-playback-stroke"
          d={path}
          pathLength="1000"
          style={{
            stroke: inkColor,
            strokeWidth: inkWidthMm * pressure,
            strokeDasharray: 1000,
            strokeDashoffset: 1000 * (1 - completed),
            opacity: Math.min(1, 0.72 + pressure * 0.25),
          }}
        />
      )}
    </g>
  );
});

function PlotterPaper({ layout, settings, metrics, pageIndex, playback, startPoint = null }) {
  const inkWidthMm = penWidthMm(settings);
  const orderedStrokes = playback?.strokes?.length
    ? playback.strokes
    : layout?.strokes || [];
  const inkPaths = useMemo(() => orderedStrokes.map((stroke, index) => settings.trueHandwriting
    ? cachedRibbon(stroke, inkWidthMm, settings.inkVariation, settings.seed + index)
    : ""), [orderedStrokes, inkWidthMm, settings.trueHandwriting, settings.inkVariation, settings.seed]);
  const inkCores = useMemo(() => orderedStrokes.map(stroke => settings.trueHandwriting && settings.inkVariation > 0
    ? cachedCore(stroke) : ""), [orderedStrokes, settings.trueHandwriting, settings.inkVariation]);
  const coreOpacity = Math.min(0.5, Number(settings.inkVariation) / 50 * 0.75);
  const playbackHead = useMemo(() => {
    if (!playback?.active) return null;
    for (let index = orderedStrokes.length - 1; index >= 0; index -= 1) {
      const progress = playback.strokeProgress?.[index] || 0;
      if (progress > 0) return pointOnStroke(orderedStrokes[index], progress);
    }
    return null;
  }, [orderedStrokes, playback?.active, playback?.strokeProgress]);
  const pageWidth = layout?.page?.pageWidth || (metrics.width * 25.4) / 96;
  const pageHeight = layout?.page?.pageHeight || (metrics.height * 25.4) / 96;
  const ruleSpacing = Math.max(1, (Number(settings.fontSize) || 32) * (Number(settings.lineHeight) || 1.18) * 25.4 / 96);

  return (
    <svg
      className="integrated-plotter-paper"
      viewBox={`0 0 ${pageWidth} ${pageHeight}`}
      preserveAspectRatio="none"
      shapeRendering="geometricPrecision"
      role="img"
      aria-label={`Траектория листа ${pageIndex + 1}`}
    >
      <defs>
        <pattern id={`paper-grain-${pageIndex}`} width="24" height="24" patternUnits="userSpaceOnUse">
          <image href={`${import.meta.env.BASE_URL}textures/paper-grain.svg`} width="24" height="24" />
        </pattern>
        <pattern id={`paper-lines-${pageIndex}`} width={pageWidth} height={ruleSpacing}
          patternTransform={`translate(0 ${((Number(settings.marginTop) || 0) + (Number(settings.fontSize) || 32)) * 25.4 / 96})`}
          patternUnits="userSpaceOnUse">
          <path d={`M0 0H${pageWidth}`} className="plotter-rule-line" />
        </pattern>
        <pattern
          id={`plotter-rules-${pageIndex}`}
          width="5"
          height="5"
          patternUnits="userSpaceOnUse"
        >
          <path d="M 5 0 L 5 5 L 0 5" className="plotter-rule-line" />
        </pattern>
      </defs>
      <rect
        className="plotter-paper-background"
        x="0"
        y="0"
        width={pageWidth}
        height={pageHeight}
        style={{ fill: settings.pageColor }}
      />
      {settings.paperTexture && <rect width={pageWidth} height={pageHeight}
        fill={`url(#paper-grain-${pageIndex})`} pointerEvents="none" />}
      {!settings.pageSize.startsWith("Notebook") && settings.ruledPaper && <rect
        className="plotter-grid-fill" width={pageWidth} height={pageHeight}
        fill={`url(#paper-lines-${pageIndex})`} pointerEvents="none" />}
      {settings.pageSize.startsWith("Notebook") && (
        <>
          <rect
            className="plotter-grid-fill"
            x="0"
            y="0"
            width={pageWidth}
            height={pageHeight}
            style={{ fill: `url(#plotter-rules-${pageIndex})` }}
          />
          {settings.pageSize === "NotebookSpread" ? (
            <>
              <line
                className="plotter-margin-line"
                x1="16.5"
                y1="0"
                x2="16.5"
                y2={pageHeight}
              />
              <line
                className="plotter-binding-line"
                x1={pageWidth / 2}
                y1="0"
                x2={pageWidth / 2}
                y2={pageHeight}
              />
              <line
                className="plotter-margin-line"
                x1={pageWidth - 16.5}
                y1="0"
                x2={pageWidth - 16.5}
                y2={pageHeight}
              />
            </>
          ) : (
            <line
              className="plotter-margin-line"
              x1={pageIndex % 2 === 0 ? pageWidth - 16.5 : 16.5}
              y1="0"
              x2={pageIndex % 2 === 0 ? pageWidth - 16.5 : 16.5}
              y2={pageHeight}
            />
          )}
        </>
      )}
      {orderedStrokes.map((stroke, index) => (
        <InkStroke
          key={index}
          stroke={stroke}
          inkPath={inkPaths[index]}
          inkCore={inkCores[index]}
          completed={playback?.active ? playback.strokeProgress?.[index] || 0 : 1}
          active={Boolean(playback?.active)}
          inkWidthMm={inkWidthMm}
          inkColor={settings.inkColor}
          coreOpacity={coreOpacity}
        />
      ))}
      {startPoint && !playback?.active && (
        <g
          className="plotter-start-point"
          transform={`translate(${startPoint.x} ${startPoint.y})`}
        >
          <title>Перо начнёт отсюда</title>
          <circle r="2.2" />
          <path d="M-3.4 0H-1.2M1.2 0H3.4M0 -3.4V-1.2M0 1.2V3.4" />
          <circle className="plotter-start-point-dot" r="0.45" />
          <text x="3.2" y="-2.6">Старт</text>
        </g>
      )}
      {playbackHead && (
        <g
          className="plotter-playback-head"
          transform={`translate(${playbackHead.x} ${playbackHead.y})`}
        >
          <circle r="1.35" />
          <circle r="0.45" />
        </g>
      )}
    </svg>
  );
}

export default memo(
  PlotterPaper,
  (previous, next) =>
    previous.layout === next.layout &&
    previous.pageIndex === next.pageIndex &&
    previous.metrics.width === next.metrics.width &&
    previous.metrics.height === next.metrics.height &&
    previous.settings.pageColor === next.settings.pageColor &&
    previous.settings.inkColor === next.settings.inkColor &&
    previous.settings.penWidthMm === next.settings.penWidthMm &&
    previous.settings.paperTexture === next.settings.paperTexture &&
    previous.settings.trueHandwriting === next.settings.trueHandwriting &&
    previous.settings.pressureVariation === next.settings.pressureVariation &&
    previous.settings.inkVariation === next.settings.inkVariation &&
    previous.settings.seed === next.settings.seed &&
    previous.settings.pageSize === next.settings.pageSize &&
    previous.settings.ruledPaper === next.settings.ruledPaper &&
    previous.settings.fontSize === next.settings.fontSize &&
    previous.settings.lineHeight === next.settings.lineHeight &&
    previous.settings.marginTop === next.settings.marginTop &&
    previous.playback?.progress === next.playback?.progress &&
    previous.playback?.active === next.playback?.active &&
    previous.playback?.strokeProgress === next.playback?.strokeProgress &&
    previous.playback?.strokes === next.playback?.strokes &&
    previous.startPoint?.x === next.startPoint?.x &&
    previous.startPoint?.y === next.startPoint?.y,
);
