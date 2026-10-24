import * as Colyseus from 'colyseus.js';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import {
  LocalPlayer,
  CharacterAssets,
  CharacterType,
  CharacterVisual,
  createSpieVisual,
  createMercVisual,
  lerpAngleY,
} from './player';
import { CombatEffectsManager } from './combat';

interface SyncedPlayerState {
  x: number;
  y: number;
  z: number;
  rotationY: number;
  anim?: string;
  characterType?: string;
  onChange?: (callback: () => void) => void;
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

interface RemoteShootPayload {
  sessionId: string;
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

interface RemotePlayer {
  visual: CharacterVisual;
  characterType: CharacterType;
  targetPos: Vector3;
  targetRotY: number;
  targetAnim: string;
}

function normalizeCharacterType(value: unknown): CharacterType {
  return value === 'Merc' ? 'Merc' : 'Spie';
}

export class NetworkManager {
  private readonly scene: Scene;
  private readonly localPlayer: LocalPlayer;
  private readonly assets: CharacterAssets;
  private readonly combatEffects: CombatEffectsManager;
  private readonly client: Colyseus.Client;
  private room: Colyseus.Room<SyncedRoomState> | null = null;
  private readonly remotePlayers = new Map<string, RemotePlayer>();

  private lastSentX = 0;
  private lastSentY = 0;
  private lastSentZ = 0;
  private lastSentRotY = 0;
  private lastSentAnim = '';

  constructor(
    scene: Scene,
    localPlayer: LocalPlayer,
    assets: CharacterAssets,
    combatEffects: CombatEffectsManager
  ) {
    this.scene = scene;
    this.localPlayer = localPlayer;
    this.assets = assets;
    this.combatEffects = combatEffects;

    const hostname = window.location.hostname || 'localhost';
    this.client = new Colyseus.Client('ws://' + hostname + ':2567');
  }

  public async connect(): Promise<void> {
    try {
      const characterType = this.localPlayer.characterType;
      this.room = await this.client.joinOrCreate<SyncedRoomState>('game_room', {
        characterType,
      });
      console.log(
        `[Colyseus] Joined room ${this.room.roomId} as ${this.room.sessionId} (${characterType})`
      );
      this.room.send('selectCharacter', { characterType });
      this.bindStateHandlers(this.room);
    } catch (err) {
      console.warn(
        '[Colyseus] Server offline or unreachable, running in local sandbox mode:',
        err
      );
    }
  }

  private createRemoteVisual(
    sessionId: string,
    characterType: CharacterType
  ): CharacterVisual {
    if (characterType === 'Merc') {
      return createMercVisual(
        `remote_merc_${sessionId}`,
        this.scene,
        this.assets.mercContainer,
        false
      );
    }
    return createSpieVisual(
      `remote_spie_${sessionId}`,
      this.scene,
      this.assets.spieContainer
    );
  }

