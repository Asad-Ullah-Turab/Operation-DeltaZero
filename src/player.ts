import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Animation } from '@babylonjs/core/Animations/animation';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import '@babylonjs/loaders/glTF/2.0';
import {
  RAPIER,
  PLAYER_HALF_HEIGHT,
  createPlayerCylinderBody,
  isPlayerGrounded,
} from './physics';
import { CombatEffectsManager, createMuzzleFlashMesh } from './combat';

export type CharacterType = 'Spie' | 'Merc';

export interface CharacterAssets {
  spieContainer: AssetContainer;
  mercContainer: AssetContainer;
}

export interface NetworkShotEvent {
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

const WALK_SPEED = 7.5;
const RUN_SPEED = 11.5;
const CROUCH_SPEED = 4.2;
const ADS_WALK_SPEED = 4.8;
const JUMP_IMPULSE = 6.2;
const TURN_SMOOTH_SPEED = 14.0;
const MOUSE_SENSITIVITY = 0.0022;
const ADS_MOUSE_SENSITIVITY = 0.0014;

const STANDING_EYE_OFFSET = 0.68;
const CROUCH_EYE_OFFSET = 0.18;

// Magazine & Firing Constants (M4A1: 30 rounds/mag, 5 magazines total: 1 loaded + 4 reserve)
const MAGAZINE_CAPACITY = 30;
const INITIAL_RESERVE_MAGAZINES = 4;
const FIRE_INTERVAL_SECONDS = 0.1; // 100ms between shots (600 RPM)
const BURST_SMOKE_THRESHOLD = 3;

// Procedural ADS Constants (~150ms transition, 72 deg hip FOV -> 52 deg ADS FOV)
const ADS_TRANSITION_DURATION = 0.15;
const HIP_FOV_RAD = (72 * Math.PI) / 180;
const ADS_FOV_RAD = (52 * Math.PI) / 180;
const ADS_OFFSET_X = -0.0547;
const ADS_OFFSET_Y = 0.0365;
const ADS_OFFSET_Z = -0.055;

/**
 * In `fps_merc_m4a1.glb`, the arm/hand/shirt meshes (`Object_91`, `Object_92`,
 * `Object_93`) were exported with un-normalized FBX unit coordinates (-3840x
 * relative to the single shared skin's inverseBindMatrices). Scaling their
 * bind-pose vertex positions by `-1 / 3840` aligns the hands, wrists, and
 * forearms directly onto the M4A1 weapon bones.
 */
const ARM_VERTEX_CORRECTION_SCALE = -1.0 / 3840.0;

/**
 * Frame on the baked `Hide` track where the rifle is lowered slightly into a
 * soldier low-ready stance while remaining visible in the camera frame.
 */
const HIDE_LOW_READY_FRAME = 10;
const DRAW_FROM_LOW_READY_FRAME = 22;

export interface SpieAnimContext {
  isMoving: boolean;
  isStrafing: boolean; // right click held
  moveDir: Vector3;
  camForward: Vector3;
  camRight: Vector3;
  camAlpha: number;
  rotationY: number;
}

export interface CharacterVisual {
  root: Mesh;
  characterType: CharacterType;
  muzzleNode: TransformNode | null;
  muzzleFlashMesh: Mesh | null;
  playAnimation: (animName: string) => void;
  updateAnimation?: (dtSeconds: number, context: SpieAnimContext) => void;
  triggerReload?: () => boolean;
  triggerHide?: () => void;
  getCurrentAnimation: () => string;
  dispose: () => void;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Fixes the bind-pose vertex scale and winding on the arm/hand/shirt meshes
 * (`Object_91`, `Object_92`, `Object_93`) inside `fps_merc_m4a1.glb` so they
 * attach properly to the M4A1 instead of appearing gigantic in the sky.
 */
function normalizeMercContainerGeometry(container: AssetContainer): void {
  const targetNames = new Set(['Object_91', 'Object_92', 'Object_93']);

  for (const mesh of container.meshes) {
    if (!targetNames.has(mesh.name)) continue;

    const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
    if (positions && positions.length > 0) {
      let maxAbs = 0;
      for (let i = 0; i < Math.min(positions.length, 60); i++) {
        const a = Math.abs(positions[i]);
        if (a > maxAbs) maxAbs = a;
      }

      if (maxAbs > 100) {
        const scaledPos = new Float32Array(positions.length);
        for (let i = 0; i < positions.length; i++) {
          scaledPos[i] = positions[i] * ARM_VERTEX_CORRECTION_SCALE;
        }
        mesh.setVerticesData(VertexBuffer.PositionKind, scaledPos, false);

        const normals = mesh.getVerticesData(VertexBuffer.NormalKind);
        if (normals && normals.length > 0) {
          const flippedNormals = new Float32Array(normals.length);
          for (let i = 0; i < normals.length; i++) {
            flippedNormals[i] = -normals[i];
          }
          mesh.setVerticesData(VertexBuffer.NormalKind, flippedNormals, false);
        }

        const indices = mesh.getIndices();
        if (indices && indices.length >= 3) {
          const flippedIndices = new Uint32Array(indices.length);
          for (let i = 0; i < indices.length; i += 3) {
            flippedIndices[i] = indices[i];
            flippedIndices[i + 1] = indices[i + 2];
            flippedIndices[i + 2] = indices[i + 1];
          }
          mesh.setIndices(flippedIndices, null);
        }

        if (mesh.material) {
          mesh.material.backFaceCulling = false;
        }

        mesh.refreshBoundingInfo({});
      }
    }
  }
}

/**
 * Preloads both `spy.glb` (Spie) and `fps_merc_m4a1.glb` (Merc) into
 * reusable Babylon AssetContainers.
 */
export async function loadCharacterAssets(
  scene: Scene
): Promise<CharacterAssets> {
  const [spieContainer, mercContainer] = await Promise.all([
    SceneLoader.LoadAssetContainerAsync(
      './assets/characters/',
      'spy.glb',
      scene
    ),
    SceneLoader.LoadAssetContainerAsync(
      './assets/characters/',
      'fps_merc_m4a1.glb',
      scene
    ),
  ]);

  normalizeMercContainerGeometry(mercContainer);

  return { spieContainer, mercContainer };
}

/**
 * Legacy helper alias for loading `spy.glb`.
 */
export async function loadPlayerAssetContainer(
  scene: Scene
): Promise<AssetContainer> {
  return SceneLoader.LoadAssetContainerAsync(
    './assets/characters/',
    'spy.glb',
    scene
  );
}

/**
 * Computes the raw bounding-box height and minimum base Y of a character asset container
 * to automatically scale and ground any custom imported character model.
 */
function computeModelHeightAndBaseY(container: AssetContainer): {
  height: number;
  baseY: number;
} {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const m of container.meshes) {
    if (m.name === '__root__' || m.getTotalVertices() === 0) continue;
    m.computeWorldMatrix(true);
    const b = m.getBoundingInfo().boundingBox;
    if (b.minimumWorld.y < minY) minY = b.minimumWorld.y;
    if (b.maximumWorld.y > maxY) maxY = b.maximumWorld.y;
  }
  const height = maxY - minY;
  if (!Number.isFinite(height) || height < 0.01) {
    return { height: 1.76, baseY: 0 };
  }
  return { height, baseY: Number.isFinite(minY) ? minY : 0 };
}

/**
 * Normalizes an angle in radians into the range [-PI, PI].
 */
export function normalizeAngle(angle: number): number {
  let diff = (angle + Math.PI) % (Math.PI * 2);
  if (diff < 0) {
    diff += Math.PI * 2;
  }
  return diff - Math.PI;
}

export type SpieAnimationName =
  | 'idle'
  | 'walking'
  | 'start-walking'
  | 'stop-walking'
  | 'walking-turn-180'
  | 'left-turn'
  | 'right-turn'
  | 'left-strafe-walking'
  | 'right-strafe-walking';

interface SpieTrack {
  name: SpieAnimationName;
  group: AnimationGroup;
  currentWeight: number;
  targetWeight: number;
  isLooping: boolean;
  speedRatio: number;
  durationSec: number;
}

const SPIE_TRACK_CONFIGS: Array<{
  name: SpieAnimationName;
  isLooping: boolean;
  speedRatio: number;
}> = [
  { name: 'idle', isLooping: true, speedRatio: 1.0 },
  { name: 'walking', isLooping: true, speedRatio: 1.25 },
  { name: 'left-strafe-walking', isLooping: true, speedRatio: 1.25 },
  { name: 'right-strafe-walking', isLooping: true, speedRatio: 1.25 },
  { name: 'start-walking', isLooping: false, speedRatio: 1.45 },
  { name: 'stop-walking', isLooping: false, speedRatio: 1.45 },
  { name: 'walking-turn-180', isLooping: false, speedRatio: 1.5 },
  { name: 'left-turn', isLooping: false, speedRatio: 1.4 },
  { name: 'right-turn', isLooping: false, speedRatio: 1.4 },
];

function resolveSpieAnimName(rawName: string): SpieAnimationName | null {
  const lower = rawName.toLowerCase();
  if (lower === 'idle') return 'idle';
  if (lower === 'walking' || lower === 'walk' || lower === 'run') return 'walking';
  if (lower === 'start-walking' || lower === 'start_walking') return 'start-walking';
  if (lower === 'stop-walking' || lower === 'stop_walking') return 'stop-walking';
  if (
    lower === 'walking-turn-180' ||
    lower === 'walking_turn_180' ||
    lower === 'turn-180'
  ) {
    return 'walking-turn-180';
  }
  if (lower === 'left-turn' || lower === 'left_turn' || lower === 'turn-left') {
    return 'left-turn';
  }
  if (
    lower === 'right-turn' ||
    lower === 'right_turn' ||
    lower === 'turn-right'
  ) {
    return 'right-turn';
  }
  if (
    lower === 'left-strafe' ||
    lower === 'left-strafe-walking' ||
    lower === 'strafe-left'
  ) {
    return 'left-strafe-walking';
  }
  if (
    lower === 'right-strafe' ||
    lower === 'right-strafe-walking' ||
    lower === 'strafe-right'
  ) {
    return 'right-strafe-walking';
  }
  return null;
}

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
      node.scaling.setAll(scale);
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

