/**
 * Procedural crossed-quad muzzle flash mesh creation and single-frame lifecycle updates.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/Builders/planeBuilder';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { ActiveMuzzleFlash } from './types';

/**
 * Creates a lightweight crossed-plane muzzle flash mesh parented to a barrel
 * tip node (`muzzleNode`), hidden by default.
 */
export function createMuzzleFlashMesh(
  name: string,
  scene: Scene,
  muzzleNode: TransformNode,
  scale = 1.0
): Mesh {
  const flashRoot = new Mesh(name, scene);
  flashRoot.parent = muzzleNode;
  flashRoot.isPickable = false;
  flashRoot.isVisible = false;

  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.emissiveColor = new Color3(1.0, 0.82, 0.25);
  mat.diffuseColor = new Color3(1.0, 0.9, 0.4);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alpha = 0.92;

  const planeA = MeshBuilder.CreatePlane(
    `${name}_a`,
    { width: 0.22 * scale, height: 0.22 * scale },
    scene
  );
  planeA.parent = flashRoot;
  planeA.isPickable = false;
  planeA.material = mat;
  planeA.alwaysSelectAsActiveMesh = true;

  const planeB = MeshBuilder.CreatePlane(
    `${name}_b`,
    { width: 0.18 * scale, height: 0.32 * scale },
    scene
  );
  planeB.parent = flashRoot;
  planeB.rotation.z = Math.PI / 4;
  planeB.isPickable = false;
  planeB.material = mat;
  planeB.alwaysSelectAsActiveMesh = true;

  const coreCone = MeshBuilder.CreateCylinder(
    `${name}_cone`,
    {
      height: 0.28 * scale,
      diameterTop: 0.01,
      diameterBottom: 0.12 * scale,
      tessellation: 6,
    },
    scene
  );
  coreCone.parent = flashRoot;
  coreCone.rotation.x = Math.PI / 2;
  coreCone.position.z = 0.12 * scale;
  coreCone.isPickable = false;
  coreCone.material = mat;
  coreCone.alwaysSelectAsActiveMesh = true;

  flashRoot.setEnabled(false);
  return flashRoot;
}

/**
 * Shows a muzzle flash mesh for a single frame at a randomized roll angle,
 * then automatically hides it on the next frame.
 */
export function triggerSingleFrameMuzzleFlash(
  activeFlashes: ActiveMuzzleFlash[],
  flashMesh: Mesh | null
): void {
  if (!flashMesh) return;

  flashMesh.setEnabled(true);
  flashMesh.rotation.z = Math.random() * Math.PI * 2;
  const s = 0.85 + Math.random() * 0.35;
  flashMesh.scaling.set(s, s, s);

  const existing = activeFlashes.find((f) => f.mesh === flashMesh);
  if (existing) {
    existing.framesRemaining = 1;
  } else {
    activeFlashes.push({ mesh: flashMesh, framesRemaining: 1 });
  }
}

/**
 * Updates single-frame muzzle flash active states, hiding them after expiration.
 */
export function updateMuzzleFlashes(activeFlashes: ActiveMuzzleFlash[]): void {
  for (let i = activeFlashes.length - 1; i >= 0; i--) {
    const entry = activeFlashes[i];
    if (entry.framesRemaining <= 0) {
      entry.mesh.setEnabled(false);
      activeFlashes.splice(i, 1);
    } else {
      entry.framesRemaining--;
    }
  }
}

