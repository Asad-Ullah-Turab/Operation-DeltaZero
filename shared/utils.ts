/**
 * Shared mathematical and sanitization utilities used across client and server.
 */

import type { CharacterType } from './types';

/**
 * Clamps a numeric value between a minimum and maximum boundary.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Sanitizes an unknown input into a valid CharacterType ('Merc' or 'Spie').
 */
export function sanitizeCharacterType(value: unknown): CharacterType {
  return value === 'Merc' ? 'Merc' : 'Spie';
}
