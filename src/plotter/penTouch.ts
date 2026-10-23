import { automaticPenSpeed, automaticPenUpPosition } from "./penLift";

type Point = { x: number; y: number };

export const SOFT_TOUCH_HOVER_MM = 0.5;
export const SOFT_TOUCH_ROLL_MM = 0.8;
export const MAX_PEN_PRESSURE_MM = 0.4;

export function usesSoftTouch(config: any): boolean {
  return config.penSoftTouch !== false && config.profile !== "ebb" && ["stepper", "estepper"].includes(config.penMode);
}

export function penAxis(config: any): "Z" | "E" {
  return config.penMode === "estepper" ? "E" : "Z";
}

function upSign(config: any): number {
  return Math.sign(automaticPenUpPosition(config) - config.zDown) || (config.zUpDirection === 1 ? 1 : -1);
}

export function hoverPosition(config: any): number {
  const up = automaticPenUpPosition(config);
  const travel = Math.abs(up - config.zDown);
  return Number((config.zDown + upSign(config) * Math.min(SOFT_TOUCH_HOVER_MM, travel * 0.6)).toFixed(3));
}

export function contactPosition(config: any): number | null {
  const value = Number(config.zContact);
  if (config.zContact === null || config.zContact === undefined || !Number.isFinite(value)) return null;
  const sign = upSign(config);
  return (value - config.zDown) * sign >= 0 ? value : null;
}

export function penPressureMm(config: any): number {
  return Number(Math.abs((contactPosition(config) ?? config.zDown) - config.zDown).toFixed(3));
}

export function pressureVariationMm(config: any): number {
  if (!usesSoftTouch(config)) return 0;
  const requested = Math.max(0, Math.min(MAX_PEN_PRESSURE_MM, Number(config.penPressureVariation) || 0));
  const contact = contactPosition(config);
  if (contact === null) return 0;
  return Number(Math.min(requested, Math.abs(config.zDown - contact) * 0.7).toFixed(3));
}

function unit(dx: number, dy: number): Point | null {
  const length = Math.hypot(dx, dy);
  return length > 1e-6 ? { x: dx / length, y: dy / length } : null;
}

function pathLength(points: Point[]) {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return total;
}

export function endDirection(points: Point[], atStart: boolean, reach = 0.4): Point | null {
  const ordered = atStart ? points : [...points].reverse();
  const origin = ordered[0]!;
  let travelled = 0;
  for (let i = 1; i < ordered.length; i++) {
    travelled += Math.hypot(ordered[i]!.x - ordered[i - 1]!.x, ordered[i]!.y - ordered[i - 1]!.y);
    if (travelled >= reach || i === ordered.length - 1) {
      const direction = unit(ordered[i]!.x - origin.x, ordered[i]!.y - origin.y);
      return direction && !atStart ? { x: -direction.x, y: -direction.y } : direction;
    }
  }
  return null;
}

export function rollDistance(points: Point[]) {
  return Math.min(SOFT_TOUCH_ROLL_MM, Math.max(0.25, pathLength(points) * 0.4));
}

export function writingHeights(points: Point[], config: any, pageUp: Point, strokePressure = 1): number[] {
  const variation = pressureVariationMm(config);
  const zDown = Number(config.zDown);
  if (!variation || points.length < 2) return points.map(() => zDown);
  const sign = upSign(config);
  const lightness: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)]!, b = points[Math.min(points.length - 1, i + 1)]!;
    const direction = unit(b.x - a.x, b.y - a.y);
    const upness = direction ? direction.x * pageUp.x + direction.y * pageUp.y : 0;
    const t = Math.max(0, Math.min(1, (upness - 0.15) / 0.7));
    lightness.push(t * t * (3 - 2 * t));
  }
  const smoothed = [...lightness];
  const reach = 0.7;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 1; i < smoothed.length; i++) {
      const step = Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
      const keep = Math.exp(-step / reach);
      smoothed[i] = smoothed[i - 1]! * keep + smoothed[i]! * (1 - keep);
    }
    for (let i = smoothed.length - 2; i >= 0; i--) {
      const step = Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.y - points[i]!.y);
      const keep = Math.exp(-step / reach);
      smoothed[i] = smoothed[i + 1]! * keep + smoothed[i]! * (1 - keep);
    }
  }
  const base = Math.max(0, Math.min(0.35, (1 - (Number(strokePressure) || 1)) * 2));
  return smoothed.map(value => Number((zDown + sign * variation * Math.min(1, base + value * 0.85)).toFixed(2)));
}

export function softTouchSeconds(config: any, rampLength: number, rampFeed: number) {
  const speed = automaticPenSpeed(config);
  const hoverTravel = Math.abs(automaticPenUpPosition(config) - hoverPosition(config));
  return (speed > 0 ? hoverTravel * 60 / speed : 0) + (rampFeed > 0 ? rampLength * 60 / rampFeed : 0);
}