  const findGroup = (target: string): AnimationGroup | undefined => {
    return instantiated.animationGroups.find(
      (ag) => ag.name === target || ag.name.endsWith('|' + target)
    );
  };

  const tracks = new Map<SpieAnimationName, SpieTrack>();
  for (const cfg of SPIE_TRACK_CONFIGS) {
    const ag = findGroup(cfg.name);
    if (ag) {
      const durationSec = (ag.to - ag.from) / (60.0 * cfg.speedRatio);
      tracks.set(cfg.name, {
        ...cfg,
        group: ag,
        currentWeight: cfg.name === 'idle' ? 1.0 : 0.0,
        targetWeight: cfg.name === 'idle' ? 1.0 : 0.0,
        durationSec,
      });
    }
  }

  const idleTrack = tracks.get('idle');
  if (idleTrack) {
    idleTrack.group.start(true, idleTrack.speedRatio);
    idleTrack.group.setWeightForAllAnimatables(1.0);
  }

  let currentState: SpieAnimationName = 'idle';
  let isSingleShot = false;
  let singleShotElapsed = 0;
  let singleShotDuration = 0;

  const setTarget = (name: SpieAnimationName, isSingle = false): void => {
    currentState = name;
    isSingleShot = isSingle;
    const targetTrack = tracks.get(name);
    if (!targetTrack) return;

    for (const [tName, track] of tracks) {
      if (tName === name) {
        track.targetWeight = 1.0;
        if (isSingle) {
          singleShotElapsed = 0;
          singleShotDuration = track.durationSec;
          track.group.reset();
          track.group.start(false, track.speedRatio);
        } else if (!track.group.isPlaying) {
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
    // 1. Single-shot timers & early crossfade triggers
    if (isSingleShot) {
      singleShotElapsed += dtSeconds;

      if (currentState === 'start-walking') {
        if (!context.isMoving) {
          setTarget('stop-walking', true);
        } else if (singleShotElapsed >= singleShotDuration * 0.65) {
          const walkTrack = tracks.get('walking');
          const swTrack = tracks.get('start-walking');
          if (walkTrack && swTrack) {
            walkTrack.targetWeight = 1.0;
            swTrack.targetWeight = 0.0;
            if (!walkTrack.group.isPlaying) {
              walkTrack.group.start(true, walkTrack.speedRatio);
            }
          }
          if (singleShotElapsed >= singleShotDuration) {
            isSingleShot = false;
            currentState = 'walking';
          }
        }
      } else if (currentState === 'stop-walking') {
        if (context.isMoving) {
          setTarget('start-walking', true);
        } else if (singleShotElapsed >= singleShotDuration * 0.65) {
          const idleT = tracks.get('idle');
          const stopT = tracks.get('stop-walking');
          if (idleT && stopT) {
            idleT.targetWeight = 1.0;
            stopT.targetWeight = 0.0;
            if (!idleT.group.isPlaying) {
              idleT.group.start(true, idleT.speedRatio);
            }
          }
          if (singleShotElapsed >= singleShotDuration) {
            isSingleShot = false;
            currentState = 'idle';
          }
        }
      } else if (currentState === 'walking-turn-180') {
        if (!context.isMoving) {
          setTarget('stop-walking', true);
        } else if (singleShotElapsed >= singleShotDuration * 0.65) {
          const walkTrack = tracks.get('walking');
          const t180Track = tracks.get('walking-turn-180');
          if (walkTrack && t180Track) {
            walkTrack.targetWeight = 1.0;
            t180Track.targetWeight = 0.0;
            if (!walkTrack.group.isPlaying) {
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
          setTarget('stop-walking', true);
        } else if (singleShotElapsed >= singleShotDuration * 0.65) {
          const walkTrack = tracks.get('walking');
          const turnT = tracks.get(currentState);
          if (walkTrack && turnT) {
            walkTrack.targetWeight = 1.0;
            turnT.targetWeight = 0.0;
            if (!walkTrack.group.isPlaying) {
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

    // 2. State selection
    if (context.isStrafing) {
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
        // Turning to movement direction when starting to move from stationary standing
        const moveAngle = Math.atan2(context.moveDir.x, context.moveDir.z);
        const turnAngle = normalizeAngle(moveAngle - context.rotationY);

        if (turnAngle <= -0.65 && turnAngle > -2.35) {
          setTarget('left-turn', true);
        } else if (turnAngle >= 0.65 && turnAngle < 2.35) {
          setTarget('right-turn', true);
        } else if (Math.abs(turnAngle) >= 2.35) {
          setTarget('walking-turn-180', true);
        } else {
          setTarget('start-walking', true);
        }
      } else if (context.isMoving && wasMoving) {
        const dot = Vector3.Dot(context.moveDir, lastMoveDir);
        if (dot < -0.6) {
          setTarget('walking-turn-180', true);
        } else if (!isSingleShot && currentState !== 'walking') {
          setTarget('walking');
        }
      } else if (!context.isMoving && wasMoving) {
        setTarget('stop-walking', true);
      } else if (!context.isMoving && !wasMoving && !isSingleShot) {
        // When stationary standing: do not follow camera orbit; remain in idle
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

  // Continuous before-render observer for smooth weight blending & normalization
  const BLEND_RATE = 8.5;
  const renderObserver = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(
      0.05,
      (scene.getEngine().getDeltaTime() || 16.6) / 1000.0
    );
    let totalWeight = 0;
    for (const track of tracks.values()) {
      const diff = track.targetWeight - track.currentWeight;
      track.currentWeight += diff * Math.min(1.0, dt * BLEND_RATE);
      track.currentWeight = Math.max(0, Math.min(1.0, track.currentWeight));
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
  });

  const playAnimation = (animName: string): void => {
    const resolved = resolveSpieAnimName(animName);
    if (!resolved) return;
    const isSingle =
      resolved === 'start-walking' ||
      resolved === 'stop-walking' ||
      resolved === 'walking-turn-180' ||
      resolved === 'left-turn' ||
      resolved === 'right-turn';
    setTarget(resolved, isSingle);
  };

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
    dispose,
  };
}

/**
 * Synthesizes a static looping AnimationGroup from a specific keyframe index
 * of a source AnimationGroup.
 */
function createStaticPoseAnimationGroupAtFrame(
  groupName: string,
  sourceGroup: AnimationGroup,
  targetFrame: number,
  scene: Scene
): AnimationGroup {
  const staticGroup = new AnimationGroup(groupName, scene);

  for (const ta of sourceGroup.targetedAnimations) {
    const srcAnim = ta.animation;
    const keys = srcAnim.getKeys();
    if (!keys || keys.length === 0) continue;

    let bestKey = keys[keys.length - 1];
    let bestDist = Math.abs(bestKey.frame - targetFrame);
    for (const k of keys) {
      const d = Math.abs(k.frame - targetFrame);
      if (d < bestDist) {
        bestDist = d;
        bestKey = k;
      }
    }

    const rawValue = bestKey.value;
    const val0 =
      rawValue && typeof rawValue.clone === 'function'
        ? rawValue.clone()
        : rawValue;
    const val1 =
      rawValue && typeof rawValue.clone === 'function'
        ? rawValue.clone()
        : rawValue;

    const anim = new Animation(
      `${srcAnim.name}_${groupName}`,
      srcAnim.targetProperty,
      srcAnim.framePerSecond || 30,
      srcAnim.dataType,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );
    anim.setKeys([
      { frame: 0, value: val0 },
      { frame: 30, value: val1 },
    ]);
    staticGroup.addTargetedAnimation(anim, ta.target);
  }

  return staticGroup;
}

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

  const dispose = (): void => {
    stateToken++;
    for (const ag of instantiated.animationGroups) {
      ag.dispose();
    }
    for (const ag of synthesizedGroups) {
      ag.dispose();
    }
    for (const skel of instantiated.skeletons as Skeleton[]) {
      skel.dispose();
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
    dispose,
  };
}

/**
 * Shortest-angle interpolation on [-PI, PI] for smooth character turning.
 */
export function lerpAngleY(
  current: number,
  target: number,
  factor: number
): number {
  const diff = normalizeAngle(target - current);
  return current + diff * Math.min(1.0, factor);
}

/**
 * Local player controller supporting both 'Spie' (third-person) and 'Merc'
 * (first-person M4A1 viewmodel with magazine-based ammunition, procedural ADS,
 * automatic firing, procedural recoil, bullet projectiles, muzzle flash,
 * surface impacts, and barrel smoke).
 */
export class LocalPlayer {
  public readonly characterType: CharacterType;
  public readonly visual: CharacterVisual;
  public readonly mesh: Mesh;
  public readonly body: RAPIER.RigidBody;
  public readonly fpCamera: FreeCamera | null = null;
  public rotationY = 0;
  public currentAnim = 'Idle';

  private pitchX = 0;
  private targetRotationY = 0;
  private readonly world: RAPIER.World;
  private readonly combatEffects: CombatEffectsManager;
  private readonly keys: Record<string, boolean> = {};
  private jumpRequested = false;
  private jumpedThisFrame = false;

  // Magazine-based ammunition state (1 loaded magazine + 4 individual reserve magazines)
  private currentMagazineRounds = MAGAZINE_CAPACITY;
  private readonly reserveMagazines: number[] = [];

  // Firing & ADS input state
  private isRightClickHeld = false;
  private isFiringHeld = false;
  private fireCooldown = 0;
  private burstShotsFired = 0;
  private isAdsHeld = false;
  private isAdsToggled = false;
  private rmbDownTimestamp = 0;
  private adsBlend = 0;

  // Queued network shot events for replication
  private readonly pendingShots: NetworkShotEvent[] = [];

  // Procedural Recoil State (viewmodel kick + camera climb/shake + spring recovery)
  private recoilPosX = 0;
  private recoilPosY = 0;
  private recoilPosZ = 0;
  private recoilVelZ = 0;
  private recoilPitchX = 0;
  private recoilPitchVelX = 0;
  private recoilYawY = 0;
  private camRecoilPitch = 0;
  private camRecoilYaw = 0;

  // First-person viewmodel rig & procedural motion state (Merc)
  private readonly viewmodelRig: TransformNode | null = null;
  private bobTimer = 0;
  private bobOffsetX = 0;
  private bobOffsetY = 0;
  private bobRollZ = 0;

  private wasGrounded = true;
  private jumpLagY = 0;
  private jumpPitchX = 0;
  private landSpringPosY = 0;
  private landSpringVelY = 0;

  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private swayPosX = 0;
  private swayPosY = 0;
  private swayRotX = 0;
  private swayRotY = 0;

  private crouchBlend = 0;
  private lowReadyBlend = 0;
  private currentEyeOffset = STANDING_EYE_OFFSET;

  // DOM HUD references
  private readonly crosshairEl: HTMLElement | null;
  private readonly ammoHudEl: HTMLElement | null;
  private readonly ammoRoundsEl: HTMLElement | null;
  private readonly ammoMagsBarsEl: HTMLElement | null;
  private readonly ammoMagsCountEl: HTMLElement | null;

  // Pre-allocated scratch vectors to avoid GC pauses in the render loop
  private readonly forwardScratch = new Vector3();
  private readonly rightScratch = new Vector3();
  private readonly moveDirScratch = new Vector3();

  constructor(
    scene: Scene,
    world: RAPIER.World,
    assets: CharacterAssets,
    characterType: CharacterType,
    combatEffects: CombatEffectsManager
  ) {
    this.world = world;
    this.characterType = characterType;
    this.combatEffects = combatEffects;
    this.body = createPlayerCylinderBody(world, 0, 2.0, 0);

    this.crosshairEl = document.getElementById('crosshair');
    this.ammoHudEl = document.getElementById('ammo-hud');
    this.ammoRoundsEl = document.getElementById('ammo-rounds');
    this.ammoMagsBarsEl = document.getElementById('ammo-mags-bars');
    this.ammoMagsCountEl = document.getElementById('ammo-mags-count');

    // Initialize 4 reserve magazines of 30 rounds each (5 magazines total with loaded mag)
    for (let i = 0; i < INITIAL_RESERVE_MAGAZINES; i++) {
      this.reserveMagazines.push(MAGAZINE_CAPACITY);
    }

    if (characterType === 'Merc') {
      // Invisible physics sync root so no third-person body obstructs the camera
      this.mesh = new Mesh('local_merc_collision_root', scene);
      this.mesh.isVisible = false;
      this.mesh.isPickable = false;

      // First-person camera at player eye level (72 deg hip-fire FOV)
      const fpCam = new FreeCamera(
        'mercFirstPersonCamera',
        new Vector3(0, 2.0 + STANDING_EYE_OFFSET, 0),
        scene
      );
      fpCam.minZ = 0.02;
      fpCam.fov = HIP_FOV_RAD;
      fpCam.inputs.clear();
      this.fpCamera = fpCam;

      // Procedural motion rig attached directly to the first-person camera
      const rig = new TransformNode('mercViewmodelRig', scene);
      rig.parent = fpCam;
      this.viewmodelRig = rig;

      // Instantiate Merc viewmodel attached to the procedural rig
      this.visual = createMercVisual(
        'local_merc_viewmodel',
        scene,
        assets.mercContainer,
        true
      );
      this.visual.root.parent = rig;
      this.currentAnim = this.visual.getCurrentAnimation();

      // Reveal tactical ammunition HUD in bottom-right corner
      this.ammoHudEl?.classList.remove('hidden');
      this.updateAmmoHud();
    } else {
      this.visual = createSpieVisual(
        'local_spie_player',
        scene,
        assets.spieContainer
      );
      this.mesh = this.visual.root;
      this.currentAnim = 'Idle';
    }

    this.initInput();
  }

  private updateAmmoHud(): void {
    if (this.ammoRoundsEl) {
      this.ammoRoundsEl.textContent = String(this.currentMagazineRounds);
      this.ammoRoundsEl.classList.toggle(
        'low',
        this.currentMagazineRounds > 0 && this.currentMagazineRounds <= 8
      );
      this.ammoRoundsEl.classList.toggle(
        'empty',
        this.currentMagazineRounds === 0
      );
    }

    const reserveCount = this.reserveMagazines.length;
    if (this.ammoMagsBarsEl) {
      const bars = '|'.repeat(reserveCount);
      this.ammoMagsBarsEl.textContent =
        reserveCount > 0 ? `[ ${bars} ]` : '[   ]';
    }
    if (this.ammoMagsCountEl) {
      this.ammoMagsCountEl.textContent = `${reserveCount} ${
        reserveCount === 1 ? 'MAG' : 'MAGS'
      }`;
    }
  }

  /**
   * Tactical Reload ('R' key):
   * Triggered if not already reloading, not drawing, and spare magazines exist.
   * Discards the current magazine (forgetting any remaining rounds inside it)
   * and loads the next magazine from `reserveMagazines`.
   */
  private tryTacticalReload(): void {
    const anim = this.visual.getCurrentAnimation();
    if (anim === 'Reload' || anim === 'Draw') {
      return;
    }
    if (this.reserveMagazines.length <= 0) {
      return;
    }

    const started = this.visual.triggerReload?.() ?? false;
    if (!started) return;

    // Exit ADS and stop firing when reloading
    this.isAdsHeld = false;
    this.isAdsToggled = false;
    this.stopFiringBurstIfNeeded();

    // Discard current magazine and load the next individual magazine
    const nextMagRounds = this.reserveMagazines.shift() ?? MAGAZINE_CAPACITY;
    this.currentMagazineRounds = nextMagRounds;
    this.currentAnim = this.visual.getCurrentAnimation();
    this.updateAmmoHud();
  }

  private stopFiringBurstIfNeeded(): void {
    if (this.burstShotsFired >= BURST_SMOKE_THRESHOLD) {
      this.combatEffects.spawnBarrelSmoke(this.visual.muzzleNode);
    }
    this.burstShotsFired = 0;
  }

  private initInput(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this.keys[e.code] = true;

      if (e.code === 'Space' && !e.repeat) {
        this.jumpRequested = true;
      }

      if (this.characterType === 'Merc' && !e.repeat) {
        if (e.code === 'KeyR') {
          this.tryTacticalReload();
        } else if (e.code === 'KeyH') {
          this.isAdsHeld = false;
          this.isAdsToggled = false;
          this.stopFiringBurstIfNeeded();
          this.visual.triggerHide?.();
          this.currentAnim = this.visual.getCurrentAnimation();
        }
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    });

    // NOTE: Pointer events are used instead of mousedown/mouseup because
    // Babylon's scene InputManager calls preventDefault() on canvas
    // `pointerdown`, which suppresses legacy mouse events.
    //
    // CRITICAL: We deliberately DO NOT listen to `pointermove` for button state!
    // Under pointer lock (especially on Linux/Wayland and in Firefox), `pointermove`
    // events often report `e.buttons === 0` during cursor translation.
    // Relying on `pointermove` to detect LMB state caused the weapon to stop firing
    // immediately whenever the mouse was moved.
    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      // Ignore clicks before pointer lock is active (e.g. clicking selection menu)
      if (document.pointerLockElement === null) return;

      if (e.button === 2) {
        this.isRightClickHeld = true;
      }

      if (this.characterType === 'Merc') {
        if (e.button === 0) {
          this.isFiringHeld = true;
        } else if (e.button === 2) {
          this.rmbDownTimestamp = performance.now();
          if (this.isAdsToggled) {
            this.isAdsToggled = false;
            this.isAdsHeld = false;
          } else {
            this.isAdsHeld = true;
          }
        }
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;

      if (e.button === 2) {
        this.isRightClickHeld = false;
      }

      if (this.characterType === 'Merc') {
        if (e.button === 0) {
          this.isFiringHeld = false;
          this.stopFiringBurstIfNeeded();
        } else if (e.button === 2) {
          const heldMs = performance.now() - this.rmbDownTimestamp;
          if (this.isAdsHeld && heldMs < 180) {
            // Short click toggles ADS on
            this.isAdsToggled = true;
          }
          this.isAdsHeld = false;
        }
      }
    };

    const resetAimAndFiring = (): void => {
      this.isRightClickHeld = false;
      this.isFiringHeld = false;
      this.isAdsHeld = false;
      this.isAdsToggled = false;
      this.stopFiringBurstIfNeeded();
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', resetAimAndFiring);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === null) {
        resetAimAndFiring();
      }
    });

    window.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
    });

    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys)) {
        this.keys[k] = false;
      }
      resetAimAndFiring();
    });
  }

  public handleMouseMove(
    movementX: number,
    movementY: number,
    arcCamera: ArcRotateCamera | null
  ): void {
    if (this.characterType === 'Merc') {
      const sens =
        MOUSE_SENSITIVITY +
        (ADS_MOUSE_SENSITIVITY - MOUSE_SENSITIVITY) * this.adsBlend;
      this.rotationY += movementX * sens;
      this.pitchX = clamp(
        this.pitchX + movementY * sens,
        -Math.PI / 2.15,
        Math.PI / 2.15
      );
      this.lookDeltaX += movementX;
      this.lookDeltaY += movementY;
    } else if (arcCamera) {
      arcCamera.alpha -= movementX * MOUSE_SENSITIVITY;
      const lowerBeta = arcCamera.lowerBetaLimit ?? 0.25;
      const upperBeta = arcCamera.upperBetaLimit ?? Math.PI / 2 - 0.08;
      arcCamera.beta = clamp(
        arcCamera.beta - movementY * MOUSE_SENSITIVITY,
        lowerBeta,
        upperBeta
      );
    }
  }

  public setSpawnPosition(
    x: number,
    y: number,
    z: number,
    rotationY = 0
  ): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rotationY = rotationY;
    this.targetRotationY = rotationY;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotationY;

    if (this.fpCamera) {
      this.fpCamera.position.set(x, y + this.currentEyeOffset, z);
      this.fpCamera.rotation.set(this.pitchX, this.rotationY, 0);
    }
  }

