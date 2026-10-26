/**
 * Factory for creating first-person Mercenary viewmodels with weapon bone rigging and animation states.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { createMuzzleFlashMesh } from '../../../combat';
import {
  HIDE_LOW_READY_FRAME,
  DRAW_FROM_LOW_READY_FRAME,
} from '../../../config/weapons';
import type { CharacterVisual } from '../../types';
import { createHitboxClassifier } from '../hitboxClassifier';
import { createStaticPoseAnimationGroupAtFrame } from './staticPose';

/**
 * Instantiates the `fps_merc_m4a1.glb` arms + M4A1 model for either:
 * - First-person viewmodel (`isViewmodel = true`, attached to camera rig)
 * - Third-person world replication (`isViewmodel = false`, spawned at remote player position)
 */
export function createMercVisual(
  name: string,
  scene: Scene,
  container: AssetContainer,
  isViewmodel: boolean
): CharacterVisual {
  const root = new Mesh(name, scene);
  root.isPickable = false;

  const instantiated = container.instantiateModelsToScene(
    (sourceName) => sourceName,
    false,
    { doNotInstantiate: true }
  );

  const modelOffsetNode = new TransformNode(`${name}_offset`, scene);
  modelOffsetNode.parent = root;

  if (isViewmodel) {
    modelOffsetNode.scaling.setAll(0.22);
    modelOffsetNode.position.set(0.0, -0.02, 0.03);
  } else {
    modelOffsetNode.scaling.setAll(0.45);
    modelOffsetNode.position.set(0.0, 0.35, 0.05);
  }

  for (const node of instantiated.rootNodes) {
    node.parent = modelOffsetNode;
  }

  // Attach a barrel-tip muzzle node at the exact front of the M4A1 barrel
  const muzzleNode = new TransformNode(`${name}_muzzle`, scene);
  muzzleNode.parent = modelOffsetNode;
  muzzleNode.position.set(0.2486, -0.2667, 2.48);

  const muzzleFlashMesh = createMuzzleFlashMesh(
    `${name}_muzzle_flash`,
    scene,
    muzzleNode,
    isViewmodel ? 1.0 : 1.35
  );

  for (const childMesh of root.getChildMeshes()) {
    childMesh.alwaysSelectAsActiveMesh = true;
    childMesh.isPickable = false;
    if (childMesh.material) {
      childMesh.material.backFaceCulling = false;
    }
  }

  const animMap = new Map<string, AnimationGroup>();
  for (const ag of instantiated.animationGroups) {
    ag.stop();
    animMap.set(ag.name, ag);
  }

  const drawGroup = animMap.get('Draw');
  const reloadGroup = animMap.get('Reload');
  const hideGroup = animMap.get('Hide');

  const synthesizedGroups: AnimationGroup[] = [];
  if (drawGroup && !animMap.has('Idle')) {
    const idleGroup = createStaticPoseAnimationGroupAtFrame(
      'Idle',
      drawGroup,
      drawGroup.to,
      scene
    );
    idleGroup.stop();
    animMap.set('Idle', idleGroup);
    synthesizedGroups.push(idleGroup);
  }
  if (hideGroup && !animMap.has('Hidden')) {
    const hiddenGroup = createStaticPoseAnimationGroupAtFrame(
      'Hidden',
      hideGroup,
      HIDE_LOW_READY_FRAME,
      scene
    );
    hiddenGroup.stop();
    animMap.set('Hidden', hiddenGroup);
    synthesizedGroups.push(hiddenGroup);
  }

  let currentAnim = 'Draw';
  let stateToken = 0;

  const stopActiveGroup = (): void => {
    for (const ag of animMap.values()) {
      if (ag.isPlaying) {
        ag.stop();
      }
    }
  };

  const startLoopingIdle = (): void => {
    stateToken++;
    stopActiveGroup();
    const idleGroup = animMap.get('Idle');
    if (idleGroup) {
      idleGroup.start(true, 1.0);
    }
    currentAnim = 'Idle';
  };

  const startDrawOnce = (fromFrame?: number): void => {
    const token = ++stateToken;
    stopActiveGroup();
    if (!drawGroup) {
      startLoopingIdle();
      return;
    }
    currentAnim = 'Draw';
    drawGroup.reset();
    const startF = fromFrame !== undefined ? fromFrame : drawGroup.from;
    drawGroup.start(false, 1.0, startF, drawGroup.to);
    drawGroup.onAnimationGroupEndObservable.addOnce(() => {
      if (stateToken === token) {
        startLoopingIdle();
      }
    });
  };

  const triggerReload = (): boolean => {
    if (currentAnim === 'Reload' || currentAnim === 'Draw') {
      return false;
    }
    if (!reloadGroup) {
      return false;
    }

    const token = ++stateToken;
    stopActiveGroup();

    const idleGroup = animMap.get('Idle');
    if (idleGroup) {
      idleGroup.start(false, 1.0, 0, 0);
      idleGroup.stop();
    }

    currentAnim = 'Reload';
    reloadGroup.reset();
    reloadGroup.start(false, 1.0);
    reloadGroup.onAnimationGroupEndObservable.addOnce(() => {
      if (stateToken === token) {
        startLoopingIdle();
      }
    });
    return true;
  };

  const triggerHide = (): void => {
    if (currentAnim === 'Hide' || currentAnim === 'Hidden') {
      startDrawOnce(DRAW_FROM_LOW_READY_FRAME);
      return;
    }
    if (!hideGroup) return;

    const token = ++stateToken;
    stopActiveGroup();
    currentAnim = 'Hide';
    hideGroup.reset();
    hideGroup.start(false, 1.0, 0, HIDE_LOW_READY_FRAME);
    hideGroup.onAnimationGroupEndObservable.addOnce(() => {
      if (stateToken === token) {
        const hiddenGroup = animMap.get('Hidden');
        if (hiddenGroup) {
          stopActiveGroup();
          hiddenGroup.start(true, 1.0);
        }
        currentAnim = 'Hidden';
      }
    });
  };

  const playAnimation = (animName: string): void => {
    if (animName === currentAnim) return;
    if (animName === 'Draw') {
      startDrawOnce();
    } else if (animName === 'Reload') {
      triggerReload();
    } else if (animName === 'Hide' || animName === 'Hidden') {
      if (currentAnim !== 'Hide' && currentAnim !== 'Hidden') {
        triggerHide();
      }
    } else if (animName === 'Idle') {
      if (currentAnim !== 'Draw' && currentAnim !== 'Reload') {
        startLoopingIdle();
      }
    }
  };

  startDrawOnce();

  const rootTransformNodes = instantiated.rootNodes.filter(
    (n): n is TransformNode => n instanceof TransformNode
  );
  const getHitZone = createHitboxClassifier(rootTransformNodes, root);

  const dispose = (): void => {
    stateToken++;
    for (const ag of instantiated.animationGroups) {
      ag.dispose();
    }
    for (const ag of synthesizedGroups) {
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
    triggerReload,
    triggerHide,
    getCurrentAnimation: () => currentAnim,
    getHitZone,
    dispose,
  };
}

