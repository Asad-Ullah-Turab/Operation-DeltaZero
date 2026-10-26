/**
 * Main game render loop: physics stepping, local player updates, combat effects, camera tracking, and network sync.
 */

import type { Engine } from '@babylonjs/core/Engines/engine';
import type { Scene } from '@babylonjs/core/scene';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { RAPIER } from '../physics';
import type { LocalPlayer } from '../player';
import type { CombatEffectsManager } from '../combat';
import type { NetworkManager } from '../network';
import { updateFpsCounter } from '../ui';

export interface GameLoopParams {
  engine: Engine;
  scene: Scene;
  world: RAPIER.World;
  localPlayer: LocalPlayer;
  combatEffects: CombatEffectsManager;
  network: NetworkManager;
  arcCamera: ArcRotateCamera | null;
}

/**
 * Starts the RAF render loop stepping physics, character simulation, combat VFX, and network interpolation.
 */
export function startGameLoop(params: GameLoopParams): void {
  const {
    engine,
    scene,
    world,
    localPlayer,
    combatEffects,
    network,
    arcCamera,
  } = params;

  let lastFpsUpdate = performance.now();

  engine.runRenderLoop(() => {
    const dtSeconds = Math.min(engine.getDeltaTime() / 1000, 0.1);

    // 1. Step Rapier3D physics world
    world.step();

    // 2. Update local player movement, firing, ADS, recoil & viewmodel motion
    localPlayer.update(arcCamera, dtSeconds);

    // 3. Step bullets, single-frame muzzle flashes, surface impacts & barrel smoke
    combatEffects.update(dtSeconds);

    // 4. Keep ArcRotateCamera orbit center synced when playing as Spie
    if (arcCamera) {
      arcCamera.target.copyFrom(localPlayer.mesh.position);
    }

    // 5. Sync local state/shots to Colyseus & interpolate remote players
    network.update(dtSeconds);

    // 6. Update FPS counter once every 500ms to prevent DOM layout thrashing
    const now = performance.now();
    if (now - lastFpsUpdate >= 500) {
      updateFpsCounter(engine.getFps());
      lastFpsUpdate = now;
    }

    scene.render();
  });

  window.addEventListener('resize', () => {
    engine.resize();
  });
}

