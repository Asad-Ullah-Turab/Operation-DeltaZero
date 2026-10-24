import RAPIER from '@dimforge/rapier3d-compat';

export const GROUND_WIDTH = 100;
export const GROUND_DEPTH = 100;
export const GROUND_THICKNESS = 1.0;

export const PLAYER_RADIUS = 0.55;
export const PLAYER_HALF_HEIGHT = 0.85;
export const PLAYER_HEIGHT = PLAYER_HALF_HEIGHT * 2;

export interface ObstacleBoxSpec {
  width: number;
  height: number;
  depth: number;
  x: number;
  y: number;
  z: number;
}

/**
 * Deterministic PRNG (Mulberry32) so all clients generate the exact same
 * static obstacle coordinates without extra network overhead.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generates deterministic static box specifications for the map.
 */
export function generateObstacleSpecs(): ObstacleBoxSpec[] {
  const rand = createSeededRandom(2026);
  const specs: ObstacleBoxSpec[] = [
    // Stepping-stone platforms near the center for jump testing
    { width: 3, height: 0.7, depth: 3, x: 5, y: 0.35, z: 0 },
    { width: 3, height: 1.5, depth: 3, x: 9.5, y: 0.75, z: 0 },
    { width: 3, height: 2.3, depth: 3, x: 14, y: 1.15, z: 0 },
    { width: 4, height: 3.1, depth: 4, x: 19, y: 1.55, z: 0 },
  ];

  const count = 28;
  for (let i = 0; i < count; i++) {
    const width = 1.5 + rand() * 3.0;
    const height = 0.7 + rand() * 2.5;
    const depth = 1.5 + rand() * 3.0;

    let x = (rand() - 0.5) * 70;
    let z = (rand() - 0.5) * 70;
    // Keep central spawn zone clear
    if (Math.abs(x) < 6 && Math.abs(z) < 6) {
      x += x >= 0 ? 7 : -7;
      z += z >= 0 ? 7 : -7;
    }

    specs.push({
      width,
      height,
      depth,
      x,
      y: height / 2,
      z,
    });
  }

  return specs;
}

/**
 * Initializes the Rapier WASM physics runtime and creates a World with
 * standard Earth gravity (0, -9.81, 0).
 */
export async function initPhysicsWorld(): Promise<RAPIER.World> {
  await RAPIER.init();
  const gravity = new RAPIER.Vector3(0.0, -19.81, 0.0);
  return new RAPIER.World(gravity);
}

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

export { RAPIER };
