/**
 * Orchestrator factory creating the 3D Spy character mesh, animations, and hitboxes.
 *
 * NOTE: Exceeds 300 lines (366 lines, ceiling 400) to preserve cohesive animation event closures,
 * GLTF skeletal hierarchy traversal, and hit box mesh alignment.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { PLAYER_HALF_HEIGHT } from '../../../config/arena';
import type {
  CharacterVisual,
  SpieAnimContext,
  SpieAnimationName,
} from '../../types';
import { computeModelHeightAndBaseY } from '../../assets/boundingBox';
import { resolveSpieAnimName } from './animNames';
import { stripSpieRootMotion } from './rootMotion';
import { createSpieHitboxClassifier } from './hitboxes';
import { buildSpieTracks, updateSpieCrossfade } from './tracks';

/**
 * Instantiates a 3D Spie character from `spy.glb`, aligns its feet with the
 * bottom of the physics collider (-PLAYER_HALF_HEIGHT), and manages animations.
 */
export function createSpieVisual(
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

  for (const ag of instantiated.animationGroups) {
    ag.stop();
  }

  stripSpieRootMotion(instantiated.animationGroups, scale);

  const tracks = buildSpieTracks(instantiated.animationGroups);

  let currentState: SpieAnimationName = 'idle';
  let isSingleShot = false;
  let singleShotElapsed = 0;
  let singleShotDuration = 0;

  const setTarget = (trackName: SpieAnimationName, isSingle = false): void => {
    if (currentState === trackName && !isSingle) return;
    const oldState = currentState;
    currentState = trackName;
    isSingleShot = isSingle;
    const targetTrack = tracks.get(trackName);
    if (!targetTrack) return;

    if (trackName === 'left-strafe-walking') {
      const opp = tracks.get('right-strafe-walking');
      if (opp) {
        opp.targetWeight = 0;
        opp.currentWeight = 0;
        opp.group.stop();
        opp.group.setWeightForAllAnimatables(0);
      }
    } else if (trackName === 'right-strafe-walking') {
      const opp = tracks.get('left-strafe-walking');
      if (opp) {
        opp.targetWeight = 0;
        opp.currentWeight = 0;
        opp.group.stop();
        opp.group.setWeightForAllAnimatables(0);
      }
    }

    for (const [tName, track] of tracks) {
      if (tName === trackName) {
        track.targetWeight = 1.0;
        if (isSingle) {
          singleShotElapsed = 0;
          singleShotDuration = track.durationSec;
          track.currentWeight = 1.0;
          track.group.reset();
          track.group.start(false, track.speedRatio);
        } else {
          if (oldState === 'idle' || oldState === 'crouch-idle') {
            track.currentWeight = Math.max(track.currentWeight, 0.55);
          } else if (
            (trackName === 'left-strafe-walking' &&
              oldState === 'right-strafe-walking') ||
            (trackName === 'right-strafe-walking' &&
              oldState === 'left-strafe-walking')
          ) {
            track.currentWeight = 1.0;
          }
          track.group.reset();
          track.group.start(true, track.speedRatio);
        }
      } else {
        track.targetWeight = 0.0;
      }
    }
  };

  let wasMoving = false;
  const lastMoveDir = new Vector3(0, 0, 1);

  const updateAnimation = (
    dtSeconds: number,
    context: SpieAnimContext
  ): void => {
    if (isSingleShot) {
      singleShotElapsed += dtSeconds;

      if (currentState === 'stand-to-crouch') {
        if (context.isMoving) {
          setTarget('crouched-walking');
        } else if (singleShotElapsed >= singleShotDuration * 0.75) {
          const crouchIdleTrack = tracks.get('crouch-idle');
          const s2cTrack = tracks.get('stand-to-crouch');
          if (crouchIdleTrack && s2cTrack) {
            crouchIdleTrack.targetWeight = 1.0;
            s2cTrack.targetWeight = 0.0;
            if (!crouchIdleTrack.group.isPlaying) {
              crouchIdleTrack.group.reset();
              crouchIdleTrack.group.start(true, crouchIdleTrack.speedRatio);
            }
          }
          if (singleShotElapsed >= singleShotDuration) {
            isSingleShot = false;
            currentState = 'crouch-idle';
          }
        }
      } else if (currentState === 'crouch-to-stand') {
        if (context.isMoving) {
          setTarget('walking');
        } else if (singleShotElapsed >= singleShotDuration * 0.75) {
          const idleTrack = tracks.get('idle');
          const c2sTrack = tracks.get('crouch-to-stand');
          if (idleTrack && c2sTrack) {
            idleTrack.targetWeight = 1.0;
            c2sTrack.targetWeight = 0.0;
            if (!idleTrack.group.isPlaying) {
              idleTrack.group.reset();
              idleTrack.group.start(true, idleTrack.speedRatio);
            }
          }
          if (singleShotElapsed >= singleShotDuration) {
            isSingleShot = false;
            currentState = 'idle';
          }
        }
      } else if (currentState === 'hang-to-crouch') {
        if (singleShotElapsed >= singleShotDuration * 0.85) {
          const crouchIdleTrack = tracks.get('crouch-idle');
          const hangTrack = tracks.get('hang-to-crouch');
          if (crouchIdleTrack && hangTrack) {
            crouchIdleTrack.targetWeight = 1.0;
            hangTrack.targetWeight = 0.0;
            if (!crouchIdleTrack.group.isPlaying) {
              crouchIdleTrack.group.reset();
              crouchIdleTrack.group.start(true, crouchIdleTrack.speedRatio);
            }
          }
          if (singleShotElapsed >= singleShotDuration) {
            isSingleShot = false;
            currentState = 'crouch-idle';
          }
        }
      } else if (currentState === 'jump') {
        if (context.isGrounded && singleShotElapsed >= 0.25) {
          isSingleShot = false;
          if (context.isCrouched) {
            setTarget(context.isMoving ? 'crouched-walking' : 'crouch-idle');
          } else {
            setTarget(context.isMoving ? 'walking' : 'idle');
          }
        } else if (singleShotElapsed >= singleShotDuration) {
          isSingleShot = false;
          if (context.isCrouched) {
            setTarget(context.isMoving ? 'crouched-walking' : 'crouch-idle');
          } else {
            setTarget(context.isMoving ? 'walking' : 'idle');
          }
        }
      } else if (currentState === 'walking-turn-180') {
        if (!context.isMoving) {
          setTarget('idle');
        } else if (singleShotElapsed >= singleShotDuration * 0.65) {
          const walkTrack = tracks.get('walking');
          const t180Track = tracks.get('walking-turn-180');
          if (walkTrack && t180Track) {
            walkTrack.targetWeight = 1.0;
            t180Track.targetWeight = 0.0;
            if (!walkTrack.group.isPlaying) {
              walkTrack.group.reset();
              walkTrack.group.start(true, walkTrack.speedRatio);
            }
          }
          if (singleShotElapsed >= singleShotDuration) {
            isSingleShot = false;
            currentState = 'walking';
          }
        }
      } else if (currentState === 'left-turn' || currentState === 'right-turn') {
        if (!context.isMoving) {
          setTarget('idle');
        } else if (singleShotElapsed >= singleShotDuration * 0.65) {
          const walkTrack = tracks.get('walking');
          const turnT = tracks.get(currentState);
          if (walkTrack && turnT) {
            walkTrack.targetWeight = 1.0;
            turnT.targetWeight = 0.0;
            if (!walkTrack.group.isPlaying) {
              walkTrack.group.reset();
              walkTrack.group.start(true, walkTrack.speedRatio);
            }
          }
          if (singleShotElapsed >= singleShotDuration) {
            isSingleShot = false;
            currentState = 'walking';
          }
        }
      }
    }

    if (context.isClimbing) {
      if (currentState !== 'hang-to-crouch') {
        setTarget('hang-to-crouch', true);
      }
    } else if (context.isCrouched) {
      if (context.isMoving) {
        if (currentState !== 'crouched-walking') {
          setTarget('crouched-walking');
        }
      } else {
        if (currentState !== 'crouch-idle') {
          setTarget('crouch-idle');
        }
      }
    } else if (context.isStrafing) {
      if (isSingleShot) isSingleShot = false;
      if (context.isMoving) {
        const lateral = Vector3.Dot(context.moveDir, context.camRight);
        if (lateral < -0.35) {
          if (currentState !== 'left-strafe-walking') {
            setTarget('left-strafe-walking');
          }
        } else if (lateral > 0.35) {
          if (currentState !== 'right-strafe-walking') {
            setTarget('right-strafe-walking');
          }
        } else {
          if (currentState !== 'walking') {
            setTarget('walking');
          }
        }
      } else {
        if (currentState !== 'idle') setTarget('idle');
      }
    } else {
      if (context.isMoving && !wasMoving) {
        setTarget('walking');
      } else if (context.isMoving && wasMoving) {
        const dot = Vector3.Dot(context.moveDir, lastMoveDir);
        if (dot < -0.6) {
          setTarget('walking-turn-180', true);
        } else if (!isSingleShot && currentState !== 'walking') {
          setTarget('walking');
        }
      } else if (!context.isMoving && wasMoving) {
        setTarget('idle');
      } else if (!context.isMoving && !wasMoving && !isSingleShot) {
        if (currentState !== 'idle') {
          setTarget('idle');
        }
      }
    }

    wasMoving = context.isMoving;
    if (context.isMoving) {
      lastMoveDir.copyFrom(context.moveDir);
    }
  };

  const renderObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(
      0.05,
      (scene.getEngine().getDeltaTime() || 16.6) / 1000.0
    );
    updateSpieCrossfade(tracks, dt);
  });

  const playAnimation = (animName: string): void => {
    const resolved = resolveSpieAnimName(animName);
    if (!resolved) return;
    const isSingle =
      resolved === 'start-walking' ||
      resolved === 'stop-walking' ||
      resolved === 'walking-turn-180' ||
      resolved === 'left-turn' ||
      resolved === 'right-turn' ||
      resolved === 'stand-to-crouch' ||
      resolved === 'crouch-to-stand' ||
      resolved === 'jump' ||
      resolved === 'hang-to-crouch';
    setTarget(resolved, isSingle);
  };

  const rootTransformNodes = instantiated.rootNodes.filter(
    (n): n is TransformNode => n instanceof TransformNode
  );
  const getHitZone = createSpieHitboxClassifier(rootTransformNodes, root);

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
    root.dispose(false, true);
  };

  return {
    root,
    characterType: 'Spie',
    muzzleNode: null,
    muzzleFlashMesh: null,
    playAnimation,
    updateAnimation,
    getCurrentAnimation: () => currentState,
    getHitZone,
    dispose,
  };
}
