/**
 * Authoritative Colyseus game room orchestrating client connections, lifecycle, and message handlers.
 */

import * as colyseusPkg from 'colyseus';
import type { Client, Room as RoomType } from 'colyseus';
import { GameState, Player } from '../schema/GameState';
import { sanitizeCharacterType, type JoinOptions } from '../../shared';
import { registerCharacterHandlers } from '../handlers/characterHandlers';
import { registerMovementHandlers } from '../handlers/movementHandlers';
import { registerCombatHandlers } from '../handlers/combatHandlers';

const { Room } = ((colyseusPkg as unknown as { default?: typeof colyseusPkg }).default ??
  colyseusPkg) as { Room: typeof RoomType };

export class GameRoom extends Room<GameState> {
  maxClients = 32;

  onCreate(): void {
    this.setState(new GameState());

    // Set binary delta patch rate to 30ms (~33.3 updates/sec)
    this.setPatchRate(30);

    // Register decomposed message handlers
    registerCharacterHandlers(this);
    registerMovementHandlers(this);
    registerCombatHandlers(this);
  }

  onJoin(client: Client, options?: JoinOptions): void {
    const player = new Player();
    // Random spawn offset near the center of the flat ground
    const spawnSpread = 6;
    player.x = (Math.random() - 0.5) * spawnSpread;
    player.y = 2.0;
    player.z = (Math.random() - 0.5) * spawnSpread;
    player.rotationY = 0;
    player.characterType = sanitizeCharacterType(options?.characterType);
    player.anim = player.characterType === 'Merc' ? 'Draw' : 'Idle';

    this.state.players.set(client.sessionId, player);
    console.log(
      `[GameRoom] Player joined: ${client.sessionId} as ${player.characterType}`
    );
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    console.log(`[GameRoom] Player left: ${client.sessionId}`);
  }
}

