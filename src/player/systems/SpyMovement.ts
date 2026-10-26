/**
 * Third-person Spy operative movement, camera-aligned strafing, and crouch state transitions.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { RAPIER, isPlayerGrounded } from '../../physics';
import {
  WALK_SPEED,
  RUN_SPEED,
  CROUCH_SPEED,
  JUMP_IMPULSE,
  TURN_SMOOTH_SPEED,
} from '../../config/weapons';
import { lerpAngleY } from '../../utils/math';
import type { CharacterVisual } from '../types';
import type { ParkourController } from './ParkourController';

export interface SpyMovementContext {
  body: RAPIER.RigidBody;
  mesh: Mesh;
  visual: CharacterVisual;
  world: RAPIER.World;
  parkourController: ParkourController;
  keys: Record<string, boolean>;
  rotationY: number;
  targetRotationY: number;
  jumpRequested: boolean;
  isRightClickHeld: boolean;
  isCrouchToggled: boolean;
  forwardScratch: Vector3;
  rightScratch: Vector3;
  moveDirScratch: Vector3;
  onSetSpawnPosition: (x: number, y: number, z: number, rotationY: number) => void;
  onOrientCharacter: (rotationY: number, targetRotationY: number) => void;
  onJumpConsumed: () => void;
  onCrouchChanged: (isCrouched: boolean) => void;
}

export function toggleSpyCrouch(
  isClimbing: boolean,
  isCrouchToggled: boolean,
  keys: Record<string, boolean>,
  visual: CharacterVisual,
  onCrouchChanged: (isCrouched: boolean) => void
): void {
  if (isClimbing) return;
  const newCrouch = !isCrouchToggled;
  onCrouchChanged(newCrouch);

  const isMoveKeyHeld = Boolean(
    keys['KeyW'] ||
      keys['KeyS'] ||
      keys['KeyA'] ||
      keys['KeyD'] ||
      keys['ArrowUp'] ||
      keys['ArrowDown'] ||
      keys['ArrowLeft'] ||
      keys['ArrowRight']
  );

  if (newCrouch) {
    if (isMoveKeyHeld) {
      visual.playAnimation('crouched-walking');
    } else {
      visual.playAnimation('stand-to-crouch');
    }
  } else {
    if (isMoveKeyHeld) {
      visual.playAnimation('walking');
    } else {
      visual.playAnimation('crouch-to-stand');
    }
  }
}

export function updateSpyThirdPerson(
  ctx: SpyMovementContext,
  camera: ArcRotateCamera | null,
  dtSeconds: number
): string {
  const {
    body,
    mesh,
    visual,
    world,
    parkourController,
    keys,
    isRightClickHeld,
    forwardScratch,
    rightScratch,
    moveDirScratch,
    onSetSpawnPosition,
    onOrientCharacter,
    onJumpConsumed,
    onCrouchChanged,
  } = ctx;

  let rotationY = ctx.rotationY;
  let targetRotationY = ctx.targetRotationY;

  const alpha = camera ? camera.alpha : -Math.PI / 2;
  forwardScratch.set(-Math.cos(alpha), 0, -Math.sin(alpha));
  forwardScratch.normalize();

  Vector3.CrossToRef(Vector3.UpReadOnly, forwardScratch, rightScratch);
  rightScratch.normalize();

  // 1. Dynamic Ledge Climb Update
  if (parkourController.isClimbing) {
    parkourController.updateClimbing({
      dtSeconds,
      body,
      mesh,
      rotationY,
      visual,
      moveDir: moveDirScratch,
      camForward: forwardScratch,
      camRight: rightScratch,
      camAlpha: alpha,
      onClimbFinished: () => {
        onCrouchChanged(true);
      },
    });
    return visual.getCurrentAnimation();
  }

  // 2. Normal Locomotion Input
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

  const isCrouched = ctx.isCrouchToggled;
  const isSprinting =
    !isCrouched && Boolean(keys['ShiftLeft'] || keys['ShiftRight']);
  const moveSpeed = isCrouched
    ? CROUCH_SPEED
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

  let grounded = isPlayerGrounded(world, body);
  if (ctx.jumpRequested) {
    onJumpConsumed();
    if (grounded && !isCrouched) {
      const ledge = parkourController.checkClimbableLedge(
        world,
        body,
        rotationY
      );
      if (ledge) {
        parkourController.startLedgeClimb({
          ledge,
          body,
          visual,
          onOrientToWall: (wallRotY) => {
            rotationY = wallRotY;
            targetRotationY = wallRotY;
            onOrientCharacter(wallRotY, wallRotY);
          },
        });
        return visual.getCurrentAnimation();
      } else {
        body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
        grounded = false;
        visual.playAnimation('jump');
      }
    }
  }

  // Character rotation & heading
  const camAngle = Math.atan2(forwardScratch.x, forwardScratch.z);
  if (isRightClickHeld) {
    targetRotationY = camAngle;
    rotationY = lerpAngleY(rotationY, targetRotationY, dtSeconds * 20.0);
    onOrientCharacter(rotationY, targetRotationY);
  } else if (isMovingHorizontally) {
    targetRotationY = Math.atan2(moveDirScratch.x, moveDirScratch.z);
    rotationY = lerpAngleY(
      rotationY,
      targetRotationY,
      dtSeconds * TURN_SMOOTH_SPEED
    );
    onOrientCharacter(rotationY, targetRotationY);
  }

  // Update animations via the weighted blend state machine
  visual.updateAnimation?.(dtSeconds, {
    isMoving: isMovingHorizontally,
    isStrafing: isRightClickHeld,
    moveDir: moveDirScratch,
    camForward: forwardScratch,
    camRight: rightScratch,
    camAlpha: alpha,
    rotationY,
    isCrouched,
    isClimbing: false,
    isGrounded: grounded,
  });

  const pos = body.translation();
  if (pos.y < -15) {
    onSetSpawnPosition(0, 3, 0, 0);
    return visual.getCurrentAnimation();
  }

  mesh.position.set(pos.x, pos.y, pos.z);
  mesh.rotation.y = rotationY;

  return visual.getCurrentAnimation();
}