  public consumeJumpEvent(): boolean {
    const jumped = this.jumpedThisFrame;
    this.jumpedThisFrame = false;
    return jumped;
  }

  public consumePendingShots(): NetworkShotEvent[] {
    if (this.pendingShots.length === 0) return [];
    return this.pendingShots.splice(0, this.pendingShots.length);
  }

  /**
   * Fires a single round from the currently loaded magazine:
   * - Deducts 1 round and updates the HUD
   * - Triggers a single-frame randomized muzzle flash at the barrel tip
   * - Spawns a high-velocity yellow bullet cylinder along the aim ray
   * - Applies procedural viewmodel recoil snap and camera climb/shake
   * - Queues a lightweight network shoot event for remote replication
   */
  private fireSingleRound(): void {
    if (!this.fpCamera) return;

    this.currentMagazineRounds = Math.max(0, this.currentMagazineRounds - 1);
    this.burstShotsFired++;
    this.updateAmmoHud();

    // Ensure camera and viewmodel world matrices are current before sampling muzzle
    this.fpCamera.computeWorldMatrix();
    const muzzleNode = this.visual.muzzleNode;
    let muzzleOrigin: Vector3;
    if (muzzleNode) {
      muzzleNode.computeWorldMatrix(true);
      muzzleOrigin = muzzleNode.getAbsolutePosition().clone();
    } else {
      muzzleOrigin = this.fpCamera.position.clone();
    }

    // Compute camera center aim ray so bullets converge cleanly on the target point
    const camPos = this.fpCamera.position;
    const totalPitch = this.pitchX + this.camRecoilPitch;
    const totalYaw = this.rotationY + this.camRecoilYaw;
    const cosP = Math.cos(totalPitch);
    const aimDir = new Vector3(
      Math.sin(totalYaw) * cosP,
      -Math.sin(totalPitch),
      Math.cos(totalYaw) * cosP
    ).normalize();

    const aimRay = new RAPIER.Ray(
      { x: camPos.x, y: camPos.y, z: camPos.z },
      { x: aimDir.x, y: aimDir.y, z: aimDir.z }
    );
    const hit = this.world.castRay(
      aimRay,
      150.0,
      true,
      undefined,
      undefined,
      undefined,
      this.body
    );

    const targetDist = hit !== null && hit.timeOfImpact > 1.2 ? hit.timeOfImpact : 120.0;
    const targetPoint = new Vector3(
      camPos.x + aimDir.x * targetDist,
      camPos.y + aimDir.y * targetDist,
      camPos.z + aimDir.z * targetDist
    );

    const bulletDir = targetPoint.subtract(muzzleOrigin).normalize();

    // 1. Single-frame randomized muzzle flash at barrel tip
    this.combatEffects.triggerSingleFrameMuzzleFlash(
      this.visual.muzzleFlashMesh
    );

    // 2. Spawn fast yellow bullet projectile from barrel tip
    this.combatEffects.spawnBullet(muzzleOrigin, bulletDir, this.body);

    // 3. Queue network shoot replication packet
    this.pendingShots.push({
      originX: muzzleOrigin.x,
      originY: muzzleOrigin.y,
      originZ: muzzleOrigin.z,
      dirX: bulletDir.x,
      dirY: bulletDir.y,
      dirZ: bulletDir.z,
    });

    // 4. Procedural Recoil (Viewmodel Snap + Camera Climb & Jitter)
    const adsFactor = this.adsBlend;
    const isAds = adsFactor > 0.5;

    // Push viewmodel backward toward camera & kick muzzle upward
    const kickBackZ = isAds ? 0.015 : 0.024;
    const kickUpPitch = isAds ? 0.016 : 0.036;
    const randHoriz = (Math.random() - 0.5) * (isAds ? 0.0025 : 0.009);

    this.recoilPosZ = Math.max(this.recoilPosZ - kickBackZ, -0.055);
    this.recoilVelZ -= isAds ? 0.18 : 0.32;
    this.recoilPosY = Math.min(
      this.recoilPosY + (isAds ? 0.002 : 0.005),
      0.014
    );
    this.recoilPosX = clamp(this.recoilPosX + randHoriz, -0.016, 0.016);

    // In Babylon camera space, negative X rotation pitches the muzzle upward
    this.recoilPitchX = Math.max(this.recoilPitchX - kickUpPitch, -0.13);
    this.recoilPitchVelX -= isAds ? 0.35 : 0.75;
    this.recoilYawY = clamp(this.recoilYawY + randHoriz * 1.4, -0.035, 0.035);

    // Subtle camera climb (upward pitch) and minor horizontal shake
    const camPitchClimb = isAds ? 0.007 : 0.011;
    const camYawJitter = (Math.random() - 0.5) * (isAds ? 0.0045 : 0.0085);
    this.pitchX = clamp(
      this.pitchX - camPitchClimb * 0.45,
      -Math.PI / 2.15,
      Math.PI / 2.15
    );
    this.camRecoilPitch = Math.max(
      this.camRecoilPitch - camPitchClimb * 0.55,
      -0.065
    );
    this.camRecoilYaw = clamp(this.camRecoilYaw + camYawJitter, -0.03, 0.03);

    // If magazine just ran empty after a sustained burst, emit barrel smoke
    if (this.currentMagazineRounds === 0) {
      this.stopFiringBurstIfNeeded();
    }
  }

