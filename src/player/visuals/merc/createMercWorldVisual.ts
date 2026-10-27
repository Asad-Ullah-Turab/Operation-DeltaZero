/**
 * Factory for creating third-person Mercenary world avatars representing remote peers in the arena.
 */

import { Scene } from '@babylonjs/core/scene';
import type { Node } from '@babylonjs/core/node';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { createMuzzleFlashMesh } from '../../../combat';
import { PLAYER_HALF_HEIGHT } from '../../../config/arena';
import type { CharacterVisual, MercAnimationName } from '../../types';
import { computeModelHeightAndBaseY } from '../../assets/boundingBox';
import { createHitboxClassifier } from '../hitboxClassifier';
import {
  setupMercRigNodes,
  updateMercUpperBodyPose,
  type MercRigNodes,
} from './mercWeaponPose';

interface MercTrack {
  name: MercAnimationName;
  group: AnimationGroup;
  currentWeight: number;
  targetWeight: number;
  isLooping: boolean;
  speedRatio: number;
  durationSec: number;
}

const MERC_TRACK_CONFIGS: Array<{
  name: MercAnimationName;
  isLooping: boolean;
  speedRatio: number;
}> = [
  { name: 'idle-aiming', isLooping: true, speedRatio: 1.0 },
  { name: 'walking', isLooping: true, speedRatio: 1.2 },
  { name: 'shooting', isLooping: false, speedRatio: 1.0 },
];

const CROSSFADE_RATE = 10.0;

function updateMercCrossfade(
  tracks: Map<MercAnimationName, MercTrack>,
  dtSeconds: number,
  rate = CROSSFADE_RATE
): void {
  const step = dtSeconds * rate;
  let totalWeight = 0;

  for (const track of tracks.values()) {
    if (track.currentWeight < track.targetWeight) {
      track.currentWeight = Math.min(
        track.targetWeight,
        track.currentWeight + step
      );
    } else if (track.currentWeight > track.targetWeight) {
      track.currentWeight = Math.max(
        track.targetWeight,
        track.currentWeight - step
      );
    }
    totalWeight += track.currentWeight;
  }

  if (totalWeight > 0.0001) {
    for (const track of tracks.values()) {
      const norm = track.currentWeight / totalWeight;
      if (norm > 0.001) {
        if (track.isLooping && !track.group.isPlaying) {
          track.group.start(true, track.speedRatio);
        }
        track.group.setWeightForAllAnimatables(norm);
      } else {
        track.group.setWeightForAllAnimatables(0);
        if (
          track.targetWeight === 0 &&
          track.isLooping &&
          track.group.isPlaying
        ) {
          track.group.stop();
        }
      }
    }
  }
}

function resolveMercAnimName(name: string): MercAnimationName {
  const lower = name.toLowerCase();
  if (lower.includes('shoot') || lower.includes('fire')) {
    return 'shooting';
  }
  if (
    lower.includes('walk') ||
    lower.includes('run') ||
    lower.includes('move')
  ) {
    return 'walking';
  }
  return 'idle-aiming';
}

function findNodeByName(root: Node, target: string): Node | null {
  if (root.name === target || root.name.endsWith('|' + target)) return root;
  for (const child of root.getChildren()) {
    const found = findNodeByName(child, target);
    if (found) return found;
  }
  return null;
}

/**
 * Instantiates the third-person `mercenary.glb` full-body character model
 * equipped with animations, attached M4A1 rifle, and muzzle firing node.
 */
