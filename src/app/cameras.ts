/**
 * Camera instantiation, orbital limits, control binding, and active camera switching.
 */

import { Scene } from '@babylonjs/core/scene';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { CharacterType } from '../../shared';

/**
 * Creates and configures the third-person ArcRotateCamera with strict orbital constraints.
 */
export function createArcCamera(
  scene: Scene,
  canvas: HTMLCanvasElement
): ArcRotateCamera {
  const arcCamera = new ArcRotateCamera(
    'playerCamera',
    -Math.PI / 2,
    Math.PI / 3.2,
    13,
    new Vector3(0, 2, 0),
    scene
  );
  arcCamera.lowerBetaLimit = 0.25;
  arcCamera.upperBetaLimit = Math.PI / 2 - 0.08;
  arcCamera.lowerRadiusLimit = 5;
  arcCamera.upperRadiusLimit = 28;
  arcCamera.panningSensibility = 0;
  arcCamera.keysUp = [];
  arcCamera.keysDown = [];
  arcCamera.keysLeft = [];
  arcCamera.keysRight = [];
  arcCamera.attachControl(canvas, true);
  arcCamera.inputs.removeByType('ArcRotateCameraPointersInput');

  return arcCamera;
}

/**
 * Activates either the Mercenary first-person camera or the Spy orbital camera.
 */
export function setActiveCameraForCharacter(
  scene: Scene,
  characterType: CharacterType,
  arcCamera: ArcRotateCamera,
  fpCamera: FreeCamera | null
): void {
  if (characterType === 'Merc' && fpCamera) {
    scene.activeCamera = fpCamera;
  } else {
    scene.activeCamera = arcCamera;
  }
}