  public update(arcCamera: ArcRotateCamera | null, dtSeconds = 1 / 60): void {
    if (this.characterType === 'Merc') {
      this.updateMercFirstPerson(dtSeconds);
    } else {
      this.updateSpieThirdPerson(arcCamera, dtSeconds);
    }
  }

  private updateMercFirstPerson(dtSeconds: number): void {
    // 1. Forward and right vectors relative to first-person yaw (rotationY)
    const sinY = Math.sin(this.rotationY);
    const cosY = Math.cos(this.rotationY);
    this.forwardScratch.set(sinY, 0, cosY);
    this.rightScratch.set(cosY, 0, -sinY);

    // 2. Accumulate WASD movement input
    this.moveDirScratch.set(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.moveDirScratch.addInPlace(this.forwardScratch);
    }
    if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      this.moveDirScratch.subtractInPlace(this.forwardScratch);
    }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      this.moveDirScratch.addInPlace(this.rightScratch);
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      this.moveDirScratch.subtractInPlace(this.rightScratch);
    }

    this.currentAnim = this.visual.getCurrentAnimation();
    const canAimOrFire =
      this.currentAnim !== 'Reload' &&
      this.currentAnim !== 'Draw' &&
      this.currentAnim !== 'Hide' &&
      this.currentAnim !== 'Hidden';

    const wantsAds = canAimOrFire && (this.isAdsHeld || this.isAdsToggled);
    const isCrouching = Boolean(
      this.keys['ControlLeft'] || this.keys['ControlRight'] || this.keys['KeyC']
    );
    const isSprinting =
      !isCrouching &&
      !wantsAds &&
      Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

    const moveSpeed = isCrouching
      ? CROUCH_SPEED
      : wantsAds
        ? ADS_WALK_SPEED
        : isSprinting
          ? RUN_SPEED
          : WALK_SPEED;
    const isMovingHorizontally = this.moveDirScratch.lengthSquared() > 0.0001;

    const currentVel = this.body.linvel();
    let vx = 0;
    let vz = 0;

    if (isMovingHorizontally) {
      this.moveDirScratch.normalize();
      vx = this.moveDirScratch.x * moveSpeed;
      vz = this.moveDirScratch.z * moveSpeed;
    }

    this.body.setLinvel({ x: vx, y: currentVel.y, z: vz }, true);

    // 3. Spacebar Jump & Landing detection
    let grounded = isPlayerGrounded(this.world, this.body);
    if (this.jumpRequested) {
      if (grounded) {
        this.body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
        this.jumpedThisFrame = true;
        grounded = false;
        this.jumpLagY = -0.016;
        this.jumpPitchX = 0.022;
      }
      this.jumpRequested = false;
    }

    if (!this.wasGrounded && grounded) {
      this.landSpringVelY = -0.18;
    }
    this.wasGrounded = grounded;

    // Safety respawn if player falls off the map
    const pos = this.body.translation();
    if (pos.y < -15) {
      this.setSpawnPosition(0, 3, 0, this.rotationY);
      return;
    }

    // Sync collision root
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.rotation.y = this.rotationY;

    // 4. Procedural ADS transition (~150ms), Camera FOV zoom, and Crosshair fade
    const targetAds = wantsAds ? 1.0 : 0.0;
    const adsStep = dtSeconds / ADS_TRANSITION_DURATION;
    if (this.adsBlend < targetAds) {
      this.adsBlend = Math.min(targetAds, this.adsBlend + adsStep);
    } else if (this.adsBlend > targetAds) {
      this.adsBlend = Math.max(targetAds, this.adsBlend - adsStep);
    }

    if (this.crosshairEl) {
      this.crosshairEl.style.opacity = (1.0 - this.adsBlend).toFixed(2);
    }

    // 5. Procedural Crouching & Camera Recoil Spring Recovery
    const targetCrouch = isCrouching ? 1.0 : 0.0;
    this.crouchBlend +=
      (targetCrouch - this.crouchBlend) * Math.min(1.0, dtSeconds * 10.0);
    this.currentEyeOffset =
      STANDING_EYE_OFFSET +
      (CROUCH_EYE_OFFSET - STANDING_EYE_OFFSET) * this.crouchBlend;

    const camRecoilRecovery = Math.min(1.0, dtSeconds * 14.0);
    this.camRecoilPitch += (0 - this.camRecoilPitch) * camRecoilRecovery;
    this.camRecoilYaw += (0 - this.camRecoilYaw) * camRecoilRecovery;

    if (this.fpCamera) {
      this.fpCamera.fov =
        HIP_FOV_RAD + (ADS_FOV_RAD - HIP_FOV_RAD) * this.adsBlend;
      this.fpCamera.position.set(pos.x, pos.y + this.currentEyeOffset, pos.z);
      this.fpCamera.rotation.set(
        clamp(
          this.pitchX + this.camRecoilPitch,
          -Math.PI / 2.15,
          Math.PI / 2.15
        ),
        this.rotationY + this.camRecoilYaw,
        0
      );
    }

    // 6. Automatic Firing Logic (100ms cooldown, blocked during Reload/Draw/Empty)
    this.fireCooldown = Math.max(0, this.fireCooldown - dtSeconds);
    if (
      this.isFiringHeld &&
      canAimOrFire &&
      this.currentMagazineRounds > 0 &&
      this.fireCooldown <= 0
    ) {
      this.fireSingleRound();
      this.fireCooldown = FIRE_INTERVAL_SECONDS;
    }

    // 7. Viewmodel Recoil Spring Recovery
    const recoilStiff = 180.0;
    const recoilDamp = 18.0;
    this.recoilVelZ +=
      (-recoilStiff * this.recoilPosZ - recoilDamp * this.recoilVelZ) *
      dtSeconds;
    this.recoilPosZ += this.recoilVelZ * dtSeconds;

    this.recoilPitchVelX +=
      (-recoilStiff * this.recoilPitchX - recoilDamp * this.recoilPitchVelX) *
      dtSeconds;
    this.recoilPitchX += this.recoilPitchVelX * dtSeconds;

    const recoilReturnLerp = Math.min(1.0, dtSeconds * 16.0);
    this.recoilPosX += (0 - this.recoilPosX) * recoilReturnLerp;
    this.recoilPosY += (0 - this.recoilPosY) * recoilReturnLerp;
    this.recoilYawY += (0 - this.recoilYawY) * recoilReturnLerp;

    // 8. Procedural Movement Feel + ADS + Recoil on Viewmodel Rig
    if (this.viewmodelRig) {
      const adsSteadiness = 1.0 - 0.78 * this.adsBlend;

      // (a) Footstep Bobbing while moving on the ground
      if (grounded && isMovingHorizontally) {
        const bobFreq = isCrouching ? 6.5 : isSprinting ? 13.0 : 9.5;
        const bobAmpX =
          (isCrouching ? 0.005 : isSprinting ? 0.014 : 0.009) * adsSteadiness;
        const bobAmpY =
          (isCrouching ? 0.006 : isSprinting ? 0.016 : 0.01) * adsSteadiness;
        this.bobTimer += dtSeconds * bobFreq;

        const targetBobX = Math.cos(this.bobTimer) * bobAmpX;
        const targetBobY = -Math.abs(Math.sin(this.bobTimer)) * bobAmpY;
        const targetBobRoll = Math.cos(this.bobTimer) * 0.012 * adsSteadiness;

        const bobLerp = Math.min(1.0, dtSeconds * 12.0);
        this.bobOffsetX += (targetBobX - this.bobOffsetX) * bobLerp;
        this.bobOffsetY += (targetBobY - this.bobOffsetY) * bobLerp;
        this.bobRollZ += (targetBobRoll - this.bobRollZ) * bobLerp;
      } else {
        const damp = Math.min(1.0, dtSeconds * 10.0);
        this.bobOffsetX += (0 - this.bobOffsetX) * damp;
        this.bobOffsetY += (0 - this.bobOffsetY) * damp;
        this.bobRollZ += (0 - this.bobRollZ) * damp;
      }

      // (b) Jump & Landing Reaction
      const velY = this.body.linvel().y;
      const targetAirLagY = grounded
        ? 0
        : clamp(-velY * 0.002, -0.016, 0.016) * adsSteadiness;
      const targetAirPitchX = grounded
        ? 0
        : clamp(velY * 0.0035, -0.022, 0.022) * adsSteadiness;
      this.jumpLagY +=
        (targetAirLagY - this.jumpLagY) * Math.min(1.0, dtSeconds * 12.0);
      this.jumpPitchX +=
        (targetAirPitchX - this.jumpPitchX) * Math.min(1.0, dtSeconds * 12.0);

      const springStiffness = 170.0;
      const springDamping = 16.0;
      const springAccel =
        -springStiffness * this.landSpringPosY -
        springDamping * this.landSpringVelY;
      this.landSpringVelY += springAccel * dtSeconds;
      this.landSpringPosY += this.landSpringVelY * dtSeconds;

      // (c) Snappy Look Sway
      const targetSwayX =
        clamp(-this.lookDeltaX * 0.00028, -0.01, 0.01) * adsSteadiness;
      const targetSwayY =
        clamp(this.lookDeltaY * 0.00028, -0.01, 0.01) * adsSteadiness;
      const targetSwayRotY =
        clamp(-this.lookDeltaX * 0.00055, -0.018, 0.018) * adsSteadiness;
      const targetSwayRotX =
        clamp(-this.lookDeltaY * 0.00055, -0.018, 0.018) * adsSteadiness;

      const swayLerp = Math.min(1.0, dtSeconds * 18.0);
      this.swayPosX += (targetSwayX - this.swayPosX) * swayLerp;
      this.swayPosY += (targetSwayY - this.swayPosY) * swayLerp;
      this.swayRotX += (targetSwayRotX - this.swayRotX) * swayLerp;
      this.swayRotY += (targetSwayRotY - this.swayRotY) * swayLerp;

      const deltaDecay = Math.min(1.0, dtSeconds * 28.0);
      this.lookDeltaX *= 1.0 - deltaDecay;
      this.lookDeltaY *= 1.0 - deltaDecay;

      // (d) Crouch & Low-Ready ('H' key) offsets (suppressed while aiming down sights)
      const isLowReady =
        this.currentAnim === 'Hide' || this.currentAnim === 'Hidden';
      const targetLowReady = isLowReady ? 1.0 : 0.0;
      this.lowReadyBlend +=
        (targetLowReady - this.lowReadyBlend) * Math.min(1.0, dtSeconds * 9.0);

      const hipFactor = 1.0 - this.adsBlend;
      const crouchOffsetX = -0.01 * this.crouchBlend * hipFactor;
      const crouchOffsetY = -0.022 * this.crouchBlend * hipFactor;
      const crouchRollZ = -0.035 * this.crouchBlend * hipFactor;

      const lowReadyOffsetX = -0.012 * this.lowReadyBlend;
      const lowReadyOffsetY = -0.032 * this.lowReadyBlend;
      const lowReadyPitchX = 0.08 * this.lowReadyBlend;
      const lowReadyYawY = -0.08 * this.lowReadyBlend;
      const lowReadyRollZ = -0.06 * this.lowReadyBlend;

      // (e) Procedural ADS iron-sight centering shift
      const adsPosX = ADS_OFFSET_X * this.adsBlend;
      const adsPosY = ADS_OFFSET_Y * this.adsBlend;
      const adsPosZ = ADS_OFFSET_Z * this.adsBlend;

      this.viewmodelRig.position.set(
        adsPosX +
          this.bobOffsetX +
          this.swayPosX +
          crouchOffsetX +
          lowReadyOffsetX +
          this.recoilPosX,
        adsPosY +
          this.bobOffsetY +
          this.jumpLagY +
          this.landSpringPosY +
          this.swayPosY +
          crouchOffsetY +
          lowReadyOffsetY +
          this.recoilPosY,
        adsPosZ + this.recoilPosZ
      );

      this.viewmodelRig.rotation.set(
        this.jumpPitchX +
          this.swayRotX +
          lowReadyPitchX +
          this.recoilPitchX,
        this.swayRotY + lowReadyYawY + this.recoilYawY,
        this.bobRollZ + crouchRollZ + lowReadyRollZ
      );
    }
  }

  private updateSpieThirdPerson(
    camera: ArcRotateCamera | null,
    dtSeconds: number
  ): void {
    const alpha = camera ? camera.alpha : -Math.PI / 2;
    this.forwardScratch.set(-Math.cos(alpha), 0, -Math.sin(alpha));
    this.forwardScratch.normalize();

    Vector3.CrossToRef(
      Vector3.UpReadOnly,
      this.forwardScratch,
      this.rightScratch
    );
    this.rightScratch.normalize();

    this.moveDirScratch.set(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.moveDirScratch.addInPlace(this.forwardScratch);
    }
    if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      this.moveDirScratch.subtractInPlace(this.forwardScratch);
    }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      this.moveDirScratch.addInPlace(this.rightScratch);
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      this.moveDirScratch.subtractInPlace(this.rightScratch);
    }

    const isSprinting = Boolean(
      this.keys['ShiftLeft'] || this.keys['ShiftRight']
    );
    const moveSpeed = isSprinting ? RUN_SPEED : WALK_SPEED;
    const isMovingHorizontally = this.moveDirScratch.lengthSquared() > 0.0001;

    const currentVel = this.body.linvel();
    let vx = 0;
    let vz = 0;

    if (isMovingHorizontally) {
      this.moveDirScratch.normalize();
      vx = this.moveDirScratch.x * moveSpeed;
      vz = this.moveDirScratch.z * moveSpeed;
    }

    this.body.setLinvel({ x: vx, y: currentVel.y, z: vz }, true);

    let grounded = isPlayerGrounded(this.world, this.body);
    if (this.jumpRequested) {
      if (grounded) {
        this.body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
        this.jumpedThisFrame = true;
        grounded = false;
      }
      this.jumpRequested = false;
    }

    // Character rotation & heading
    const camAngle = Math.atan2(this.forwardScratch.x, this.forwardScratch.z);
    if (this.isRightClickHeld) {
      // In strafing mode (holding RMB): character locks facing towards camera look direction
      this.targetRotationY = camAngle;
      this.rotationY = lerpAngleY(
        this.rotationY,
        this.targetRotationY,
        dtSeconds * 20.0
      );
    } else if (isMovingHorizontally) {
      // In normal movement: character faces movement direction (which follows camera facing)
      this.targetRotationY = Math.atan2(
        this.moveDirScratch.x,
        this.moveDirScratch.z
      );
      this.rotationY = lerpAngleY(
        this.rotationY,
        this.targetRotationY,
        dtSeconds * TURN_SMOOTH_SPEED
      );
    }
    // When stationary: do not follow camera when orbiting; preserve character orientation

    // Update animations via the weighted blend state machine
    this.visual.updateAnimation?.(dtSeconds, {
      isMoving: isMovingHorizontally,
      isStrafing: this.isRightClickHeld,
      moveDir: this.moveDirScratch,
      camForward: this.forwardScratch,
      camRight: this.rightScratch,
      camAlpha: alpha,
      rotationY: this.rotationY,
    });

    this.currentAnim = this.visual.getCurrentAnimation();

    const pos = this.body.translation();
    if (pos.y < -15) {
      this.setSpawnPosition(0, 3, 0, 0);
      return;
    }

    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.rotation.y = this.rotationY;
  }
}
