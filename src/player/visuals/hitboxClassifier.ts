/**
 * Shared skeletal node hierarchy partitioning and hit zone classification for operative avatars.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { PLAYER_HALF_HEIGHT } from '../../config/arena';

/**
 * Builds a hit zone classifier using skeletal node distance checks with a geometric fallback.
 */
export function createHitboxClassifier(
  rootNodes: TransformNode[],
  root: Mesh
): (hitPoint: Vector3) => 'head' | 'torso' | 'limbs' {
  const allChildNodes: TransformNode[] = [];
  for (const rn of rootNodes) {
    if (rn instanceof TransformNode) {
      allChildNodes.push(rn);
      allChildNodes.push(...rn.getChildTransformNodes());
    }
  }

  const headNodes = allChildNodes.filter((n) => {
    const l = n.name.toLowerCase();
    return l.includes('head') || l.includes('neck');
  });

  const torsoNodes = allChildNodes.filter((n) => {
    const l = n.name.toLowerCase();
    return (
      l.includes('spine') ||
      l.includes('hips') ||
      l.includes('vest') ||
      l.includes('chest')
    );
  });

  const limbNodes = allChildNodes.filter((n) => {
    const l = n.name.toLowerCase();
    return (
      l.includes('arm') ||
      l.includes('forearm') ||
      l.includes('hand') ||
      l.includes('shoulder') ||
      l.includes('leg') ||
      l.includes('upleg') ||
      l.includes('foot') ||
      l.includes('toe')
    );
  });

  const distToNodes = (nodes: TransformNode[], hitPoint: Vector3): number => {
    let minD = Infinity;
    for (const n of nodes) {
      n.computeWorldMatrix(true);
      const d = Vector3.Distance(hitPoint, n.getAbsolutePosition());
      if (d < minD) minD = d;
    }
    return minD;
  };

  return (hitPoint: Vector3): 'head' | 'torso' | 'limbs' => {
    const dh = distToNodes(headNodes, hitPoint);
    const dt = distToNodes(torsoNodes, hitPoint);
    const dl = distToNodes(limbNodes, hitPoint);

    if (dh < dt && dh < dl && dh < 0.55) return 'head';
    if (dt <= dl && dt < 0.65) return 'torso';
    if (dl < Infinity) return 'limbs';

    // Geometric fallback based on local character vertical and lateral profile
    const feetY = root.position.y - PLAYER_HALF_HEIGHT;
    const relY = hitPoint.y - feetY;
    if (relY >= 1.42) return 'head';
    if (relY >= 0.82) {
      const dx = hitPoint.x - root.position.x;
      const dz = hitPoint.z - root.position.z;
      if (Math.hypot(dx, dz) <= 0.22) return 'torso';
    }
    return 'limbs';
  };
}