export function createMercWorldVisual(
  name: string,
  scene: Scene,
  container: AssetContainer,
  weaponContainer?: AssetContainer
): CharacterVisual {
  const root = new Mesh(name, scene);

  const instantiated = container.instantiateModelsToScene(
    (sourceName) => sourceName,
    false,
    { doNotInstantiate: true }
  );

  const { height, baseY } = computeModelHeightAndBaseY(container);
  const targetHeight = 1.72;
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

  for (const ag of instantiated.animationGroups) {
    ag.stop();
  }

  // Build animation tracks
  const tracks = new Map<MercAnimationName, MercTrack>();
  for (const cfg of MERC_TRACK_CONFIGS) {
    const ag = instantiated.animationGroups.find(
      (g) => g.name === cfg.name || g.name.endsWith('|' + cfg.name)
    );
    if (ag) {
      const durationSec = (ag.to - ag.from) / (60.0 * cfg.speedRatio);
      tracks.set(cfg.name, {
        ...cfg,
        group: ag,
        currentWeight: cfg.name === 'idle-aiming' ? 1.0 : 0.0,
        targetWeight: cfg.name === 'idle-aiming' ? 1.0 : 0.0,
        durationSec,
      });
    }
  }

  const idleTrack = tracks.get('idle-aiming');
  if (idleTrack) {
    idleTrack.group.start(true, idleTrack.speedRatio);
    idleTrack.group.setWeightForAllAnimatables(1.0);
  }

  let baseState: 'idle-aiming' | 'walking' = 'idle-aiming';
  let isShooting = false;
  let shootingElapsed = 0;
  let shootingDuration = 0;

  const setTarget = (animName: MercAnimationName): void => {
    if (animName === 'shooting') {
      const shootTrack = tracks.get('shooting');
      if (!shootTrack) return;
      isShooting = true;
      shootingElapsed = 0;
      shootingDuration = shootTrack.durationSec;
      shootTrack.currentWeight = 1.0;
      shootTrack.targetWeight = 1.0;
      shootTrack.group.reset();
      shootTrack.group.start(false, shootTrack.speedRatio);
      return;
    }

    baseState = animName;
    if (isShooting) {
      for (const [tName, track] of tracks) {
        if (tName === 'shooting') continue;
        track.targetWeight = tName === animName ? 1.0 : 0.0;
      }
      return;
    }

    for (const [tName, track] of tracks) {
      if (tName === animName) {
        track.targetWeight = 1.0;
        if (track.isLooping && !track.group.isPlaying) {
          track.group.start(true, track.speedRatio);
        }
      } else {
        track.targetWeight = 0.0;
      }
    }
  };

  // Attach M4A1 rifle to right hand
  const muzzleNode = new TransformNode(`${name}_muzzle`, scene);
  muzzleNode.parent = root;

  let barrelTipNode: TransformNode | null = null;
  let circleNode: Node | null = null;
  let rigNodes: MercRigNodes | null = null;
  const weaponMeshesToDispose: Mesh[] = [];
  const weaponNodesToDispose: TransformNode[] = [muzzleNode];

  const rightHandNode = findNodeByName(root, 'mixamorig:RightHand');

  if (weaponContainer && rightHandNode) {
    const weaponInst = weaponContainer.instantiateModelsToScene(
      (sourceName) => `${name}_${sourceName}`,
      false,
      { doNotInstantiate: true }
    );

    for (const rNode of weaponInst.rootNodes) {
      for (const childMesh of rNode.getChildMeshes()) {
        if (childMesh instanceof Mesh) {
          childMesh.isPickable = false;
          if (childMesh.material) {
            childMesh.material.backFaceCulling = false;
          }
          weaponMeshesToDispose.push(childMesh);
        }
      }
    }

    const weaponMount = new TransformNode(`${name}_weapon_mount`, scene);
    weaponMount.parent = rightHandNode;
    // Grip placement in palm
    weaponMount.position.set(1.5, 6.0, 0.0);
    weaponMount.rotation.set(1.3, 1.2, -0.2);
    // Scale M4A1 rifle proportionally (~0.82m in world space)
    weaponMount.scaling.setAll(0.355);
    weaponNodesToDispose.push(weaponMount);
    rigNodes = setupMercRigNodes(root, weaponMount);

    circleNode =
      findNodeByName(weaponInst.rootNodes[0], `${name}_Circle.027`) ||
      findNodeByName(weaponInst.rootNodes[0], 'Circle.027') ||
      weaponInst.rootNodes[0].getChildren()[0];

    if (circleNode instanceof TransformNode || circleNode instanceof Mesh) {
      circleNode.parent = weaponMount;
      // Offset so the pistol grip (raw [-0.97, -23.64, -20.16]) sits directly in the palm
      circleNode.position.set(0.97, 20.0, -22.5);
      circleNode.scaling.setAll(1.0);

      barrelTipNode = new TransformNode(`${name}_barrel_tip`, scene);
      barrelTipNode.parent = circleNode;
      // Exact tip of M4A1 barrel in local weapon space
      barrelTipNode.position.set(-0.99, 139.467, 6.083);
      weaponNodesToDispose.push(barrelTipNode);
    }

    for (const rNode of weaponInst.rootNodes) {
      if (rNode !== circleNode && rNode.parent === null) {
        rNode.parent = weaponMount;
      }
    }
  } else {
    muzzleNode.position.set(0.22, 0.35, 0.6);
  }

  const syncMuzzleNode = (): void => {
    if (!barrelTipNode || !circleNode) return;
    barrelTipNode.computeWorldMatrix(true);
    (circleNode as TransformNode | Mesh).computeWorldMatrix(true);
    const tipPos = barrelTipNode.getAbsolutePosition();
    muzzleNode.setAbsolutePosition(tipPos);

    const receiverPos = (
      circleNode as TransformNode | Mesh
    ).getAbsolutePosition();
    const forwardDir = tipPos.subtract(receiverPos);
    if (forwardDir.lengthSquared() > 0.0001) {
      muzzleNode.lookAt(tipPos.add(forwardDir.normalize()));
    }
  };

  const origComputeWorldMatrix =
    muzzleNode.computeWorldMatrix.bind(muzzleNode);
  muzzleNode.computeWorldMatrix = (force?: boolean) => {
    syncMuzzleNode();
    return origComputeWorldMatrix(force);
  };
  syncMuzzleNode();

  const muzzleFlashMesh = createMuzzleFlashMesh(
    `${name}_muzzle_flash`,
    scene,
    muzzleNode,
    1.35
  );
  muzzleFlashMesh.alwaysSelectAsActiveMesh = true;

  const renderObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(
      0.05,
      (scene.getEngine().getDeltaTime() || 16.6) / 1000.0
    );

    if (isShooting) {
      shootingElapsed += dt;
      if (shootingElapsed >= shootingDuration) {
        isShooting = false;
        const shootTrack = tracks.get('shooting');
        if (shootTrack) {
          shootTrack.targetWeight = 0.0;
        }
        const baseTrack = tracks.get(baseState);
        if (baseTrack) {
          baseTrack.targetWeight = 1.0;
          if (baseTrack.isLooping && !baseTrack.group.isPlaying) {
            baseTrack.group.start(true, baseTrack.speedRatio);
          }
        }
      }
    }

    updateMercCrossfade(tracks, dt);
    if (rigNodes) {
      updateMercUpperBodyPose(rigNodes, {
        idle: tracks.get('idle-aiming')?.currentWeight ?? 0,
        walk: tracks.get('walking')?.currentWeight ?? 0,
        shoot: tracks.get('shooting')?.currentWeight ?? 0,
      });
    }
    syncMuzzleNode();
  });

  const playAnimation = (animName: string): void => {
    const resolved = resolveMercAnimName(animName);
    setTarget(resolved);
  };

  const rootTransformNodes = instantiated.rootNodes.filter(
    (n): n is TransformNode => n instanceof TransformNode
  );
  const getHitZone = createHitboxClassifier(rootTransformNodes, root);

  const dispose = (): void => {
    if (renderObserver) {
      scene.onBeforeRenderObservable.remove(renderObserver);
    }
    for (const ag of instantiated.animationGroups) {
      ag.dispose();
    }
    for (const skel of (instantiated.skeletons ?? []) as Skeleton[]) {
      skel?.dispose();
    }
    for (const m of weaponMeshesToDispose) {
      m.dispose(false, true);
    }
    for (const n of weaponNodesToDispose) {
      n.dispose();
    }
    muzzleFlashMesh.dispose(false, true);
    root.dispose(false, true);
  };

  return {
    root,
    characterType: 'Merc',
    muzzleNode,
    muzzleFlashMesh,
    playAnimation,
    getCurrentAnimation: () => (isShooting ? 'shooting' : baseState),
    getHitZone,
    dispose,
  };
}
