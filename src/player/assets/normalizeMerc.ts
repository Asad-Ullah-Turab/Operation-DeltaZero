/**
 * Fixes bind-pose vertex scale, flipped normals, and winding on Merc viewmodel arms.
 */

import type { AssetContainer } from '@babylonjs/core/assetContainer';
import { VertexBuffer } from '@babylonjs/core/Buffers/buffer';
import { ARM_VERTEX_CORRECTION_SCALE } from '../../config/weapons';

/**
 * Fixes the bind-pose vertex scale and winding on the arm/hand/shirt meshes
 * (`Object_91`, `Object_92`, `Object_93`) inside `fps_merc_m4a1.glb` so they
 * attach properly to the M4A1 instead of appearing gigantic in the sky.
 */
export function normalizeMercContainerGeometry(container: AssetContainer): void {
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
