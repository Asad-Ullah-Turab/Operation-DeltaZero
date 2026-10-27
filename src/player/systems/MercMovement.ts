/**
 * First-person mercenary movement, locomotion velocity stepping, and jump impulses.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { RAPIER, isPlayerGrounded } from '../../physics';
import {
  WALK_SPEED,
  RUN_SPEED,
  CROUCH_SPEED,
  ADS_WALK_SPEED,
  JUMP_IMPULSE,
  FIRE_INTERVAL_SECONDS,
} from '../../config/weapons';
import type { CharacterVisual } from '../types';
import type { ViewmodelMotion } from './ViewmodelMotion';
import type { WeaponController } from './WeaponController';

export interface MercMovementContext {
  body: RAPIER.RigidBody;
  mesh: Mesh;
  fpCamera: FreeCamera | null;
  viewmodelRig: TransformNode | null;
  visual: CharacterVisual;
  world: RAPIER.World;
  viewmodelMotion: ViewmodelMotion;
  weaponController: WeaponController;
  keys: Record<string, boolean>;
  rotationY: number;
  pitchX: number;
  jumpRequested: boolean;
  isFiringHeld: boolean;
  isAdsHeld: boolean;
  isAdsToggled: boolean;
  lookDeltaX: number;
  lookDeltaY: number;
  wasGrounded: boolean;
  forwardScratch: Vector3;
  rightScratch: Vector3;
  moveDirScratch: Vector3;
  onSetSpawnPosition: (x: number, y: number, z: number, rotationY: number) => void;
  onFireSingleRound: () => void;
  onJumpConsumed: () => void;
  onDecayLookDeltas: (decay: number) => void;
}

export function updateMercFirstPerson(
  ctx: MercMovementContext,
  dtSeconds: number
): {
  wasGrounded: boolean;
  currentAnim: string;
} {
  const {
    body,
    mesh,
    fpCamera,
    viewmodelRig,
    visual,
    world,
    viewmodelMotion,
    weaponController,
    keys,
    rotationY,
    pitchX,
    isFiringHeld,
    isAdsHeld,
    isAdsToggled,
    lookDeltaX,
    lookDeltaY,
    forwardScratch,
    rightScratch,
    moveDirScratch,
    onSetSpawnPosition,
    onFireSingleRound,
    onJumpConsumed,
    onDecayLookDeltas,
  } = ctx;

  let wasGrounded = ctx.wasGrounded;

  // 1. Forward and right vectors relative to first-person yaw (rotationY)
  const sinY = Math.sin(rotationY);
  const cosY = Math.cos(rotationY);
  forwardScratch.set(sinY, 0, cosY);
  rightScratch.set(cosY, 0, -sinY);

  // 2. Accumulate WASD movement input
  moveDirScratch.set(0, 0, 0);
  if (keys['KeyW'] || keys['ArrowUp']) {
    moveDirScratch.addInPlace(forwardScratch);
  }
  if (keys['KeyS'] || keys['ArrowDown']) {
    moveDirScratch.subtractInPlace(forwardScratch);
  }
  if (keys['KeyD'] || keys['ArrowRight']) {
    moveDirScratch.addInPlace(rightScratch);
  }
  if (keys['KeyA'] || keys['ArrowLeft']) {
    moveDirScratch.subtractInPlace(rightScratch);
  }

  const visualAnim = visual.getCurrentAnimation();
  const canAimOrFire =
    visualAnim !== 'Reload' &&
    visualAnim !== 'Draw' &&
    visualAnim !== 'Hide' &&
    visualAnim !== 'Hidden';

  const wantsAds = canAimOrFire && (isAdsHeld || isAdsToggled);
  const isCrouching = Boolean(
    keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC']
  );
  const isSprinting =
    !isCrouching &&
    !wantsAds &&
    Boolean(keys['ShiftLeft'] || keys['ShiftRight']);

  const moveSpeed = isCrouching
    ? CROUCH_SPEED
    : wantsAds
      ? ADS_WALK_SPEED
      : isSprinting
        ? RUN_SPEED
        : WALK_SPEED;
  const isMovingHorizontally = moveDirScratch.lengthSquared() > 0.0001;

  const currentVel = body.linvel();
  let vx = 0;
  let vz = 0;

  if (isMovingHorizontally) {
    moveDirScratch.normalize();
    vx = moveDirScratch.x * moveSpeed;
    vz = moveDirScratch.z * moveSpeed;
  }

  body.setLinvel({ x: vx, y: currentVel.y, z: vz }, true);

  // 3. Spacebar Jump & Landing detection
  let grounded = isPlayerGrounded(world, body);
  if (ctx.jumpRequested) {
    if (grounded && !isCrouching) {
      body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
      onJumpConsumed();
      grounded = false;
      viewmodelMotion.jumpLagY = -0.016;
      viewmodelMotion.jumpPitchX = 0.022;
    }
  }

  if (!wasGrounded && grounded) {
    viewmodelMotion.landSpringVelY = -0.18;
  }
  wasGrounded = grounded;

  // Safety respawn if fallen off map
  const pos = body.translation();
  if (pos.y < -15) {
    onSetSpawnPosition(0, 3, 0, rotationY);
    return { wasGrounded, currentAnim: visualAnim };
  }

  // Sync collision root
  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.rotation.y = rotationY;

  // 4. Procedural ADS transition
  viewmodelMotion.updateAds(wantsAds, dtSeconds);

  // 5. Procedural Crouching & Camera Recoil Spring Recovery
  viewmodelMotion.updateCameraAndCrouch(
    isCrouching,
    pos,
    pitchX,
    rotationY,
    fpCamera,
    dtSeconds
  );

  // 6. Automatic Firing Logic
  weaponController.updateCooldown(dtSeconds);
  if (
    isFiringHeld &&
    canAimOrFire &&
    weaponController.currentMagazineRounds > 0 &&
    weaponController.fireCooldown <= 0
  ) {
    onFireSingleRound();
    weaponController.fireCooldown = FIRE_INTERVAL_SECONDS;
  }

  // 7. Viewmodel Recoil Spring Recovery
  viewmodelMotion.updateRecoilSprings(dtSeconds);

  // 8. Procedural Movement Feel + ADS + Recoil on Viewmodel Rig
  viewmodelMotion.updateViewmodelRig({
    dtSeconds,
    wantsAds,
    isCrouching,
    isSprinting,
    isMovingHorizontally,
    grounded,
    velY: body.linvel().y,
    lookDeltaX,
    lookDeltaY,
    currentAnim: visualAnim,
    pos,
    pitchX,
    rotationY,
    fpCamera,
    viewmodelRig,
  });

  const deltaDecay = Math.min(1.0, dtSeconds * 28.0);
  onDecayLookDeltas(deltaDecay);

  const networkAnim =
    weaponController.fireCooldown > 0
      ? 'shooting'
      : isMovingHorizontally
        ? 'walking'
        : 'idle-aiming';

  return { wasGrounded, currentAnim: networkAnim };
}

