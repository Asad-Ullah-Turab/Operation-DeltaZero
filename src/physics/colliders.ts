/**
 * Factory functions for arena colliders and rigid bodies (ground, static obstacles, player cylinder).
 */

import RAPIER from '@dimforge/rapier3d-compat';
import {
  GROUND_WIDTH,
  GROUND_DEPTH,
  GROUND_THICKNESS,
  PLAYER_RADIUS,
  PLAYER_HALF_HEIGHT,
} from '../config/arena';
import type { ObstacleBoxSpec } from '../world/obstacles';

/**
 * Spawns a static ground cuboid collider centered so its top surface is at y = 0.
 */
export function createGroundCollider(world: RAPIER.World): RAPIER.Collider {
  const groundBodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
    0,
    -GROUND_THICKNESS / 2,
    0
  );
  const groundBody = world.createRigidBody(groundBodyDesc);

  const groundColliderDesc = RAPIER.ColliderDesc.cuboid(
    GROUND_WIDTH / 2,
    GROUND_THICKNESS / 2,
    GROUND_DEPTH / 2
  ).setFriction(0.0);

  return world.createCollider(groundColliderDesc, groundBody);
}

/**
 * Spawns a static obstacle box (fixed rigid body with mass 0 + cuboid collider).
 */
export function createStaticObstacleBox(
  world: RAPIER.World,
  spec: ObstacleBoxSpec
): RAPIER.RigidBody {
  const bodyDesc = RAPIER.RigidBodyDesc.fixed().setTranslation(
    spec.x,
    spec.y,
    spec.z
  );
  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(
    spec.width / 2,
    spec.height / 2,
    spec.depth / 2
  ).setFriction(0.0);

  world.createCollider(colliderDesc, body);
  return body;
}

/**
 * Spawns a dynamic cylinder rigid body for the local player with X and Z
 * angular rotations locked so the cylinder stays upright while moving.
 */
export function createPlayerCylinderBody(
  world: RAPIER.World,
  x = 0,
  y = 2.0,
  z = 0
): RAPIER.RigidBody {
  const bodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(x, y, z)
    .enabledRotations(false, true, false) // Lock X and Z rotation axes
    .setLinearDamping(0.0);

  const body = world.createRigidBody(bodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cylinder(
    PLAYER_HALF_HEIGHT,
    PLAYER_RADIUS
  )
    .setFriction(0.0)
    .setRestitution(0.0)
    .setMass(1.0);

  world.createCollider(colliderDesc, body);
  return body;
}

