/**
 * Server message handlers for client movement synchronization and jump notifications.
 */

import type { Client, Room } from 'colyseus';
import type { GameState } from '../schema/GameState';
import {
  clamp,
  MSG_MOVE,
  MSG_JUMP,
  type MoveMessage,
  type JumpMessage,
} from '../../shared';
import { ARENA_BOUND, MIN_Y, MAX_Y } from './constants';

/**
 * Registers movement and jump message handlers on the game room.
 */
export function registerMovementHandlers(room: Room<GameState>): void {
  // Handle positional & rotational updates with server-side validation
  room.onMessage(MSG_MOVE, (client: Client, data: MoveMessage) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || typeof data !== 'object' || data === null) return;

    if (
      Number.isFinite(data.x) &&
      Number.isFinite(data.y) &&
      Number.isFinite(data.z) &&
      Number.isFinite(data.rotationY)
    ) {
      player.x = clamp(data.x, -ARENA_BOUND, ARENA_BOUND);
      player.y = clamp(data.y, MIN_Y, MAX_Y);
      player.z = clamp(data.z, -ARENA_BOUND, ARENA_BOUND);
      player.rotationY = data.rotationY;
      if (typeof data.anim === 'string' && data.anim.length <= 32) {
        player.anim = data.anim;
      }
      if (data.characterType === 'Merc' || data.characterType === 'Spy') {
        player.characterType = data.characterType;
      }
    }
  });

  // Handle jump notifications with vertical bounds validation
  room.onMessage(MSG_JUMP, (client: Client, data?: JumpMessage) => {
    const player = room.state.players.get(client.sessionId);
    if (!player) return;

    if (data && Number.isFinite(data.y)) {
      player.y = clamp(data.y as number, MIN_Y, MAX_Y);
    }
    if (data && typeof data.anim === 'string' && data.anim.length <= 32) {
      player.anim = data.anim;
    } else if (player.characterType === 'Spy') {
      player.anim = 'Roll';
    }
  });
}

