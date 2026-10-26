/**
 * Babylon Engine, Scene lifecycle initialization, background clear color, and scene lighting.
 */

import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Inputs/scene.inputManager';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';

export interface SceneContext {
  engine: Engine;
  scene: Scene;
  light: HemisphericLight;
}

/**
 * Initializes the hardware-accelerated Babylon Engine, configured Scene, and hemispheric lighting.
 */
export function initScene(canvas: HTMLCanvasElement): SceneContext {
  // 1. Initialize Babylon Engine optimized for low-spec / integrated GPUs
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    powerPreference: 'high-performance',
    antialias: true,
  });

  // 2. Create Scene with low-overhead clearing & state management
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.07, 0.09, 0.15, 1.0);
  scene.skipPointerMovePicking = true;

  // 3. Lighting
  const light = new HemisphericLight(
    'hemiLight',
    new Vector3(0.3, 1, 0.2),
    scene
  );
  light.intensity = 1.05;
  light.groundColor = new Color3(0.22, 0.26, 0.34);

  return { engine, scene, light };
}
