import * as colyseusPkg from 'colyseus';
import type { Client, Room as RoomType } from 'colyseus';
import { GameState, Player } from './schema/GameState';

const { Room } = ((colyseusPkg as unknown as { default?: typeof colyseusPkg }).default ??
  colyseusPkg) as { Room: typeof RoomType };

export interface MoveMessage {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

export interface JumpMessage {
  y?: number;
}

const ARENA_BOUND = 60;
const MIN_Y = -5;
const MAX_Y = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class GameRoom extends Room<GameState> {
  maxClients = 32;

  onCreate(): void {
    this.setState(new GameState());

    // Set binary delta patch rate to 30ms (~33.3 updates/sec)
    this.setPatchRate(30);

    // Handle positional & rotational updates with server-side validation
    this.onMessage('move', (client: Client, data: MoveMessage) => {
      const player = this.state.players.get(client.sessionId);
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
      }
    });

    // Handle jump notifications with vertical bounds validation
    this.onMessage('jump', (client: Client, data?: JumpMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (data && Number.isFinite(data.y)) {
        player.y = clamp(data.y as number, MIN_Y, MAX_Y);
      }
    });
  }

  onJoin(client: Client): void {
    const player = new Player();
    // Random spawn offset near the center of the flat ground
    const spawnSpread = 6;
    player.x = (Math.random() - 0.5) * spawnSpread;
    player.y = 2.0;
    player.z = (Math.random() - 0.5) * spawnSpread;
    player.rotationY = 0;

    this.state.players.set(client.sessionId, player);
    console.log(`[GameRoom] Player joined: ${client.sessionId}`);
  }

  onLeave(client: Client): void {
    this.state.players.delete(client.sessionId);
    console.log(`[GameRoom] Player left: ${client.sessionId}`);
  }
}

