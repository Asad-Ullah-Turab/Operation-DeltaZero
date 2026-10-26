/**
 * Math utilities for angles, interpolation, and scalar operations.
 */

import { clamp } from '../../shared';

export { clamp };

/**
 * Normalizes an angle in radians into the range [-PI, PI].
 */
export function normalizeAngle(angle: number): number {
  let diff = (angle + Math.PI) % (Math.PI * 2);
  if (diff < 0) {
    diff += Math.PI * 2;
  }
  return diff - Math.PI;
}

/**
 * Shortest-angle interpolation on [-PI, PI] for smooth character turning.
 */
export function lerpAngleY(
  current: number,
  target: number,
  factor: number
): number {
  const diff = normalizeAngle(target - current);
  return current + diff * Math.min(1.0, factor);
}

