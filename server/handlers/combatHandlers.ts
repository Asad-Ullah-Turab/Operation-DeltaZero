/**
 * Server message handlers for weapon firing replication, damage routing, and player death.
 */

import type { Client, Room } from 'colyseus';
import type { GameState } from '../schema/GameState';
import {
  clamp,
  MSG_SHOOT,
  MSG_PLAYER_SHOOT,
  MSG_PLAYER_HIT,
  MSG_TAKE_DAMAGE,
  MSG_PLAYER_DIED,
  type ShootMessage,
} from '../../shared';
import { ARENA_BOUND, MIN_Y, MAX_Y } from './constants';

/**
 * Registers combat, projectile replication, and damage handlers on the game room.
 */
export function registerCombatHandlers(room: Room<GameState>): void {
  // Handle lightweight weapon shoot events and broadcast to remote clients
  room.onMessage(MSG_SHOOT, (client: Client, data: ShootMessage) => {
    const player = room.state.players.get(client.sessionId);
    if (!player || typeof data !== 'object' || data === null) return;

    if (
      Number.isFinite(data.originX) &&
      Number.isFinite(data.originY) &&
      Number.isFinite(data.originZ) &&
      Number.isFinite(data.dirX) &&
      Number.isFinite(data.dirY) &&
      Number.isFinite(data.dirZ)
    ) {
      const len = Math.hypot(data.dirX, data.dirY, data.dirZ);
      if (len < 0.0001) return;

      room.broadcast(
        MSG_PLAYER_SHOOT,
        {
          sessionId: client.sessionId,
          originX: clamp(data.originX, -ARENA_BOUND, ARENA_BOUND),
          originY: clamp(data.originY, MIN_Y, MAX_Y),
          originZ: clamp(data.originZ, -ARENA_BOUND, ARENA_BOUND),
          dirX: data.dirX / len,
          dirY: data.dirY / len,
          dirZ: data.dirZ / len,
        },
        { except: client }
      );
    }
  });

  // Handle damage notification from shooter to victim
  room.onMessage(
    MSG_PLAYER_HIT,
    (
      client: Client,
      data: { targetSessionId: string; damage: number; zone?: string }
    ) => {
      if (!data || typeof data.targetSessionId !== 'string') return;
      for (const otherClient of room.clients) {
        if (otherClient.sessionId === data.targetSessionId) {
          otherClient.send(MSG_TAKE_DAMAGE, {
            attackerSessionId: client.sessionId,
            damage: Number.isFinite(data.damage) ? data.damage : 25,
            zone: typeof data.zone === 'string' ? data.zone : 'torso',
          });
          break;
        }
      }
    }
  );

  // Handle player elimination event
  room.onMessage(MSG_PLAYER_DIED, (client: Client) => {
    room.broadcast(MSG_PLAYER_DIED, { sessionId: client.sessionId }, { except: client });
  });
}
