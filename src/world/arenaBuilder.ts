/**
 * Constructs physics colliders and visual Babylon meshes for the arena ground and static obstacles.
 */

import { Scene } from '@babylonjs/core/scene';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import {
  RAPIER,
  createGroundCollider,
  createStaticObstacleBox,
} from '../physics';
import { GROUND_WIDTH, GROUND_DEPTH } from '../config/arena';
import { generateObstacleSpecs } from './obstacles';

/**
 * Builds ground and obstacle colliders in the Rapier world and creates frozen Babylon visual meshes.
 */
export function buildArena(scene: Scene, world: RAPIER.World): void {
  // 1. Build Ground Collider & Visual Plane
  createGroundCollider(world);

  const groundMesh = MeshBuilder.CreateGround(
    'ground',
    { width: GROUND_WIDTH, height: GROUND_DEPTH, subdivisions: 2 },
    scene
  );
  const groundMat = new StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = new Color3(0.14, 0.19, 0.26);
  groundMat.specularColor = Color3.Black();
  groundMat.freeze();
  groundMesh.material = groundMat;
  groundMesh.freezeWorldMatrix();

  // 2. Build Static Obstacle Colliders & Visual Boxes (shared material for draw-call batching)
  const boxMat = new StandardMaterial('obstacleBoxMat', scene);
  boxMat.diffuseColor = new Color3(0.38, 0.48, 0.58);
  boxMat.specularColor = Color3.Black();
  boxMat.freeze();

  const obstacleSpecs = generateObstacleSpecs();
  obstacleSpecs.forEach((spec, index) => {
    createStaticObstacleBox(world, spec);

    const boxMesh = MeshBuilder.CreateBox(
      `obstacle_${index}`,
      {
        width: spec.width,
        height: spec.height,
        depth: spec.depth,
      },
      scene
    );
    boxMesh.position.set(spec.x, spec.y, spec.z);
    boxMesh.material = boxMat;
    boxMesh.freezeWorldMatrix();
  });
}
