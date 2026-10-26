/**
 * High-speed ballistic projectile simulation with continuous sub-frame Rapier raycasting.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { RAPIER } from '../physics';
import type { ActiveBullet, BulletHitEvent } from './types';

export const BULLET_SPEED = 145.0;
export const MAX_BULLET_DISTANCE = 160.0;

/**
 * Orients a mesh whose primary length axis is local +Y so its +Y points along `dir`.
 */
export function orientCylinderAlongDirection(mesh: Mesh, dir: Vector3): void {
  const up = dir.normalizeToNew();
  const helper =
    Math.abs(up.y) < 0.98 ? Vector3.UpReadOnly : Vector3.RightReadOnly;
  const right = Vector3.Cross(helper, up).normalize();
  const forward = Vector3.Cross(up, right).normalize();
  Vector3.RotationFromAxisToRef(right, up, forward, mesh.rotation);
}

export class BulletSimulator {
  private readonly scene: Scene;
  private readonly world: RAPIER.World;
  private readonly bulletMat: StandardMaterial;
  private readonly bullets: ActiveBullet[] = [];

  constructor(scene: Scene, world: RAPIER.World, bulletMat: StandardMaterial) {
    this.scene = scene;
    this.world = world;
    this.bulletMat = bulletMat;
  }

  /**
   * Spawns a projectile tracer cylinder moving in the specified direction.
   */
  public spawnBullet(
    origin: Vector3,
    direction: Vector3,
    ignoreBody?: RAPIER.RigidBody
  ): void {
    const dir = direction.normalizeToNew();

    const bulletMesh = MeshBuilder.CreateCylinder(
      'bullet_projectile',
      {
        height: 0.52,
        diameter: 0.032,
        tessellation: 6,
      },
      this.scene
    );
    bulletMesh.isPickable = false;
    bulletMesh.material = this.bulletMat;
    bulletMesh.position.copyFrom(origin);
    orientCylinderAlongDirection(bulletMesh, dir);

    this.bullets.push({
      mesh: bulletMesh,
      pos: origin.clone(),
      dir,
      distanceTraveled: 0,
      ignoreBody,
    });
  }

  /**
   * Advances bullets along their trajectories and tests collision against the physics world.
   */
  public update(
    dtSeconds: number,
    onHit: ((event: BulletHitEvent) => void) | null,
    onFleshHit: (point: Vector3, normal: Vector3) => void,
    onSurfaceHit: (point: Vector3, normal: Vector3) => void
  ): void {
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const stepDist = BULLET_SPEED * dtSeconds;

      const ray = new RAPIER.Ray(
        { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        { x: b.dir.x, y: b.dir.y, z: b.dir.z }
      );

      const hit = this.world.castRayAndGetNormal(
        ray,
        stepDist,
        true,
        undefined,
        undefined,
        undefined,
        b.ignoreBody
      );

      if (hit !== null) {
        const hitPoint = new Vector3(
          b.pos.x + b.dir.x * hit.timeOfImpact,
          b.pos.y + b.dir.y * hit.timeOfImpact,
          b.pos.z + b.dir.z * hit.timeOfImpact
        );
        const hitNormal = new Vector3(
          hit.normal.x,
          hit.normal.y,
          hit.normal.z
        );

        const hitBody = hit.collider.parent();
        if (onHit) {
          onHit({
            hitPoint,
            hitNormal,
            collider: hit.collider,
            body: hitBody,
          });
        }

        if (hitBody && (hitBody as unknown as { userData?: unknown }).userData) {
          onFleshHit(hitPoint, hitNormal);
        } else {
          onSurfaceHit(hitPoint, hitNormal);
        }

        b.mesh.dispose();
        this.bullets.splice(i, 1);
        continue;
      }

      b.pos.addInPlaceFromFloats(
        b.dir.x * stepDist,
        b.dir.y * stepDist,
        b.dir.z * stepDist
      );
      b.mesh.position.copyFrom(b.pos);
      b.distanceTraveled += stepDist;

      if (b.distanceTraveled >= MAX_BULLET_DISTANCE) {
        b.mesh.dispose();
        this.bullets.splice(i, 1);
      }
    }
  }
}

