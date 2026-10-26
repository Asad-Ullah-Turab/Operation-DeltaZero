/**
 * Authoritative combat configuration and damage constants shared across client and server.
 */

import type { HitZone } from './types';

export const MAX_HEALTH = 100;

export const HEADSHOT_DAMAGE = 50;
export const TORSO_DAMAGE = 25;
export const LIMBS_DAMAGE = 10;

export const DAMAGE_BY_ZONE: Record<HitZone, number> = {
  head: HEADSHOT_DAMAGE,
  torso: TORSO_DAMAGE,
  limbs: LIMBS_DAMAGE,
};

/**
 * Resolves the numeric damage value corresponding to a named hit zone.
 */
export function getDamageForHitZone(zone?: string): number {
  if (zone === 'head') return HEADSHOT_DAMAGE;
  if (zone === 'torso') return TORSO_DAMAGE;
  return LIMBS_DAMAGE;
}

