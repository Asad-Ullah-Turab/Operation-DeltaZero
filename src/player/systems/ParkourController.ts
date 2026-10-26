/**
 * Ledge detection, raycast probing, and procedural hang-to-crouch mantling animation curves.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { RAPIER } from '../../physics';
import { PLAYER_HALF_HEIGHT } from '../../config/arena';
import type { CharacterVisual } from '../types';

export interface LedgeInfo {
  ledgeTopY: number;
  edgeX: number;
  edgeZ: number;
  facingDir: Vector3;
}

export class ParkourController {
  public isClimbing = false;
  public climbElapsed = 0;
  public climbDuration = 1.15;
  public readonly climbStartPos = new Vector3();
  public readonly climbTargetPos = new Vector3();

  /**
   * Casts forward, downward, and upward clearance rays to detect whether a climbable
   * ledge (waist height 1.0m to 2.95m) exists directly in front of the character.
   */
  public checkClimbableLedge(
    world: RAPIER.World,
    body: RAPIER.RigidBody,
    rotationY: number
  ): LedgeInfo | null {
    const pos = body.translation();
    const feetY = pos.y - PLAYER_HALF_HEIGHT;

    // Facing direction vector of character
    const facingDir = new Vector3(
      Math.sin(rotationY),
      0,
      Math.cos(rotationY)
    ).normalize();

    // 1. Cast forward horizontal rays at multiple heights to find obstacle front wall
    const testHeights = [0.5, 1.0, 1.5, 2.0, 2.5];
    let closestHitDist = Number.POSITIVE_INFINITY;
    const maxForwardReach = 1.35; // Player radius 0.55m + ~0.8m arm reach

    for (const h of testHeights) {
      const rayOrigin = {
        x: pos.x,
        y: feetY + h,
        z: pos.z,
      };
      const rayDir = {
        x: facingDir.x,
        y: 0,
        z: facingDir.z,
      };
      const ray = new RAPIER.Ray(rayOrigin, rayDir);
      const hit = world.castRay(
        ray,
        maxForwardReach,
        true,
        undefined,
        undefined,
        undefined,
        body
      );
      if (hit !== null && hit.timeOfImpact < closestHitDist) {
        closestHitDist = hit.timeOfImpact;
      }
    }

    if (!Number.isFinite(closestHitDist) || closestHitDist > maxForwardReach) {
      return null;
    }

    // 2. Cast downward ray from above the max obstacle height (probe slightly past front edge)
    const probeDist = closestHitDist + 0.25;
    const probeX = pos.x + facingDir.x * probeDist;
    const probeZ = pos.z + facingDir.z * probeDist;

    const maxCheckY = feetY + 3.1;
    const downRay = new RAPIER.Ray(
      { x: probeX, y: maxCheckY, z: probeZ },
      { x: 0, y: -1, z: 0 }
    );
    const downHit = world.castRay(
      downRay,
      2.7,
      true,
      undefined,
      undefined,
      undefined,
      body
    );

    if (downHit === null) {
      return null;
    }

    const ledgeTopY = maxCheckY - downHit.timeOfImpact;
    const climbHeight = ledgeTopY - feetY;

    // Waist height (~1.0m) up to 1.7x body size (~2.95m)
    const WAIST_HEIGHT = 1.0;
    const MAX_CLIMB_HEIGHT = 2.95;
    if (climbHeight < WAIST_HEIGHT || climbHeight > MAX_CLIMB_HEIGHT) {
      return null;
    }

    // 3. Headroom clearance check
    const upRay = new RAPIER.Ray(
      { x: probeX, y: ledgeTopY + 0.1, z: probeZ },
      { x: 0, y: 1, z: 0 }
    );
    const upHit = world.castRay(
      upRay,
      1.6,
      true,
      undefined,
      undefined,
      undefined,
      body
    );
    if (upHit !== null) {
      return null;
    }

    return {
      ledgeTopY,
      edgeX: pos.x + facingDir.x * closestHitDist,
      edgeZ: pos.z + facingDir.z * closestHitDist,
      facingDir,
    };
  }

  /**
   * Initializes mantling state: sets hang start position, platform target position,
   * wall facing orientation, and triggers hang-to-crouch animation.
   */
  public startLedgeClimb(params: {
    ledge: LedgeInfo;
    body: RAPIER.RigidBody;
    visual: CharacterVisual;
    onOrientToWall: (rotY: number) => void;
  }): void {
    const { ledge, body, visual, onOrientToWall } = params;

    this.isClimbing = true;
    this.climbElapsed = 0;
    this.climbDuration = 1.15;

    // 0.525m below ledgeTopY and 0.51m back from edge
    const hangStartX = ledge.edgeX - ledge.facingDir.x * 0.51;
    const hangStartY = ledge.ledgeTopY - 0.525;
    const hangStartZ = ledge.edgeZ - ledge.facingDir.z * 0.51;
    this.climbStartPos.set(hangStartX, hangStartY, hangStartZ);

    // Final landing position on top of the ledge
    const targetX = ledge.edgeX + ledge.facingDir.x * 0.45;
    const targetY = ledge.ledgeTopY + PLAYER_HALF_HEIGHT;
    const targetZ = ledge.edgeZ + ledge.facingDir.z * 0.45;
    this.climbTargetPos.set(targetX, targetY, targetZ);

    // Orient character towards the wall
    const wallRotY = Math.atan2(ledge.facingDir.x, ledge.facingDir.z);
    onOrientToWall(wallRotY);

    // Place body at hang start
    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setTranslation({ x: hangStartX, y: hangStartY, z: hangStartZ }, true);

    visual.playAnimation('hang-to-crouch');
  }

  /**
   * Steps the two-phase mantling interpolation curve:
   * 0-50%: hang at start position while arms pull up
   * 50-100%: smoothstep root translation to ledge surface
   */
  public updateClimbing(params: {
    dtSeconds: number;
    body: RAPIER.RigidBody;
    mesh: Mesh;
    rotationY: number;
    visual: CharacterVisual;
    moveDir: Vector3;
    camForward: Vector3;
    camRight: Vector3;
    camAlpha: number;
    onClimbFinished: () => void;
  }): boolean {
    if (!this.isClimbing) return false;

    const {
      dtSeconds,
      body,
      mesh,
      rotationY,
      visual,
      moveDir,
      camForward,
      camRight,
      camAlpha,
      onClimbFinished,
    } = params;

    this.climbElapsed += dtSeconds;
    const p = Math.min(1.0, this.climbElapsed / this.climbDuration);

    let curX = this.climbStartPos.x;
    let curY = this.climbStartPos.y;
    let curZ = this.climbStartPos.z;

    if (p > 0.5) {
      const t = (p - 0.5) / 0.5;
      const s = t * t * (3 - 2 * t);
      curX =
        this.climbStartPos.x +
        (this.climbTargetPos.x - this.climbStartPos.x) * s;
      curY =
        this.climbStartPos.y +
        (this.climbTargetPos.y - this.climbStartPos.y) * s;
      curZ =
        this.climbStartPos.z +
        (this.climbTargetPos.z - this.climbStartPos.z) * s;
    }

    body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    body.setTranslation({ x: curX, y: curY, z: curZ }, true);

    mesh.position.set(curX, curY, curZ);
    mesh.rotation.y = rotationY;

    visual.updateAnimation?.(dtSeconds, {
      isMoving: false,
      isStrafing: false,
      moveDir,
      camForward,
      camRight,
      camAlpha,
      rotationY,
      isCrouched: true,
      isClimbing: true,
      isGrounded: false,
    });

    if (p >= 1.0) {
      this.isClimbing = false;
      body.setTranslation(
        {
          x: this.climbTargetPos.x,
          y: this.climbTargetPos.y,
          z: this.climbTargetPos.z,
        },
        true
      );
      body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      visual.playAnimation('crouch-idle');
      onClimbFinished();
    }

    return true;
  }

  /**
   * Resets climb state on death or respawn.
   */
  public reset(): void {
    this.isClimbing = false;
    this.climbElapsed = 0;
  }
}

