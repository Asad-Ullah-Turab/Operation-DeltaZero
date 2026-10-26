/**
 * Network protocol message names and payload interfaces shared between client and server.
 */

import type { CharacterType } from './types';

// Client-to-Server Message Names
export const MSG_SELECT_CHARACTER = 'selectCharacter';
export const MSG_MOVE = 'move';
export const MSG_JUMP = 'jump';
export const MSG_SHOOT = 'shoot';
export const MSG_PLAYER_HIT = 'playerHit';
export const MSG_PLAYER_DIED = 'playerDied';
export const MSG_RESPAWN = 'respawn';

// Server-to-Client Message Names
export const MSG_PLAYER_SHOOT = 'playerShoot';
export const MSG_TAKE_DAMAGE = 'takeDamage';
export const MSG_PLAYER_RESPAWNED = 'playerRespawned';

export interface SelectCharacterMessage {
  characterType: CharacterType;
}

export interface MoveMessage {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  anim?: string;
  characterType?: CharacterType;
}

export interface JumpMessage {
  y?: number;
  anim?: string;
}

export interface ShootMessage {
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export interface PlayerShootPayload {
  sessionId: string;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export interface PlayerHitMessage {
  targetSessionId: string;
  damage: number;
  zone?: string;
}

export interface TakeDamagePayload {
  attackerSessionId?: string;
  damage: number;
  zone?: string;
}

export interface PlayerDiedMessage {
  sessionId?: string;
}

export interface RespawnMessage {
  characterType: CharacterType;
  x: number;
  y: number;
  z: number;
}

export interface PlayerRespawnedPayload {
  sessionId: string;
  characterType?: CharacterType;
  x: number;
  y: number;
  z: number;
}

export interface JoinOptions {
  characterType?: CharacterType;
}

