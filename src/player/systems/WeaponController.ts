/**
 * M4A1 ammunition state, tactical reloading, automatic firing cycle, and ballistics coordination.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { RAPIER } from '../../physics';
import type { CombatEffectsManager } from '../../combat';
import { updateAmmoHud as uiUpdateAmmoHud } from '../../ui';
import {
  MAGAZINE_CAPACITY,
  INITIAL_RESERVE_MAGAZINES,
  BURST_SMOKE_THRESHOLD,
} from '../../config/weapons';
import type { CharacterVisual, NetworkShotEvent } from '../types';
import type { ViewmodelMotion } from './ViewmodelMotion';

export class WeaponController {
  public currentMagazineRounds = MAGAZINE_CAPACITY;
  public readonly reserveMagazines: number[] = [];
  public readonly pendingShots: NetworkShotEvent[] = [];
  public fireCooldown = 0;
  public burstShotsFired = 0;

  constructor() {
    this.initMagazines();
  }

  private initMagazines(): void {
    this.reserveMagazines.length = 0;
    for (let i = 0; i < INITIAL_RESERVE_MAGAZINES; i++) {
      this.reserveMagazines.push(MAGAZINE_CAPACITY);
    }
  }

  /**
   * Resets ammunition to full loaded magazine and 4 full reserves.
   */
  public resetAmmo(): void {
    this.currentMagazineRounds = MAGAZINE_CAPACITY;
    this.initMagazines();
    this.updateAmmoHud();
  }

  /**
   * Pushes current magazine and reserve count to the UI ammunition HUD.
   */
  public updateAmmoHud(): void {
    uiUpdateAmmoHud(this.currentMagazineRounds, this.reserveMagazines.length);
  }

  /**
   * Drains pending replicated network shot events.
   */
  public consumePendingShots(): NetworkShotEvent[] {
    if (this.pendingShots.length === 0) return [];
    return this.pendingShots.splice(0, this.pendingShots.length);
  }

  /**
   * Discards the active magazine and loads the next one from reserves if eligible.
   */
  public tryTacticalReload(
    visual: CharacterVisual,
    onReloadStarted: () => void
  ): boolean {
    const anim = visual.getCurrentAnimation();
    if (anim === 'Reload' || anim === 'Draw') {
      return false;
    }
    if (this.reserveMagazines.length <= 0) {
      return false;
    }

    const started = visual.triggerReload?.() ?? false;
    if (!started) return false;

    onReloadStarted();

    const nextMagRounds = this.reserveMagazines.shift() ?? MAGAZINE_CAPACITY;
    this.currentMagazineRounds = nextMagRounds;
    this.updateAmmoHud();
    return true;
  }

  /**
   * Emits lingering barrel smoke if firing burst length exceeded the smoke threshold.
   */
  public stopFiringBurstIfNeeded(
    combatEffects: CombatEffectsManager,
    muzzleNode?: TransformNode | null
  ): void {
    if (this.burstShotsFired >= BURST_SMOKE_THRESHOLD) {
      combatEffects.spawnBarrelSmoke(muzzleNode ?? null);
    }
    this.burstShotsFired = 0;
  }

  /**
   * Fires a single round: decrements ammo, traces aim ray, spawns projectile & flash,
   * triggers procedural recoil kick, and queues network replication packet.
   */
  public fireSingleRound(params: {
    world: RAPIER.World;
    body: RAPIER.RigidBody;
    fpCamera: FreeCamera;
    visual: CharacterVisual;
    combatEffects: CombatEffectsManager;
    viewmodelMotion: ViewmodelMotion;
    pitchX: number;
    rotationY: number;
    onAdjustPitch: (delta: number) => void;
  }): void {
    const {
      world,
      body,
      fpCamera,
      visual,
      combatEffects,
      viewmodelMotion,
      pitchX,
      rotationY,
      onAdjustPitch,
    } = params;

    this.currentMagazineRounds = Math.max(0, this.currentMagazineRounds - 1);
    this.burstShotsFired++;
    this.updateAmmoHud();

    // Ensure camera world matrix is fresh before sampling
    fpCamera.computeWorldMatrix();
    const muzzleNode = visual.muzzleNode;
    let muzzleOrigin: Vector3;
    if (muzzleNode) {
      muzzleNode.computeWorldMatrix(true);
      muzzleOrigin = muzzleNode.getAbsolutePosition().clone();
    } else {
      muzzleOrigin = fpCamera.position.clone();
    }

    // Camera center aim ray
    const camPos = fpCamera.position;
    const totalPitch = pitchX + viewmodelMotion.camRecoilPitch;
    const totalYaw = rotationY + viewmodelMotion.camRecoilYaw;
    const cosP = Math.cos(totalPitch);
    const aimDir = new Vector3(
      Math.sin(totalYaw) * cosP,
      -Math.sin(totalPitch),
      Math.cos(totalYaw) * cosP
    ).normalize();

    const aimRay = new RAPIER.Ray(
      { x: camPos.x, y: camPos.y, z: camPos.z },
      { x: aimDir.x, y: aimDir.y, z: aimDir.z }
    );
    const hit = world.castRay(
      aimRay,
      150.0,
      true,
      undefined,
      undefined,
      undefined,
      body
    );

    const targetDist =
      hit !== null && hit.timeOfImpact > 1.2 ? hit.timeOfImpact : 120.0;
    const targetPoint = new Vector3(
      camPos.x + aimDir.x * targetDist,
      camPos.y + aimDir.y * targetDist,
      camPos.z + aimDir.z * targetDist
    );

    const bulletDir = targetPoint.subtract(muzzleOrigin).normalize();

    // 1. Single-frame randomized muzzle flash at barrel tip
    combatEffects.triggerSingleFrameMuzzleFlash(visual.muzzleFlashMesh);

    // 2. Spawn bullet projectile
    combatEffects.spawnBullet(muzzleOrigin, bulletDir, body);

    // 3. Queue network packet
    this.pendingShots.push({
      originX: muzzleOrigin.x,
      originY: muzzleOrigin.y,
      originZ: muzzleOrigin.z,
      dirX: bulletDir.x,
      dirY: bulletDir.y,
      dirZ: bulletDir.z,
    });

    // 4. Procedural Recoil Kick
    viewmodelMotion.applyRecoilKick(onAdjustPitch);

    if (this.currentMagazineRounds === 0) {
      this.stopFiringBurstIfNeeded(combatEffects, visual.muzzleNode);
    }
  }

  /**
   * Advances weapon firing interval timer.
   */
  public updateCooldown(dtSeconds: number): void {
    this.fireCooldown = Math.max(0, this.fireCooldown - dtSeconds);
  }
}
