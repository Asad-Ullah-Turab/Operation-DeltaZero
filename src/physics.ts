import * as CANNON from 'cannon-es';
import * as THREE from 'three';

export interface PhysicsContext {
  world: CANNON.World;
  playerMaterial: CANNON.Material;
  worldMaterial: CANNON.Material;
}

/**
 * Deterministic pseudo-random generator (Mulberry32) so all LAN clients
 * generate identical static obstacle positions and sizes.
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
 * Initializes the Cannon-es physics world, materials, ground plane,
 * and static box obstacles synced with the Three.js scene.
 */
export function initPhysics(scene: THREE.Scene): PhysicsContext {
  const world = new CANNON.World({
    gravity: new CANNON.Vec3(0, -22, 0), // Snappy gravity for responsive jumping
  });

  // Broadphase & solver tuning
  world.broadphase = new CANNON.SAPBroadphase(world);
  world.allowSleep = false;

  // Zero-friction contact between player cylinder and world prevents sticking to box walls
  const worldMaterial = new CANNON.Material('worldMaterial');
  const playerMaterial = new CANNON.Material('playerMaterial');

  const playerWorldContact = new CANNON.ContactMaterial(
    playerMaterial,
    worldMaterial,
    {
      friction: 0.0,
      restitution: 0.0,
    }
  );
  world.addContactMaterial(playerWorldContact);

  // --- 1. Static Ground Plane ---
  const groundBody = new CANNON.Body({
    mass: 0, // mass = 0 makes the body static
    shape: new CANNON.Plane(),
    material: worldMaterial,
  });
  // Rotate Cannon plane so its normal points up along +Y
  groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  world.addBody(groundBody);

  // Visual Ground Mesh
  const groundGeo = new THREE.PlaneGeometry(120, 120);
  const groundMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.85,
    metalness: 0.1,
  });
  const groundMesh = new THREE.Mesh(groundGeo, groundMat);
  groundMesh.rotation.x = -Math.PI / 2;
  groundMesh.receiveShadow = true;
  scene.add(groundMesh);

  // Subtle grid helper for depth and speed perception
  const grid = new THREE.GridHelper(120, 60, 0x475569, 0x334155);
  grid.position.y = 0.01;
  scene.add(grid);

  // --- 2. Static Box Obstacles ---
  createStaticBoxes(world, scene, worldMaterial);

  return {
    world,
    playerMaterial,
    worldMaterial,
  };
}

/**
 * Helper to spawn a single static box in both Three.js and Cannon-es.
 */
function addStaticBox(
  world: CANNON.World,
  scene: THREE.Scene,
  material: CANNON.Material,
  width: number,
  height: number,
  depth: number,
  x: number,
  y: number,
  z: number,
  color: number
): void {
  // Cannon-es Box takes half-extents (width/2, height/2, depth/2)
  const halfExtents = new CANNON.Vec3(width / 2, height / 2, depth / 2);
  const body = new CANNON.Body({
    mass: 0, // Static obstacle
    shape: new CANNON.Box(halfExtents),
    position: new CANNON.Vec3(x, y, z),
    material,
  });
  world.addBody(body);

  // Corresponding Three.js visual mesh
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const meshMaterial = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.6,
    metalness: 0.15,
  });
  const mesh = new THREE.Mesh(geometry, meshMaterial);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

/**
 * Generates a deterministic set of static 3D boxes across the arena
 * for jumping and collision testing.
 */
function createStaticBoxes(
  world: CANNON.World,
  scene: THREE.Scene,
  worldMaterial: CANNON.Material
): void {
  const rand = createSeededRandom(1337);
  const boxColors = [0x64748b, 0x475569, 0x0284c7, 0x0d9488, 0x6366f1];

  // A structured stepping-stone staircase near the center to test platforming
  const steps = [
    { w: 3, h: 0.8, d: 3, x: 6, z: 0 },
    { w: 3, h: 1.8, d: 3, x: 10, z: 0 },
    { w: 3, h: 2.8, d: 3, x: 14, z: 0 },
    { w: 4, h: 3.8, d: 4, x: 18.5, z: 0 },
  ];

  for (const step of steps) {
    addStaticBox(
      world,
      scene,
      worldMaterial,
      step.w,
      step.h,
      step.d,
      step.x,
      step.h / 2,
      step.z,
      0x38bdf8
    );
  }

  // Scatter 35 random static boxes around the map
  const boxCount = 35;
  for (let i = 0; i < boxCount; i++) {
    const width = 1.5 + rand() * 3.5;
    const height = 0.8 + rand() * 3.2;
    const depth = 1.5 + rand() * 3.5;

    // Pick a random position outside the central spawn zone
    let x = (rand() - 0.5) * 80;
    let z = (rand() - 0.5) * 80;
    if (Math.abs(x) < 6 && Math.abs(z) < 6) {
      x += x >= 0 ? 8 : -8;
      z += z >= 0 ? 8 : -8;
    }

    const color = boxColors[Math.floor(rand() * boxColors.length)] ?? 0x64748b;

    addStaticBox(
      world,
      scene,
      worldMaterial,
      width,
      height,
      depth,
      x,
      height / 2, // Rest flush on the ground plane (y = 0)
      z,
      color
    );
  }
}

