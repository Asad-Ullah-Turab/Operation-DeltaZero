/**
 * Barrel smoke puff particle generator for sustained weapon bursts.
 */

import { Scene } from '@babylonjs/core/scene';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ActiveParticle } from '../types';

/**
 * Emits a subtle puff of barrel smoke from the muzzle that gently drifts
 * upward and fades out after releasing a sustained burst.
 */
export function spawnBarrelSmoke(
  scene: Scene,
  muzzleNode: TransformNode | null,
  smokeMat: StandardMaterial,
  particles: ActiveParticle[]
): void {
  if (!muzzleNode) return;
  muzzleNode.computeWorldMatrix(true);
  const origin = muzzleNode.getAbsolutePosition();

  const puffCount = 5;
  for (let i = 0; i < puffCount; i++) {
    const puff = MeshBuilder.CreateSphere(
      'barrel_smoke',
      { diameter: 0.045, segments: 5 },
      scene
    );
    puff.isPickable = false;
    puff.material = smokeMat;
    puff.visibility = 0.42;
    puff.position.set(
      origin.x + (Math.random() - 0.5) * 0.02,
      origin.y + (Math.random() - 0.5) * 0.02,
      origin.z + (Math.random() - 0.5) * 0.02
    );

    const vel = new Vector3(
      (Math.random() - 0.5) * 0.16,
      0.32 + Math.random() * 0.28,
      (Math.random() - 0.5) * 0.16
    );

    particles.push({
      mesh: puff,
      vel,
      gravity: 0.18,
      age: 0,
      lifetime: 0.65 + Math.random() * 0.35,
      initialScale: 0.7,
      endScale: 2.8,
      initialAlpha: 0.42,
    });
  }
}
