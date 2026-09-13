import { compilePlotJob } from './job';

export function calibrationCandidates(config) {
  const variablePressure = config.penMode === 'servo' && config.profile !== 'ebb';
  return [0.6, 0.8, 1].flatMap((speed, row) => (variablePressure ? [.85, 1, 1.15] : [1]).map((pressure, col) => ({
    id: `${row + 1}.${col + 1}`, row, col, pressure,
    feedRate: Math.max(1, Math.round(config.feedRate * speed)),
    penDown: Math.round(Math.max(0, Math.min(config.profile === 'marlin' ? 180 : 32767, config.penUp + (config.penDown - config.penUp) * pressure))),
  })));
}

export function createPenCalibration(config) {
  if (config.penMode === 'laser') throw new Error('Калибровочный лист предназначен для пера.');
  const candidates = calibrationCandidates(config);
  const strokes = candidates.flatMap(item => {
    const x = 8 + item.col * 32, y = 8 + item.row * 24;
    const wave = Array.from({ length: 81 }, (_, i) => ({ x: x + i * .25, y: y + 4 + Math.sin(i / 80 * Math.PI * 6) * 3 }));
    const line = [{ x, y: y + 12 }, { x: x + 20, y: y + 12 }];
    return [wave, line].map(s => Object.assign(s, { pressure: item.pressure, feedRate: item.feedRate }));
  });
  // Use the selected machine's coordinates, but keep its custom document macros out of the test sheet.
  const job = compilePlotJob(strokes, { ...config, optimizePath: false, autoSetOrigin: false, returnToOrigin: false, customStartGcode: '', customEndGcode: '' });
  return { ...job, candidates };
}
