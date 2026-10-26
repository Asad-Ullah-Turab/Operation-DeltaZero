/**
 * Initializes and configures the Rapier3D WASM physics simulation world.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { GRAVITY_Y } from '../config/arena';

/**
 * Initializes the Rapier WASM physics runtime and creates a World with gravity.
 */
export async function initPhysicsWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  const gravity = new RAPIER.Vector3(0.0, GRAVITY_Y, 0.0);
  return new RAPIER.World(gravity);
}

