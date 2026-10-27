/**
 * Procedural upper-body pose adjustment and two-handed weapon alignment
 * across mercenary locomotion and combat animations.
 */

import { Vector3, Quaternion } from '@babylonjs/core/Maths/math.vector';
import type { Node } from '@babylonjs/core/node';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';

export interface MercRigNodes {
  weaponMount: TransformNode;
  leftArmNode: TransformNode | null;
  leftForeArmNode: TransformNode | null;
  leftHandNode: TransformNode | null;
  rightHandNode: TransformNode | null;
}

export interface MercTrackWeights {
  idle: number;
  walk: number;
  shoot: number;
}

// Weapon mount rotation presets tuned to keep barrel level and forward-facing
const MOUNT_ROT_IDLE = new Vector3(1.3, 1.2, -0.2);
const MOUNT_ROT_WALK = new Vector3(1.42, 1.3, -0.22);
const MOUNT_ROT_SHOOT = new Vector3(1.56, 1.05, 0.05);

// Additive arm posture adjustments to lower left hand from chin down to handguard level
const LEFT_ARM_OFFSET_WALK = new Vector3(0.18, 0.0, -0.05);
const LEFT_ARM_OFFSET_SHOOT = new Vector3(0.12, 0.0, 0.0);

const LEFT_FOREARM_OFFSET_WALK = new Vector3(0.12, 0.0, 0.0);
const LEFT_FOREARM_OFFSET_SHOOT = new Vector3(0.1, 0.0, 0.0);

function findNode(root: Node, target: string): Node | null {
  if (root.name === target || root.name.endsWith('|' + target)) return root;
  for (const child of root.getChildren()) {
    const found = findNode(child, target);
    if (found) return found;
  }
  return null;
}

/**
 * Discovers and caches relevant upper-body joints for two-handed pose correction.
 */
export function setupMercRigNodes(
  root: Node,
  weaponMount: TransformNode
): MercRigNodes {
  return {
    weaponMount,
    leftArmNode: findNode(root, 'mixamorig:LeftArm') as TransformNode | null,
    leftForeArmNode: findNode(
      root,
      'mixamorig:LeftForeArm'
    ) as TransformNode | null,
    leftHandNode: findNode(root, 'mixamorig:LeftHand') as TransformNode | null,
    rightHandNode: findNode(
      root,
      'mixamorig:RightHand'
    ) as TransformNode | null,
  };
}

/**
 * Dynamically adjusts weapon mount orientation and left arm elevation per-frame
 * to maintain level gun aiming and stable two-handed handguard grip across states.
 */
export function updateMercUpperBodyPose(
  nodes: MercRigNodes,
  weights: MercTrackWeights
): void {
  const tot = weights.idle + weights.walk + weights.shoot;
  if (tot <= 0.0001) return;

  const nIdle = weights.idle / tot;
  const nWalk = weights.walk / tot;
  const nShoot = weights.shoot / tot;

  // 1. Dynamic weapon mount rotation compensation
  nodes.weaponMount.rotation.set(
    MOUNT_ROT_IDLE.x * nIdle +
      MOUNT_ROT_WALK.x * nWalk +
      MOUNT_ROT_SHOOT.x * nShoot,
    MOUNT_ROT_IDLE.y * nIdle +
      MOUNT_ROT_WALK.y * nWalk +
      MOUNT_ROT_SHOOT.y * nShoot,
    MOUNT_ROT_IDLE.z * nIdle +
      MOUNT_ROT_WALK.z * nWalk +
      MOUNT_ROT_SHOOT.z * nShoot
  );

  // 2. Additive left arm lowering & inward alignment
  const armRotX =
    LEFT_ARM_OFFSET_WALK.x * nWalk + LEFT_ARM_OFFSET_SHOOT.x * nShoot;
  const armRotZ =
    LEFT_ARM_OFFSET_WALK.z * nWalk + LEFT_ARM_OFFSET_SHOOT.z * nShoot;

  if (
    nodes.leftArmNode &&
    nodes.leftArmNode.rotationQuaternion &&
    (Math.abs(armRotX) > 0.001 || Math.abs(armRotZ) > 0.001)
  ) {
    const armAdditive = Quaternion.FromEulerAngles(armRotX, 0, armRotZ);
    nodes.leftArmNode.rotationQuaternion.multiplyToRef(
      armAdditive,
      nodes.leftArmNode.rotationQuaternion
    );
  }

  // 3. Additive left forearm lowering & cupping
  const foreRotX =
    LEFT_FOREARM_OFFSET_WALK.x * nWalk + LEFT_FOREARM_OFFSET_SHOOT.x * nShoot;
  if (
    nodes.leftForeArmNode &&
    nodes.leftForeArmNode.rotationQuaternion &&
    Math.abs(foreRotX) > 0.001
  ) {
    const foreAdditive = Quaternion.FromEulerAngles(foreRotX, 0, 0);
    nodes.leftForeArmNode.rotationQuaternion.multiplyToRef(
      foreAdditive,
      nodes.leftForeArmNode.rotationQuaternion
    );
  }
}

