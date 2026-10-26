/**
 * Deterministic obstacle layouts and seeded pseudo-random number generator for arena geometry.
 */

import { OBSTACLE_SEED, OBSTACLE_COUNT } from '../config/arena';

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
export function createSeededRandom(seed: number): () => number {
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
  const rand = createSeededRandom(OBSTACLE_SEED);
  const specs: ObstacleBoxSpec[] = [
    // Stepping-stone platforms near the center for jump testing
    { width: 3, height: 0.7, depth: 3, x: 5, y: 0.35, z: 0 },
    { width: 3, height: 1.5, depth: 3, x: 9.5, y: 0.75, z: 0 },
    { width: 3, height: 2.3, depth: 3, x: 14, y: 1.15, z: 0 },
    { width: 4, height: 3.1, depth: 4, x: 19, y: 1.55, z: 0 },
  ];

  for (let i = 0; i < OBSTACLE_COUNT; i++) {
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
