/**
 * Factory for creating third-person Mercenary world avatars representing remote peers in the arena.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { createMuzzleFlashMesh } from '../../../combat';
import { PLAYER_HALF_HEIGHT } from '../../../config/arena';
import type { CharacterVisual } from '../../types';
import { computeModelHeightAndBaseY } from '../../assets/boundingBox';
import { createHitboxClassifier } from '../hitboxClassifier';

/**
 * Instantiates the third-person `mercenary.glb` full-body character model
 * representing other Mercenary players connected to the multiplayer server.
 */
export function createMercWorldVisual(
  name: string,
  scene: Scene,
  container: AssetContainer
): CharacterVisual {
  const root = new Mesh(name, scene);

  const instantiated = container.instantiateModelsToScene(
    (sourceName) => sourceName,
    false,
    { doNotInstantiate: true }
  );

  const { height, baseY } = computeModelHeightAndBaseY(container);
  const targetHeight = 1.76;
  const scale = targetHeight / height;

  for (const node of instantiated.rootNodes) {
    node.parent = root;
    if (node instanceof TransformNode) {
      node.position.set(0, -PLAYER_HALF_HEIGHT - baseY * scale, 0);
      node.scaling.x *= scale;
      node.scaling.y *= scale;
      node.scaling.z *= scale;
    }
  }

  for (const childMesh of root.getChildMeshes()) {
    childMesh.isPickable = false;
    if (childMesh.material) {
      childMesh.material.backFaceCulling = false;
    }
  }

  // Muzzle attachment node and flash for remote weapon firing
  const muzzleNode = new TransformNode(`${name}_muzzle`, scene);
  muzzleNode.parent = root;
  muzzleNode.position.set(0.22, 0.35, 0.6);

  const muzzleFlashMesh = createMuzzleFlashMesh(
    `${name}_muzzle_flash`,
    scene,
    muzzleNode,
    1.35
  );

  let currentAnim = 'idle';
  const playAnimation = (animName: string): void => {
    currentAnim = animName;
  };

  const rootTransformNodes = instantiated.rootNodes.filter(
    (n): n is TransformNode => n instanceof TransformNode
  );
  const getHitZone = createHitboxClassifier(rootTransformNodes, root);

  const dispose = (): void => {
    for (const ag of instantiated.animationGroups) {
      ag.dispose();
    }
    for (const skel of (instantiated.skeletons ?? []) as Skeleton[]) {
      skel?.dispose();
    }
    root.dispose(false, true);
  };

  return {
    root,
    characterType: 'Merc',
    muzzleNode,
    muzzleFlashMesh,
    playAnimation,
    getCurrentAnimation: () => currentAnim,
    getHitZone,
    dispose,
  };
}
