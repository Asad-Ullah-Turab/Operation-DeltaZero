/**
 * Surface and flesh bullet impact particle generators.
 */

import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ActiveParticle } from '../types';

/**
 * Spawns an instantaneous burst of sparks and dust directed outward from
 * the surface impact normal.
 */
export function spawnSurfaceImpact(
  scene: Scene,
  point: Vector3,
  normal: Vector3,
  sparkMat: StandardMaterial,
  dustMat: StandardMaterial,
  particles: ActiveParticle[]
): void {
  const n = normal.normalizeToNew();

  // 1. Bright yellow-orange sparks bouncing off the surface
  const sparkCount = 6;
  for (let i = 0; i < sparkCount; i++) {
    const spark = MeshBuilder.CreateBox(
      'impact_spark',
      { size: 0.042 },
      scene
    );
    spark.isPickable = false;
    spark.material = sparkMat;
    spark.position.copyFrom(point).addInPlaceFromFloats(
      n.x * 0.02,
      n.y * 0.02,
      n.z * 0.02
    );

    const speed = 3.2 + Math.random() * 4.5;
    const spreadX = (Math.random() - 0.5) * 1.4;
    const spreadY = (Math.random() - 0.5) * 1.4;
    const spreadZ = (Math.random() - 0.5) * 1.4;
    const vel = new Vector3(
      (n.x + spreadX) * speed,
      (n.y + Math.abs(spreadY) * 0.6) * speed,
      (n.z + spreadZ) * speed
    );

    particles.push({
      mesh: spark,
      vel,
      gravity: -14.0,
      age: 0,
      lifetime: 0.14 + Math.random() * 0.1,
      initialScale: 1.0,
      endScale: 0.1,
      initialAlpha: 1.0,
    });
  }

  // 2. Small puff of surface dust
  const dustCount = 4;
  for (let i = 0; i < dustCount; i++) {
    const dust = MeshBuilder.CreateSphere(
      'impact_dust',
      { diameter: 0.09, segments: 4 },
      scene
    );
    dust.isPickable = false;
    dust.material = dustMat;
    dust.visibility = 0.65;
    dust.position.copyFrom(point).addInPlaceFromFloats(
      n.x * 0.03,
      n.y * 0.03,
      n.z * 0.03
    );

    const speed = 0.9 + Math.random() * 1.5;
    const vel = new Vector3(
      (n.x + (Math.random() - 0.5) * 0.9) * speed,
      (n.y + (Math.random() - 0.5) * 0.9) * speed + 0.35,
      (n.z + (Math.random() - 0.5) * 0.9) * speed
    );

    particles.push({
      mesh: dust,
      vel,
      gravity: 0.6,
      age: 0,
      lifetime: 0.22 + Math.random() * 0.12,
      initialScale: 0.8,
      endScale: 2.1,
      initialAlpha: 0.65,
    });
  }
}

/**
 * Spawns a small burst of dark-crimson flesh particles when a bullet impacts
 * an operative character.
 */
export function spawnFleshImpact(
  scene: Scene,
  point: Vector3,
  normal: Vector3,
  fleshMat: StandardMaterial,
  particles: ActiveParticle[]
): void {
  const n = normal.normalizeToNew();
  const particleCount = 6;
  for (let i = 0; i < particleCount; i++) {
    const drop = MeshBuilder.CreateBox(
      'flesh_spark',
      { size: 0.04 },
      scene
    );
    drop.isPickable = false;
    drop.material = fleshMat;
    drop.position.copyFrom(point).addInPlaceFromFloats(
      n.x * 0.02,
      n.y * 0.02,
      n.z * 0.02
    );

    const speed = 1.6 + Math.random() * 2.2;
    const spreadX = (Math.random() - 0.5) * 1.2;
    const spreadY = (Math.random() - 0.5) * 1.2;
    const spreadZ = (Math.random() - 0.5) * 1.2;
    const vel = new Vector3(
      (n.x + spreadX) * speed,
      (n.y + Math.abs(spreadY) * 0.5) * speed,
      (n.z + spreadZ) * speed
    );

    particles.push({
      mesh: drop,
      vel,
      gravity: -10.0,
      age: 0,
      lifetime: 0.16 + Math.random() * 0.1,
      initialScale: 1.0,
      endScale: 0.2,
      initialAlpha: 1.0,
    });
  }
}
