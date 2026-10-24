import * as colyseusPkg from 'colyseus';
import type { Client, Room as RoomType } from 'colyseus';
import { GameState, Player, CharacterType } from './schema/GameState';

const { Room } = ((colyseusPkg as unknown as { default?: typeof colyseusPkg }).default ??
  colyseusPkg) as { Room: typeof RoomType };

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

export interface SelectCharacterMessage {
  characterType: CharacterType;
}

export interface ShootMessage {
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export interface JoinOptions {
  characterType?: CharacterType;
}

const ARENA_BOUND = 60;
const MIN_Y = -5;
const MAX_Y = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeCharacterType(value: unknown): CharacterType {
  return value === 'Merc' ? 'Merc' : 'Spie';
}

export class GameRoom extends Room<GameState> {
  maxClients = 32;

  onCreate(): void {
    this.setState(new GameState());

    // Set binary delta patch rate to 30ms (~33.3 updates/sec)
    this.setPatchRate(30);

    // Handle character selection updates
    this.onMessage('selectCharacter', (client: Client, data: SelectCharacterMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || typeof data !== 'object' || data === null) return;

      const selected = sanitizeCharacterType(data.characterType);
      player.characterType = selected;
      player.anim = selected === 'Merc' ? 'Draw' : 'Idle';
    });

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
        if (typeof data.anim === 'string' && data.anim.length <= 32) {
          player.anim = data.anim;
        }
        if (data.characterType === 'Merc' || data.characterType === 'Spie') {
          player.characterType = data.characterType;
        }
      }
    });

    // Handle jump notifications with vertical bounds validation
    this.onMessage('jump', (client: Client, data?: JumpMessage) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      if (data && Number.isFinite(data.y)) {
        player.y = clamp(data.y as number, MIN_Y, MAX_Y);
      }
      if (data && typeof data.anim === 'string' && data.anim.length <= 32) {
        player.anim = data.anim;
      } else if (player.characterType === 'Spie') {
        player.anim = 'Roll';
      }
    });

    // Handle lightweight weapon shoot events and broadcast to remote clients
    this.onMessage('shoot', (client: Client, data: ShootMessage) => {
      const player = this.state.players.get(client.sessionId);
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

        this.broadcast(
          'playerShoot',
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