  private bindStateHandlers(room: Colyseus.Room<SyncedRoomState>): void {
    // Listen for remote player weapon shoot events
    room.onMessage('playerShoot', (payload: RemoteShootPayload) => {
      if (!payload || typeof payload !== 'object') return;
      const remote = this.remotePlayers.get(payload.sessionId);

      let shotOrigin = new Vector3(
        payload.originX,
        payload.originY,
        payload.originZ
      );

      if (remote) {
        if (remote.visual.muzzleFlashMesh) {
          this.combatEffects.triggerSingleFrameMuzzleFlash(
            remote.visual.muzzleFlashMesh
          );
        }
        if (remote.visual.muzzleNode) {
          remote.visual.muzzleNode.computeWorldMatrix(true);
          shotOrigin = remote.visual.muzzleNode.getAbsolutePosition().clone();
        }
      }

      const shotDir = new Vector3(payload.dirX, payload.dirY, payload.dirZ);
      if (shotDir.lengthSquared() > 0.0001) {
        this.combatEffects.spawnBullet(shotOrigin, shotDir);
      }
    });

    const getCallbacks = (Colyseus as unknown as {
      getStateCallbacks?: (
        r: Colyseus.Room<SyncedRoomState>
      ) => (instance: unknown) => {
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
        this.lastSentAnim = this.localPlayer.currentAnim;
        return;
      }

      const charType = normalizeCharacterType(player.characterType);
      const visual = this.createRemoteVisual(sessionId, charType);
      visual.root.position.set(player.x, player.y, player.z);
      visual.root.rotation.y = player.rotationY;

      const defaultAnim = charType === 'Merc' ? 'Draw' : 'Idle';
      visual.playAnimation(player.anim ?? defaultAnim);

      const remoteEntry: RemotePlayer = {
        visual,
        characterType: charType,
        targetPos: new Vector3(player.x, player.y, player.z),
        targetRotY: player.rotationY,
        targetAnim: player.anim ?? defaultAnim,
      };
      this.remotePlayers.set(sessionId, remoteEntry);

      const onPlayerChange = (): void => {
        const updatedType = normalizeCharacterType(player.characterType);
        if (updatedType !== remoteEntry.characterType) {
          const prevPos = remoteEntry.visual.root.position.clone();
          const prevRotY = remoteEntry.visual.root.rotation.y;
          remoteEntry.visual.dispose();

          const newVisual = this.createRemoteVisual(sessionId, updatedType);
          newVisual.root.position.copyFrom(prevPos);
          newVisual.root.rotation.y = prevRotY;
          remoteEntry.visual = newVisual;
          remoteEntry.characterType = updatedType;
        }

        remoteEntry.targetPos.set(player.x, player.y, player.z);
        remoteEntry.targetRotY = player.rotationY;
        if (player.anim) {
          remoteEntry.targetAnim = player.anim;
        }
      };

      if ($) {
        const playerProxy = $(player);
        if (playerProxy && typeof playerProxy.onChange === 'function') {
          playerProxy.onChange(onPlayerChange);
        }
      } else if (typeof player.onChange === 'function') {
        player.onChange(onPlayerChange);
      } else {
        (player as unknown as { onChange: () => void }).onChange =
          onPlayerChange;
      }
    };

    const handleRemove = (
      _player: SyncedPlayerState,
      sessionId: string
    ): void => {
      const remote = this.remotePlayers.get(sessionId);
      if (!remote) return;
      remote.visual.dispose();
      this.remotePlayers.delete(sessionId);
    };

    if (typeof playersProxy.onAdd === 'function') {
      playersProxy.onAdd(handleAdd);
    } else {
      (playersProxy as unknown as { onAdd: typeof handleAdd }).onAdd =
        handleAdd;
    }

    if (typeof playersProxy.onRemove === 'function') {
      playersProxy.onRemove(handleRemove);
    } else {
      (playersProxy as unknown as { onRemove: typeof handleRemove }).onRemove =
        handleRemove;
    }
  }

  /**
   * Sends local player movement/animation/shoot updates to Colyseus and
   * smoothly interpolates remote character models.
   */
  public update(dtSeconds: number): void {
    const pendingShots = this.localPlayer.consumePendingShots();

    if (this.room) {
      for (const shot of pendingShots) {
        this.room.send('shoot', shot);
      }

      const pos = this.localPlayer.mesh.position;
      const rotY = this.localPlayer.rotationY;
      const anim = this.localPlayer.currentAnim;

      if (this.localPlayer.consumeJumpEvent()) {
        this.room.send('jump', { y: pos.y, anim });
      }

      const dx = pos.x - this.lastSentX;
      const dy = pos.y - this.lastSentY;
      const dz = pos.z - this.lastSentZ;
      const dRot = Math.abs(rotY - this.lastSentRotY);
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq > 0.0004 || dRot > 0.01 || anim !== this.lastSentAnim) {
        this.room.send('move', {
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

    const lerpFactor = Math.min(1.0, dtSeconds * 16.0);
    for (const remote of this.remotePlayers.values()) {
      const currentPos = remote.visual.root.position;
      const distSq = Vector3.DistanceSquared(currentPos, remote.targetPos);

      Vector3.LerpToRef(currentPos, remote.targetPos, lerpFactor, currentPos);
      remote.visual.root.rotation.y = lerpAngleY(
        remote.visual.root.rotation.y,
        remote.targetRotY,
        lerpFactor
      );

      if (remote.characterType === 'Merc') {
        remote.visual.playAnimation(remote.targetAnim || 'Idle');
      } else {
        const animToPlay =
          remote.targetAnim || (distSq > 0.002 ? 'Walk' : 'Idle');
        remote.visual.playAnimation(animToPlay);
      }
    }
  }
}
