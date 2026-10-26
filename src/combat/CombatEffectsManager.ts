/**
 * Coordinates ballistics, hit callbacks, muzzle flashes, and particle VFX pools.
 */

import { Scene } from '@babylonjs/core/scene';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { RAPIER } from '../physics';
import type { ActiveMuzzleFlash, ActiveParticle, BulletHitEvent } from './types';
import { BulletSimulator } from './BulletSimulator';
import { triggerSingleFrameMuzzleFlash, updateMuzzleFlashes } from './muzzleFlash';
import { spawnSurfaceImpact, spawnFleshImpact } from './effects/impactEffects';
import { spawnBarrelSmoke } from './effects/barrelSmoke';
import { updateParticles } from './effects/particlePool';

export class CombatEffectsManager {
  private readonly scene: Scene;
  private readonly sparkMat: StandardMaterial;
  private readonly dustMat: StandardMaterial;
  private readonly smokeMat: StandardMaterial;
  private readonly fleshMat: StandardMaterial;

  private readonly particles: ActiveParticle[] = [];
  private readonly activeFlashes: ActiveMuzzleFlash[] = [];
  private readonly bulletSimulator: BulletSimulator;

  public onHit: ((event: BulletHitEvent) => void) | null = null;

  constructor(scene: Scene, world: RAPIER.World) {
    this.scene = scene;

    const bulletMat = new StandardMaterial('bulletTracerMat', scene);
    bulletMat.emissiveColor = new Color3(1.0, 0.94, 0.22);
    bulletMat.diffuseColor = new Color3(1.0, 0.94, 0.22);
    bulletMat.specularColor = Color3.Black();
    bulletMat.disableLighting = true;
    bulletMat.freeze();

    this.bulletSimulator = new BulletSimulator(scene, world, bulletMat);

    this.sparkMat = new StandardMaterial('impactSparkMat', scene);
    this.sparkMat.emissiveColor = new Color3(1.0, 0.78, 0.24);
    this.sparkMat.diffuseColor = new Color3(1.0, 0.78, 0.24);
    this.sparkMat.specularColor = Color3.Black();
    this.sparkMat.disableLighting = true;
    this.sparkMat.freeze();

    this.dustMat = new StandardMaterial('impactDustMat', scene);
    this.dustMat.emissiveColor = new Color3(0.68, 0.74, 0.82);
    this.dustMat.diffuseColor = new Color3(0.68, 0.74, 0.82);
    this.dustMat.specularColor = Color3.Black();
    this.dustMat.disableLighting = true;

    this.smokeMat = new StandardMaterial('barrelSmokeMat', scene);
    this.smokeMat.emissiveColor = new Color3(0.76, 0.8, 0.85);
    this.smokeMat.diffuseColor = new Color3(0.76, 0.8, 0.85);
    this.smokeMat.specularColor = Color3.Black();
    this.smokeMat.disableLighting = true;

    this.fleshMat = new StandardMaterial('impactFleshMat', scene);
    this.fleshMat.emissiveColor = new Color3(0.75, 0.08, 0.08);
    this.fleshMat.diffuseColor = new Color3(0.75, 0.08, 0.08);
    this.fleshMat.specularColor = Color3.Black();
    this.fleshMat.disableLighting = true;
    this.fleshMat.freeze();
  }

  /**
   * Shows a muzzle flash mesh for a single frame at a randomized roll angle.
   */
  public triggerSingleFrameMuzzleFlash(flashMesh: Mesh | null): void {
    triggerSingleFrameMuzzleFlash(this.activeFlashes, flashMesh);
  }

  /**
   * Spawns a small, bright yellow cylinder projectile at `origin` propelled along `direction`.
   */
  public spawnBullet(
    origin: Vector3,
    direction: Vector3,
    ignoreBody?: RAPIER.RigidBody
  ): void {
    this.bulletSimulator.spawnBullet(origin, direction, ignoreBody);
  }

  /**
   * Spawns an instantaneous burst of sparks and dust from a surface impact.
   */
  public spawnSurfaceImpact(point: Vector3, normal: Vector3): void {
    spawnSurfaceImpact(
      this.scene,
      point,
      normal,
      this.sparkMat,
      this.dustMat,
      this.particles
    );
  }

  /**
   * Spawns a small burst of dark-crimson flesh particles on operative impact.
   */
  public spawnFleshImpact(point: Vector3, normal: Vector3): void {
    spawnFleshImpact(this.scene, point, normal, this.fleshMat, this.particles);
  }

  /**
   * Emits a subtle puff of barrel smoke drifting upward from the muzzle.
   */
  public spawnBarrelSmoke(muzzleNode: TransformNode | null): void {
    spawnBarrelSmoke(this.scene, muzzleNode, this.smokeMat, this.particles);
  }

  /**
   * Steps muzzle flashes, ballistic raycasts, and active particle simulation.
   */
  public update(dtSeconds: number): void {
    updateMuzzleFlashes(this.activeFlashes);

    this.bulletSimulator.update(
      dtSeconds,
      this.onHit,
      (point, normal) => this.spawnFleshImpact(point, normal),
      (point, normal) => this.spawnSurfaceImpact(point, normal)
    );

    updateParticles(this.particles, dtSeconds);
  }
}

