/**
 * Resolves raw GLTF animation group names to canonical Spy animation identifiers.
 */

import type { SpyAnimationName } from '../../types';

/**
 * Matches raw Mixamo/GLTF track names to canonical Spy animation track names.
 */
export function resolveSpyAnimName(rawName: string): SpyAnimationName | null {
  const lower = rawName.toLowerCase();
  if (lower === 'idle') return 'idle';
  if (lower === 'walking' || lower === 'walk' || lower === 'run') return 'walking';
  if (lower === 'start-walking' || lower === 'start_walking') return 'start-walking';
  if (lower === 'stop-walking' || lower === 'stop_walking') return 'stop-walking';
  if (
    lower === 'walking-turn-180' ||
    lower === 'walking_turn_180' ||
    lower === 'turn-180'
  ) {
    return 'walking-turn-180';
  }
  if (lower === 'left-turn' || lower === 'left_turn' || lower === 'turn-left') {
    return 'left-turn';
  }
  if (
    lower === 'right-turn' ||
    lower === 'right_turn' ||
    lower === 'turn-right'
  ) {
    return 'right-turn';
  }
  if (
    lower === 'left-strafe' ||
    lower === 'left-strafe-walking' ||
    lower === 'strafe-left'
  ) {
    return 'left-strafe-walking';
  }
  if (
    lower === 'right-strafe' ||
    lower === 'right-strafe-walking' ||
    lower === 'strafe-right'
  ) {
    return 'right-strafe-walking';
  }
  if (lower === 'crouch-idle' || lower === 'crouch_idle' || lower === 'crouch') {
    return 'crouch-idle';
  }
  if (
    lower === 'crouched-walking' ||
    lower === 'crouched_walking' ||
    lower === 'crouch-walking' ||
    lower === 'crouch_walk'
  ) {
    return 'crouched-walking';
  }
  if (
    lower === 'stand-to-crouch' ||
    lower === 'stand_to_crouch' ||
    lower === 'standtocrouch'
  ) {
    return 'stand-to-crouch';
  }
  if (
    lower === 'crouch-to-stand' ||
    lower === 'crouch_to_stand' ||
    lower === 'crouchtostand'
  ) {
    return 'crouch-to-stand';
  }
  if (lower === 'jump') return 'jump';
  if (
    lower === 'hang-to-crouch' ||
    lower === 'hang_to_crouch' ||
    lower === 'hangtocrouch' ||
    lower === 'climb'
  ) {
    return 'hang-to-crouch';
  }
  return null;
}

