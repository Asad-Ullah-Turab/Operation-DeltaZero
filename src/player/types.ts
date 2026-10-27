/**
 * Data structures, visual interfaces, animation tracks, and asset contracts for operatives.
 */

import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { CharacterType } from '../../shared';

export type { CharacterType };

export interface CharacterAssets {
  spyContainer: AssetContainer;
  mercContainer: AssetContainer;
  mercenaryContainer: AssetContainer;
  weaponM4A1Container: AssetContainer;
}

export type MercAnimationName = 'idle-aiming' | 'walking' | 'shooting';


export interface NetworkShotEvent {
  originX: number;
  originY: number;
  originZ: number;
  dirX: number;
  dirY: number;
  dirZ: number;
}

export interface SpyAnimContext {
  isMoving: boolean;
  isStrafing: boolean; // right click held
  moveDir: Vector3;
  camForward: Vector3;
  camRight: Vector3;
  camAlpha: number;
  rotationY: number;
  isCrouched?: boolean;
  isClimbing?: boolean;
  isGrounded?: boolean;
}

export interface CharacterVisual {
  root: Mesh;
  characterType: CharacterType;
  muzzleNode: TransformNode | null;
  muzzleFlashMesh: Mesh | null;
  playAnimation: (animName: string) => void;
  updateAnimation?: (dtSeconds: number, context: SpyAnimContext) => void;
  triggerReload?: () => boolean;
  triggerHide?: () => void;
  getCurrentAnimation: () => string;
  getHitZone?: (hitPoint: Vector3) => 'head' | 'torso' | 'limbs';
  dispose: () => void;
}

export type SpyAnimationName =
  | 'idle'
  | 'walking'
  | 'start-walking'
  | 'stop-walking'
  | 'walking-turn-180'
  | 'left-turn'
  | 'right-turn'
  | 'left-strafe-walking'
  | 'right-strafe-walking'
  | 'crouch-idle'
  | 'crouched-walking'
  | 'stand-to-crouch'
  | 'crouch-to-stand'
  | 'jump'
  | 'hang-to-crouch';

export interface SpyTrack {
  name: SpyAnimationName;
  group: AnimationGroup;
  currentWeight: number;
  targetWeight: number;
  isLooping: boolean;
  speedRatio: number;
  durationSec: number;
}

export const SPY_TRACK_CONFIGS: Array<{
  name: SpyAnimationName;
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
  { name: 'crouch-idle', isLooping: true, speedRatio: 1.0 },
  { name: 'crouched-walking', isLooping: true, speedRatio: 1.25 },
  { name: 'stand-to-crouch', isLooping: false, speedRatio: 1.2 },
  { name: 'crouch-to-stand', isLooping: false, speedRatio: 1.2 },
  { name: 'jump', isLooping: false, speedRatio: 1.15 },
  { name: 'hang-to-crouch', isLooping: false, speedRatio: 1.0 },
];

