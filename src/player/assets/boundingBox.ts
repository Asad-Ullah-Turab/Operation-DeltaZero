/**
 * Bounding-box analysis for scaling and grounding custom 3D imported meshes.
 */

import type { AssetContainer } from '@babylonjs/core/assetContainer';

/**
 * Computes the raw bounding-box height and minimum base Y of a character asset container
 * to automatically scale and ground any custom imported character model.
 */
export function computeModelHeightAndBaseY(container: AssetContainer): {
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
