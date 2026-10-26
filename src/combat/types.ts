/**
 * Data contracts and internal tracking structures for ballistic combat effects and projectiles.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RAPIER } from '../physics';

export interface ActiveBullet {
  mesh: Mesh;
  pos: Vector3;
  dir: Vector3;
  distanceTraveled: number;
  ignoreBody?: RAPIER.RigidBody;
}

export interface ActiveParticle {
  mesh: Mesh;
  vel: Vector3;
  gravity: number;
  age: number;
  lifetime: number;
  initialScale: number;
  endScale: number;
  initialAlpha: number;
}

export interface ActiveMuzzleFlash {
  mesh: Mesh;
  framesRemaining: number;
}

export interface BulletHitEvent {
  hitPoint: Vector3;
  hitNormal: Vector3;
  collider: RAPIER.Collider;
  body: RAPIER.RigidBody | null;
}

