/**
 * Colyseus state listeners and incoming network message event handlers.
 */

import * as Colyseus from 'colyseus.js';
import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RAPIER } from '../physics';
import {
  sanitizeCharacterType,
  MSG_PLAYER_SHOOT,
  MSG_TAKE_DAMAGE,
  MSG_PLAYER_DIED,
  MSG_PLAYER_RESPAWNED,
  type PlayerShootPayload,
  type TakeDamagePayload,
  type PlayerDiedMessage,
  type PlayerRespawnedPayload,
} from '../../shared';
import type { LocalPlayer, CharacterAssets } from '../player';
import type { CombatEffectsManager } from '../combat';
import type { SyncedRoomState, SyncedPlayerState } from './types';
import type { RemotePlayerManager } from './RemotePlayerManager';

export interface RoomHandlerContext {
  scene: Scene;
  localPlayer: LocalPlayer;
  assets: CharacterAssets;
  combatEffects: CombatEffectsManager;
  world?: RAPIER.World;
  remotePlayerManager: RemotePlayerManager;
  onLocalSpawn: (x: number, y: number, z: number, rotationY: number) => void;
}

/**
 * Binds the remote player weapon firing message listener.
 */
function bindShootHandler(
  room: Colyseus.Room<SyncedRoomState>,
  remoteManager: RemotePlayerManager,
  combatEffects: CombatEffectsManager,
  localPlayer: LocalPlayer
): void {
  room.onMessage(MSG_PLAYER_SHOOT, (payload: PlayerShootPayload) => {
    if (!payload || typeof payload !== 'object') return;
    const remote = remoteManager.get(payload.sessionId);

    let shotOrigin = new Vector3(
      payload.originX,
      payload.originY,
      payload.originZ
    );

    if (remote) {
      if (remote.visual.muzzleFlashMesh) {
        combatEffects.triggerSingleFrameMuzzleFlash(
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
      combatEffects.spawnBullet(shotOrigin, shotDir, localPlayer.body);
    }
  });
}

/**
 * Binds authoritative damage event listener on local player.
 */
function bindDamageHandler(
  room: Colyseus.Room<SyncedRoomState>,
  localPlayer: LocalPlayer
): void {
  room.onMessage(MSG_TAKE_DAMAGE, (payload: TakeDamagePayload) => {
    if (!payload || typeof payload.damage !== 'number') return;
    if (localPlayer && !localPlayer.isDead) {
      localPlayer.takeDamage(payload.damage, payload.zone ?? 'torso');
    }
  });
}

/**
 * Binds remote player elimination listener.
 */
function bindDeathHandler(
  room: Colyseus.Room<SyncedRoomState>,
  remoteManager: RemotePlayerManager
): void {
  room.onMessage(MSG_PLAYER_DIED, (payload: PlayerDiedMessage) => {
    if (!payload || !payload.sessionId) return;
    const remote = remoteManager.get(payload.sessionId);
    if (remote) {
      remote.visual.root.setEnabled(false);
    }
  });
}

/**
 * Binds remote player respawn listener.
 */
function bindRespawnHandler(
  room: Colyseus.Room<SyncedRoomState>,
  remoteManager: RemotePlayerManager
): void {
  room.onMessage(MSG_PLAYER_RESPAWNED, (payload: PlayerRespawnedPayload) => {
    if (!payload || !payload.sessionId) return;
    const remote = remoteManager.get(payload.sessionId);
    if (remote) {
      remote.visual.root.setEnabled(true);
      remote.visual.root.position.set(payload.x, payload.y, payload.z);
      remote.targetPos.set(payload.x, payload.y, payload.z);
      if (remote.body) {
        remote.body.setTranslation(
          { x: payload.x, y: payload.y, z: payload.z },
          true
        );
      }
    }
  });
}

/**
 * Subscribes to player add/remove and transform change listeners on room schema.
 */
function bindPlayerStateHandlers(
  room: Colyseus.Room<SyncedRoomState>,
  ctx: RoomHandlerContext
): void {
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
      ctx.onLocalSpawn(player.x, player.y, player.z, player.rotationY);
      return;
    }

    const remoteEntry = ctx.remotePlayerManager.spawnPlayer(
      sessionId,
      player,
      ctx.scene,
      ctx.assets,
      ctx.world
    );

    const onPlayerChange = (): void => {
      const updatedType = sanitizeCharacterType(player.characterType);
      if (updatedType !== remoteEntry.characterType) {
        ctx.remotePlayerManager.updateClassVisual(
          sessionId,
          remoteEntry,
          updatedType,
          ctx.scene,
          ctx.assets
        );
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
      (player as unknown as { onChange: () => void }).onChange = onPlayerChange;
    }
  };

  const handleRemove = (_player: SyncedPlayerState, sessionId: string): void => {
    ctx.remotePlayerManager.removePlayer(sessionId, ctx.world);
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
 * Registers all incoming network listeners and state bindings for the connected room.
 */
export function bindStateHandlers(
  room: Colyseus.Room<SyncedRoomState>,
  ctx: RoomHandlerContext
): void {
  bindShootHandler(room, ctx.remotePlayerManager, ctx.combatEffects, ctx.localPlayer);
  bindDamageHandler(room, ctx.localPlayer);
  bindDeathHandler(room, ctx.remotePlayerManager);
  bindRespawnHandler(room, ctx.remotePlayerManager);
  bindPlayerStateHandlers(room, ctx);
}

