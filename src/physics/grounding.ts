/**
 * Downward raycast detection to determine whether a player rigid body is resting on a surface.
 */

import RAPIER from '@dimforge/rapier3d-compat';
import { PLAYER_HALF_HEIGHT } from '../config/arena';

/**
 * Performs a short downward raycast from the bottom of the player cylinder
 * to verify ground or box-top contact before allowing a jump.
 */
export function isPlayerGrounded(
  world: RAPIER.World,
  playerBody: RAPIER.RigidBody
): boolean {
  const pos = playerBody.translation();
  // Start slightly above the bottom of the cylinder and cast downward
  const rayOrigin = {
    x: pos.x,
    y: pos.y - PLAYER_HALF_HEIGHT + 0.05,
    z: pos.z,
  };
  const rayDir = { x: 0, y: -1, z: 0 };
  const ray = new RAPIER.Ray(rayOrigin, rayDir);
  const maxToi = 0.18;

  const hit = world.castRay(
    ray,
    maxToi,
    true,
    undefined,
    undefined,
    undefined,
    playerBody
  );

  return hit !== null;
}

