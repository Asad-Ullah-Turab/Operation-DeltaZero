/**
 * Manages remote player avatar instantiation, Rapier kinematic hitboxes, and spatial interpolation.
 */

import { Scene } from '@babylonjs/core/scene';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { RAPIER } from '../physics';
import { PLAYER_HALF_HEIGHT, PLAYER_RADIUS } from '../config/arena';
import { lerpAngleY } from '../utils/math';
import { sanitizeCharacterType } from '../../shared';
import type { CharacterAssets } from '../player';
import type { RemotePlayer, SyncedPlayerState } from './types';
import { createRemoteVisual } from './remoteVisuals';

export class RemotePlayerManager {
  private readonly remotePlayers = new Map<string, RemotePlayer>();

  public get(sessionId: string): RemotePlayer | undefined {
    return this.remotePlayers.get(sessionId);
  }

  public values(): IterableIterator<RemotePlayer> {
    return this.remotePlayers.values();
  }

  /**
   * Spawns a remote player visual mesh and kinematic Rapier hitbox collider.
   */
  public spawnPlayer(
    sessionId: string,
    player: SyncedPlayerState,
    scene: Scene,
    assets: CharacterAssets,
    world?: RAPIER.World
  ): RemotePlayer {
    const charType = sanitizeCharacterType(player.characterType);
    const visual = createRemoteVisual(sessionId, charType, scene, assets);
    visual.root.position.set(player.x, player.y, player.z);
    visual.root.rotation.y = player.rotationY;

    const defaultAnim = charType === 'Merc' ? 'idle-aiming' : 'Idle';
    visual.playAnimation(player.anim ?? defaultAnim);

    let remoteBody: RAPIER.RigidBody | undefined;
    if (world) {
      const bodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        player.x,
        player.y,
        player.z
      );
      remoteBody = world.createRigidBody(bodyDesc);
      const colDesc = RAPIER.ColliderDesc.cylinder(
        PLAYER_HALF_HEIGHT,
        PLAYER_RADIUS
      );
      world.createCollider(colDesc, remoteBody);
    }

    const remoteEntry: RemotePlayer = {
      visual,
      characterType: charType,
      targetPos: new Vector3(player.x, player.y, player.z),
      targetRotY: player.rotationY,
      targetAnim: player.anim ?? defaultAnim,
      body: remoteBody,
    };

    if (remoteBody) {
      (remoteBody as unknown as { userData?: unknown }).userData = {
        isRemote: true,
        sessionId,
        remotePlayer: remoteEntry,
        characterType: charType,
      };
    }

    this.remotePlayers.set(sessionId, remoteEntry);
    return remoteEntry;
  }

  /**
   * Recreates the visual avatar when the remote player switches character class.
   */
  public updateClassVisual(
    sessionId: string,
    remoteEntry: RemotePlayer,
    newType: ReturnType<typeof sanitizeCharacterType>,
    scene: Scene,
    assets: CharacterAssets
  ): void {
    const prevPos = remoteEntry.visual.root.position.clone();
    const prevRotY = remoteEntry.visual.root.rotation.y;
    remoteEntry.visual.dispose();

    const newVisual = createRemoteVisual(sessionId, newType, scene, assets);
    newVisual.root.position.copyFrom(prevPos);
    newVisual.root.rotation.y = prevRotY;
    remoteEntry.visual = newVisual;
    remoteEntry.characterType = newType;

    if (remoteEntry.body) {
      (remoteEntry.body as unknown as { userData?: unknown }).userData = {
        isRemote: true,
        sessionId,
        remotePlayer: remoteEntry,
        characterType: newType,
      };
    }
  }

  /**
   * Despawns and cleans up a remote player mesh and physics body.
   */
  public removePlayer(sessionId: string, world?: RAPIER.World): void {
    const remote = this.remotePlayers.get(sessionId);
    if (!remote) return;
    if (remote.body && world) {
      world.removeRigidBody(remote.body);
    }
    remote.visual.dispose();
    this.remotePlayers.delete(sessionId);
  }

  /**
   * Interpolates remote player positions and rotations toward their latest synced state.
   */
  public interpolate(dtSeconds: number): void {
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

      if (remote.body) {
        remote.body.setNextKinematicTranslation({
          x: currentPos.x,
          y: currentPos.y,
          z: currentPos.z,
        });
      }

      if (remote.characterType === 'Merc') {
        const isMoving = distSq > 0.002 || remote.targetAnim === 'walking';
        let animToPlay = remote.targetAnim;
        if (!animToPlay || animToPlay === 'Idle' || animToPlay === 'idle-aiming' || animToPlay === 'walking') {
          animToPlay = isMoving ? 'walking' : 'idle-aiming';
        }
        remote.visual.playAnimation(animToPlay);
      } else {
        const animToPlay =
          remote.targetAnim || (distSq > 0.002 ? 'Walk' : 'Idle');
        remote.visual.playAnimation(animToPlay);
      }
    }
  }
}

