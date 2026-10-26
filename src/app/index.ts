/**
 * Barrel export for application bootstrap and lifecycle modules.
 */

export { bootstrap } from './bootstrap';
export { initScene, type SceneContext } from './scene';
export { createArcCamera, setActiveCameraForCharacter } from './cameras';
export { setupHitHandler } from './hitHandler';
export { setupRespawnFlow } from './respawnFlow';
export { startGameLoop, type GameLoopParams } from './gameLoop';

