import { useMemo, useSyncExternalStore } from "react";
import { virtualPlotter, type VirtualInkPoint } from "../../plotter/virtualPlotter";

const device = virtualPlotter();
const subscribe = (listener: () => void) => device.subscribe(listener);
const read = () => device.snapshot();
const format = (value: number, digits = 2) => value.toLocaleString("ru-RU", { minimumFractionDigits: digits, maximumFractionDigits: digits });

function toPage(x: number, y: number, config: any) {
  let mx = x, my = y;
  if (config.invertY) my = -my;
  if (config.invertX) mx = -mx;
  if (config.swapAxes) [mx, my] = [my, mx];
  return { x: mx, y: -my };
}

function inkLevel(depth: number) {
  return depth < 0.04 ? 0 : depth < 0.1 ? 1 : depth < 0.2 ? 2 : 3;
}

const LEVELS = [
  { width: 0.16, opacity: 0.28 },
  { width: 0.24, opacity: 0.55 },
  { width: 0.32, opacity: 0.8 },
  { width: 0.4, opacity: 0.95 },
];

function inkRuns(strokes: VirtualInkPoint[][], config: any) {
  const runs: { level: number; d: string }[] = [];
  for (const stroke of strokes) {
    let level = -1, d = "";
    let previous: { x: number; y: number } | null = null;
    for (const point of stroke) {
      const page = toPage(point.x, point.y, config);
      const next = inkLevel(point.depth);
      if (next !== level && previous) {
        if (d) runs.push({ level, d });
        d = `M${previous.x.toFixed(2)} ${previous.y.toFixed(2)}`;
      } else if (!d) d = `M${page.x.toFixed(2)} ${page.y.toFixed(2)}`;
      d += `L${page.x.toFixed(2)} ${page.y.toFixed(2)}`;
      level = next;
      previous = page;
    }
    if (d && level >= 0) runs.push({ level, d });
  }
  return runs;
}

export default function VirtualPlotterPanel({ workspace }: { workspace: any }) {
  const snapshot = useSyncExternalStore(subscribe, read);
  const { config } = workspace;
  const runs = useMemo(() => inkRuns(snapshot.ink, config), [snapshot.ink, snapshot.inkPoints, config.swapAxes, config.invertX, config.invertY]);
  const pen = toPage(snapshot.physical[0], snapshot.physical[1], config);
  const bounds = useMemo(() => {
    let minX = pen.x - 20, maxX = pen.x + 20, minY = pen.y - 15, maxY = pen.y + 15;
    for (const stroke of snapshot.ink) for (const point of stroke) {
      const page = toPage(point.x, point.y, config);
      minX = Math.min(minX, page.x - 4); maxX = Math.max(maxX, page.x + 4);
      minY = Math.min(minY, page.y - 4); maxY = Math.max(maxY, page.y + 4);
    }
    return { minX, minY, width: Math.max(40, maxX - minX), height: Math.max(30, maxY - minY) };
  }, [snapshot.ink, snapshot.inkPoints, pen.x, pen.y, config.swapAxes, config.invertX, config.invertY]);
  const gap = snapshot.paperZ - snapshot.physical[2];
  const touching = gap <= 0;
  const gaugeScale = 10;
  const tipY = 72 - Math.max(-2, Math.min(5.5, gap)) * gaugeScale;

  return <section className="device-card virtual-plotter" id="device-virtual" aria-labelledby="device-virtual-title">
    <h2 id="device-virtual-title">Виртуальный плоттер</h2>
    <p className="device-hint">Повторяет GRBL с шаговым подъёмом пера: принимает те же команды, что и настоящий станок, и рисует только там, где перо касается листа. Чем сильнее прижим, тем темнее линия.</p>
    <div className="virtual-plotter-body">
      <svg className="virtual-plotter-paper" viewBox={`${bounds.minX} ${bounds.minY} ${bounds.width} ${bounds.height}`}
        role="img" aria-label="Лист виртуального плоттера">
        <rect x={bounds.minX} y={bounds.minY} width={bounds.width} height={bounds.height} className="virtual-plotter-sheet" />
        <g fill="none" strokeLinecap="round" strokeLinejoin="round" className="virtual-plotter-ink">
          {runs.map((run, index) => <path key={index} d={run.d} strokeWidth={LEVELS[run.level]!.width} strokeOpacity={LEVELS[run.level]!.opacity} />)}
        </g>
        <circle cx={pen.x} cy={pen.y} r={touching ? 0.55 : 0.9} className={touching ? "virtual-plotter-pen is-down" : "virtual-plotter-pen"} />
      </svg>
      <div className="virtual-plotter-side">
        <svg viewBox="0 0 60 96" role="img" aria-label="Высота пера над листом">
          <line x1="4" x2="56" y1="72" y2="72" className="virtual-plotter-surface" />
          <rect x="24" y={tipY - 18} width="12" height="12" rx="2" className="virtual-plotter-body-pen" />
          <path d={`M24 ${tipY - 6}L30 ${tipY}L36 ${tipY - 6}Z`} className="virtual-plotter-tip" />
        </svg>
        <small>Фактически на станке</small>
        <output aria-live="polite">{touching ? `Касается · прижим ${format(-gap)} мм` : `Над листом · ${format(gap)} мм`}</output>
      </div>
    </div>
    {snapshot.bottomedOut && <p className="plotter-warning" role="alert">Держатель пера сжат до упора: на настоящем станке это повредит стержень или пропустит шаги. Уменьшите прижим.</p>}
    <div className="virtual-plotter-controls">
      <div className="pen-step-picker" role="group" aria-label="Скорость имитации">
        <span>Скорость</span>
        <div>{[1, 4, 16].map(value => <button key={value} type="button" aria-pressed={snapshot.speed === value}
          onClick={() => device.setSpeed(value)}>×{value}</button>)}</div>
      </div>
      <label className="device-number"><span className="device-number-label">Лист ниже начального положения пера<small>Можно задать другой станок, чтобы проверить настройку касания.</small></span>
        <span className="device-number-value"><input type="number" min="0.3" max="20" step="0.1" value={snapshot.paperZ}
          disabled={snapshot.powered && snapshot.state !== "Idle"}
          onChange={event => device.setPaperDistance(Number(event.target.value))} /><span className="device-unit">мм</span></span>
      </label>
      <div className="device-buttons">
        <button type="button" onClick={() => device.clearPaper()}>Новый лист</button>
        <button type="button" disabled={snapshot.powered && snapshot.state !== "Idle"} onClick={() => device.liftPenByHand()}>Поднять перо рукой</button>
      </div>
    </div>
  </section>;
}
