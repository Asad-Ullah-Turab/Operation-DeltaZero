/**
 * Network state synchronization schemas and client-side remote player tracking records.
 */

import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RAPIER } from '../physics';
import type { CharacterType } from '../../shared';
import type { CharacterVisual } from '../player';

export interface SyncedPlayerState {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  anim?: string;
  characterType?: string;
  onChange?: (callback: () => void) => void;
}

export interface SyncedRoomState {
  players: {
    onAdd: (
      callback: (player: SyncedPlayerState, sessionId: string) => void
    ) => void;
    onRemove: (
      callback: (player: SyncedPlayerState, sessionId: string) => void
    ) => void;
  };
}

export interface RemotePlayer {
  visual: CharacterVisual;
  characterType: CharacterType;
  targetPos: Vector3;
  targetRotY: number;
  targetAnim: string;
  body?: RAPIER.RigidBody;
}
