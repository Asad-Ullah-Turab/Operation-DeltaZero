/**
 * Server message handlers for character selection and operative respawning.
 */

import type { Client, Room } from 'colyseus';
import type { GameState, CharacterType } from '../schema/GameState';
import {
  clamp,
  sanitizeCharacterType,
  MSG_SELECT_CHARACTER,
  MSG_RESPAWN,
  MSG_PLAYER_RESPAWNED,
  type SelectCharacterMessage,
} from '../../shared';
import { ARENA_BOUND, MIN_Y, MAX_Y } from './constants';

/**
 * Registers character selection and respawn message handlers on the game room.
 */
export function registerCharacterHandlers(room: Room<GameState>): void {
  // Handle character selection updates
  room.onMessage(MSG_SELECT_CHARACTER, (client: Client, data: SelectCharacterMessage) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || typeof data !== 'object' || data === null) return;

    const selected = sanitizeCharacterType(data.characterType);
    player.characterType = selected;
    player.anim = selected === 'Merc' ? 'Draw' : 'Idle';
  });

  // Handle player respawn event
  room.onMessage(
    MSG_RESPAWN,
    (
      client: Client,
      data: { characterType?: CharacterType; x: number; y: number; z: number }
    ) => {
      const player = room.state.players.get(client.sessionId);
      if (!player || typeof data !== 'object' || data === null) return;

      if (data.characterType === 'Merc' || data.characterType === 'Spie') {
        player.characterType = data.characterType;
      }
      if (
        Number.isFinite(data.x) &&
        Number.isFinite(data.y) &&
        Number.isFinite(data.z)
      ) {
        player.x = clamp(data.x, -ARENA_BOUND, ARENA_BOUND);
        player.y = clamp(data.y, MIN_Y, MAX_Y);
        player.z = clamp(data.z, -ARENA_BOUND, ARENA_BOUND);
      }
      player.anim = player.characterType === 'Merc' ? 'Draw' : 'Idle';

      room.broadcast(MSG_PLAYER_RESPAWNED, {
        sessionId: client.sessionId,
        characterType: player.characterType,
        x: player.x,
        y: player.y,
        z: player.z,
      });
    }
  );
}

