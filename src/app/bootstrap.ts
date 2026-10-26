/**
 * Startup orchestrator coordinating scene creation, asset loading, arena construction, and game launch.
 */

import { initPhysicsWorld } from '../physics';
import { buildArena } from '../world';
import { LocalPlayer, loadCharacterAssets } from '../player';
import { CombatEffectsManager } from '../combat';
import { NetworkManager } from '../network';
import { waitForCharacterSelection, setCrosshairVisible } from '../ui';
import { initScene } from './scene';
import { createArcCamera, setActiveCameraForCharacter } from './cameras';
import { setupHitHandler } from './hitHandler';
import { setupRespawnFlow } from './respawnFlow';
import { startGameLoop } from './gameLoop';

/**
 * Boots the multiplayer cylinder application.
 */
export async function bootstrap(): Promise<void> {
  const canvas = document.getElementById(
    'renderCanvas'
  ) as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #renderCanvas element');
  }

  // 1. Initialize Babylon Engine, Scene, and Lighting
  const { engine, scene } = initScene(canvas);

  // 2. Parallel initialization: Rapier3D physics + GLB assets while player views menu
  const selectionPromise = waitForCharacterSelection();
  const [world, characterAssets] = await Promise.all([
    initPhysicsWorld(),
    loadCharacterAssets(scene),
  ]);

  // 3. Build Ground & Obstacle Colliders and Visual Meshes
  buildArena(scene, world);

  // 4. Await character selection choice ('Spie' or 'Merc')
  const selectedCharacterType = await selectionPromise;
  setCrosshairVisible(selectedCharacterType === 'Merc');

  canvas.focus();
  void canvas.requestPointerLock?.();

  // 5. Initialize Combat Projectiles & VFX Manager and Spawn Local Player
  const combatEffects = new CombatEffectsManager(scene, world);
  const localPlayer = new LocalPlayer(
    scene,
    world,
    characterAssets,
    selectedCharacterType,
    combatEffects
  );

  canvas.addEventListener('click', () => {
    if (!localPlayer.isDead && document.pointerLockElement !== canvas) {
      void canvas.requestPointerLock?.();
    }
  });

  // 6. Camera Setup & Character Mode Switching
  const arcCamera = createArcCamera(scene, canvas);
  setActiveCameraForCharacter(
    scene,
    selectedCharacterType,
    arcCamera,
    localPlayer.fpCamera
  );

  // Mouse look tracking under pointer lock
  window.addEventListener('pointermove', (e: PointerEvent) => {
    if (document.pointerLockElement === canvas && !localPlayer.isDead) {
      localPlayer.handleMouseMove(e.movementX, e.movementY, arcCamera);
    }
  });

  // 7. Colyseus Server Connection
  const network = new NetworkManager(
    scene,
    localPlayer,
    characterAssets,
    combatEffects,
    world
  );
  void network.connect();

  // 8. Wire Hit Detection & Death/Respawn Flow
  setupHitHandler(combatEffects, network);
  setupRespawnFlow(localPlayer, network, arcCamera, canvas);

  // 9. Start Main Render & Simulation Loop
  startGameLoop({
    engine,
    scene,
    world,
    localPlayer,
    combatEffects,
    network,
    arcCamera,
  });
}
