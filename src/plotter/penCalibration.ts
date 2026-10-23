import { compilePlotJob } from './job';
import { penGeometry, withPenGeometry } from './penLift';

const STEPPER_PRESSURES = [0.6, 1, 1.4];

export function calibrationMode(config) {
  if (config.penMode === 'servo' && config.profile !== 'ebb') return 'servo';
  if (['stepper', 'estepper'].includes(config.penMode) && config.profile !== 'ebb' && penGeometry(config)) return 'stepper';
  return 'speed';
}

export function calibrationCandidates(config) {
  const mode = calibrationMode(config);
  const geometry = penGeometry(config);
  const columns = mode === 'servo' ? [.75, .875, 1] : mode === 'stepper' ? STEPPER_PRESSURES : [1];
  return [0.6, 0.8, 1].flatMap((speed, row) => columns.map((pressure, col) => ({
    id: `${row + 1}.${col + 1}`, row, col, pressure,
    feedRate: Math.max(1, Math.round(config.feedRate * speed)),
    penDown: Math.round(Math.max(0, Math.min(config.profile === 'marlin' ? 180 : 32767, config.penUp + (config.penDown - config.penUp) * pressure))),
    pressureMm: mode === 'stepper' ? Number(Math.max(0.05, Math.min(1, geometry.pressure * pressure)).toFixed(2)) : undefined,
  })));
}

export function candidateConfig(config, candidate) {
  const mode = calibrationMode(config);
  if (mode === 'servo') return { ...config, penDown: candidate.penDown };
  if (mode === 'stepper') return withPenGeometry(config, { ...penGeometry(config), pressure: candidate.pressureMm });
  return config;
}

export function calibrationCheckConfig(config, candidates) {
  if (calibrationMode(config) !== 'stepper') return config;
  const deepest = candidates.reduce((best, item) => item.pressureMm > best.pressureMm ? item : best, candidates[0]);
  return candidateConfig(config, deepest);
}

export function createPenCalibration(config) {
  if (config.penMode === 'laser') throw new Error('Калибровочный лист предназначен для пера.');
  const candidates = calibrationCandidates(config);
  const base = { ...config, optimizePath: false, autoSetOrigin: false, returnToOrigin: false, customStartGcode: '', customEndGcode: '' };
  const strokesFor = item => {
    const x = 8 + item.col * 32, y = 8 + item.row * 24;
    const wave = Array.from({ length: 81 }, (_, i) => ({ x: x + i * .25, y: y + 4 + Math.sin(i / 80 * Math.PI * 6) * 3 }));
    const line = [{ x, y: y + 12 }, { x: x + 20, y: y + 12 }];
    return [wave, line].map(s => Object.assign(s, { pressure: 1, feedRate: item.feedRate }));
  };
  const jobs = candidates.map(item => compilePlotJob(strokesFor(item), candidateConfig(base, item)));
  const first = jobs[0];
  const commands = jobs.flatMap((job, index) => index ? job.commands.slice(job.commands.findIndex(command => /^G1X/.test(command))) : job.commands);
  return {
    ...first,
    id: `calibration-${jobs.map(job => job.id).join('-')}`,
    commands,
    strokes: candidates.flatMap(strokesFor),
    strokeCommandRanges: [],
    resumePoints: [],
    withinWorkArea: jobs.every(job => job.withinWorkArea),
    estimatedSeconds: jobs.reduce((sum, job) => sum + job.estimatedSeconds, 0),
    candidates,
    checkConfig: calibrationCheckConfig(base, candidates),
  };
}
