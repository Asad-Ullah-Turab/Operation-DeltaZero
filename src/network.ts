import * as Colyseus from 'colyseus.js';
import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { LocalPlayer, createCylinderVisual } from './player';

interface SyncedPlayerState {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  onChange?: ( callback: () => void ) => void;
}

interface SyncedRoomState {
  players: {
    onAdd: (
      callback: (player: SyncedPlayerState, sessionId: string) => void
    ) => void;
    onRemove: (
      callback: (player: SyncedPlayerState, sessionId: string) => void
    ) => void;
  };
}

interface RemotePlayer {
  mesh: Mesh;
  targetPos: Vector3;
  targetRotY: number;
}

export class NetworkManager {
  private readonly scene: Scene;
  private readonly localPlayer: LocalPlayer;
  private readonly client: Colyseus.Client;
  private room: Colyseus.Room<SyncedRoomState> | null = null;
  private readonly remotePlayers = new Map<string, RemotePlayer>();

  private lastSentX = 0;
  private lastSentY = 0;
  private lastSentZ = 0;
  private lastSentRotY = 0;

  constructor(scene: Scene, localPlayer: LocalPlayer) {
    this.scene = scene;
    this.localPlayer = localPlayer;

    const hostname = window.location.hostname || 'localhost';
    this.client = new Colyseus.Client('ws://' + hostname + ':2567');
  }

  public async connect(): Promise<void> {
    try {
      this.room = await this.client.joinOrCreate<SyncedRoomState>('game_room');
      console.log(`[Colyseus] Joined room ${this.room.roomId} as ${this.room.sessionId}`);
      this.bindStateHandlers(this.room);
    } catch (err) {
      console.warn('[Colyseus] Server offline or unreachable, running in local sandbox mode:', err);
    }
  }

  private bindStateHandlers(room: Colyseus.Room<SyncedRoomState>): void {
    // Support both Colyseus 0.16 getStateCallbacks and direct schema callbacks
    const getCallbacks = (Colyseus as unknown as {
      getStateCallbacks?: (r: Colyseus.Room<SyncedRoomState>) => (instance: unknown) => {
        players?: {
          onAdd: (cb: (p: SyncedPlayerState, key: string) => void) => void;
          onRemove: (cb: (p: SyncedPlayerState, key: string) => void) => void;
        };
        onChange?: (cb: () => void) => void;
      };
    }).getStateCallbacks;

    const $ = typeof getCallbacks === 'function' ? getCallbacks(room) : null;
    const playersProxy = $ ? $(room.state).players : room.state.players;

    if (!playersProxy) return;

    const handleAdd = (player: SyncedPlayerState, sessionId: string): void => {
      if (sessionId === room.sessionId) {
        // Initialize local player at authoritative server spawn coordinates
        this.localPlayer.setSpawnPosition(
          player.x,
          player.y,
          player.z,
          player.rotationY
        );
        this.lastSentX = player.x;
        this.lastSentY = player.y;
        this.lastSentZ = player.z;
        this.lastSentRotY = player.rotationY;
        return;
      }

      // Instantiate remote player cylinder mesh
      const mesh = createCylinderVisual(
        `remote_${sessionId}`,
        this.scene,
        new Color3(0.94, 0.35, 0.35)
      );
      mesh.position.set(player.x, player.y, player.z);
      mesh.rotation.y = player.rotationY;

      const remoteEntry: RemotePlayer = {
        mesh,
        targetPos: new Vector3(player.x, player.y, player.z),
        targetRotY: player.rotationY,
      };
      this.remotePlayers.set(sessionId, remoteEntry);

      // Listen for binary state patches on this remote player
      const onPlayerChange = (): void => {
        remoteEntry.targetPos.set(player.x, player.y, player.z);
        remoteEntry.targetRotY = player.rotationY;
      };

      if ($) {
        const playerProxy = $(player);
        if (playerProxy && typeof playerProxy.onChange === 'function') {
          playerProxy.onChange(onPlayerChange);
        }
      } else if (typeof player.onChange === 'function') {
        player.onChange(onPlayerChange);
      } else {
        (player as unknown as { onChange: () => void }).onChange = onPlayerChange;
      }
    };

    const handleRemove = (_player: SyncedPlayerState, sessionId: string): void => {
      const remote = this.remotePlayers.get(sessionId);
      if (!remote) return;
      remote.mesh.dispose(false, true);
      this.remotePlayers.delete(sessionId);
    };

    if (typeof playersProxy.onAdd === 'function') {
      playersProxy.onAdd(handleAdd);
    } else {
      (playersProxy as unknown as { onAdd: typeof handleAdd }).onAdd = handleAdd;
    }

    if (typeof playersProxy.onRemove === 'function') {
      playersProxy.onRemove(handleRemove);
    } else {
      (playersProxy as unknown as { onRemove: typeof handleRemove }).onRemove = handleRemove;
    }
  }

  /**
   * Sends local player updates to Colyseus only when moving/jumping,
   * and smoothly interpolates remote player meshes.
   */
  public update(dtSeconds: number): void {
    if (this.room) {
      const pos = this.localPlayer.mesh.position;
      const rotY = this.localPlayer.rotationY;

      if (this.localPlayer.consumeJumpEvent()) {
        this.room.send('jump', { y: pos.y });
      }

      const dx = pos.x - this.lastSentX;
      const dy = pos.y - this.lastSentY;
      const dz = pos.z - this.lastSentZ;
      const dRot = Math.abs(rotY - this.lastSentRotY);
      const distSq = dx * dx + dy * dy + dz * dz;

      // Only send network packets when the player has actually moved or rotated
      if (distSq > 0.0004 || dRot > 0.01) {
        this.room.send('move', {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          rotationY: rotY,
        });
        this.lastSentX = pos.x;
        this.lastSentY = pos.y;
        this.lastSentZ = pos.z;
        this.lastSentRotY = rotY;
      }
    }

    // Smoothly interpolate remote players toward their binary-synced targets
    const lerpFactor = Math.min(1.0, dtSeconds * 16.0);
    for (const remote of this.remotePlayers.values()) {
      Vector3.LerpToRef(
        remote.mesh.position,
        remote.targetPos,
        lerpFactor,
        remote.mesh.position
      );
      remote.mesh.rotation.y = remote.targetRotY;
    }
  }
}
