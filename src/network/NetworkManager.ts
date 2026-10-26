/**
 * Facade coordinating Colyseus client connection, outbound RPC dispatch, and state synchronization.
 */

import * as Colyseus from 'colyseus.js';
import type { Scene } from '@babylonjs/core/scene';
import type { RAPIER } from '../physics';
import {
  MSG_SELECT_CHARACTER,
  MSG_MOVE,
  MSG_JUMP,
  MSG_SHOOT,
  MSG_PLAYER_HIT,
  MSG_PLAYER_DIED,
  MSG_RESPAWN,
  type CharacterType,
} from '../../shared';
import type { LocalPlayer, CharacterAssets } from '../player';
import type { CombatEffectsManager } from '../combat';
import { getServerUrl } from '../config/network';
import type { SyncedRoomState } from './types';
import { RemotePlayerManager } from './RemotePlayerManager';
import { bindStateHandlers } from './roomHandlers';

export class NetworkManager {
  private readonly localPlayer: LocalPlayer;
  private readonly client: Colyseus.Client;
  private room: Colyseus.Room<SyncedRoomState> | null = null;
  private readonly remotePlayerManager = new RemotePlayerManager();

  private lastSentX = 0;
  private lastSentY = 0;
  private lastSentZ = 0;
  private lastSentRotY = 0;
  private lastSentAnim = '';

  constructor(
    scene: Scene,
    localPlayer: LocalPlayer,
    assets: CharacterAssets,
    combatEffects: CombatEffectsManager,
    world?: RAPIER.World
  ) {
    this.localPlayer = localPlayer;
    this.client = new Colyseus.Client(getServerUrl());

    this.handlerContext = {
      scene,
      localPlayer,
      assets,
      combatEffects,
      world,
      remotePlayerManager: this.remotePlayerManager,
      onLocalSpawn: (x, y, z, rotY) => {
        this.localPlayer.setSpawnPosition(x, y, z, rotY);
        this.lastSentX = x;
        this.lastSentY = y;
        this.lastSentZ = z;
        this.lastSentRotY = rotY;
        this.lastSentAnim = this.localPlayer.currentAnim;
      },
    };
  }

  private readonly handlerContext: Parameters<typeof bindStateHandlers>[1];

  /**
   * Connects to the Colyseus game room and registers network listeners.
   */
  public async connect(): Promise<void> {
    try {
      const characterType = this.localPlayer.characterType;
      this.room = await this.client.joinOrCreate<SyncedRoomState>('game_room', {
        characterType,
      });
      console.log(
        `[Colyseus] Joined room ${this.room.roomId} as ${this.room.sessionId} (${characterType})`
      );
      this.room.send(MSG_SELECT_CHARACTER, { characterType });
      bindStateHandlers(this.room, this.handlerContext);
    } catch (err) {
      console.warn(
        '[Colyseus] Server offline or unreachable, running in local sandbox mode:',
        err
      );
    }
  }

  /**
   * Transmits bullet damage event to authoritative server.
   */
  public sendPlayerHit(
    targetSessionId: string,
    damage: number,
    zone: string
  ): void {
    if (this.room) {
      this.room.send(MSG_PLAYER_HIT, { targetSessionId, damage, zone });
    }
  }

  /**
   * Notifies server of local player elimination.
   */
  public sendPlayerDied(): void {
    if (this.room) {
      this.room.send(MSG_PLAYER_DIED, {});
    }
  }

  /**
   * Transmits player respawn position and operative class choice.
   */
  public sendRespawn(
    characterType: CharacterType,
    x: number,
    y: number,
    z: number
  ): void {
    if (this.room) {
      this.room.send(MSG_RESPAWN, { characterType, x, y, z });
    }
  }

  /**
   * Notifies server of character archetype selection change.
   */
  public sendSelectCharacter(characterType: CharacterType): void {
    if (this.room) {
      this.room.send(MSG_SELECT_CHARACTER, { characterType });
    }
  }

  /**
   * Sends local player movement/animation/shoot updates and interpolates remote avatars.
   */
  public update(dtSeconds: number): void {
    const pendingShots = this.localPlayer.consumePendingShots();

    if (this.room) {
      for (const shot of pendingShots) {
        this.room.send(MSG_SHOOT, shot);
      }

      const pos = this.localPlayer.mesh.position;
      const rotY = this.localPlayer.rotationY;
      const anim = this.localPlayer.currentAnim;

      if (this.localPlayer.consumeJumpEvent()) {
        this.room.send(MSG_JUMP, { y: pos.y, anim });
      }

      const dx = pos.x - this.lastSentX;
      const dy = pos.y - this.lastSentY;
      const dz = pos.z - this.lastSentZ;
      const dRot = Math.abs(rotY - this.lastSentRotY);
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > 0.0004 || dRot > 0.01 || anim !== this.lastSentAnim) {
        this.room.send(MSG_MOVE, {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          rotationY: rotY,
          anim,
          characterType: this.localPlayer.characterType,
        });
        this.lastSentX = pos.x;
        this.lastSentY = pos.y;
        this.lastSentZ = pos.z;
        this.lastSentRotY = rotY;
        this.lastSentAnim = anim;
      }
    }

    this.remotePlayerManager.interpolate(dtSeconds);
  }
}

