/**
 * Kinematic movement, gravity integration, scaling interpolation, and lifecycle management for particles.
 */

import type { ActiveParticle } from '../types';

/**
 * Updates all active particles in the pool and removes expired instances.
 */
export function updateParticles(
  particles: ActiveParticle[],
  dtSeconds: number
): void {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.age += dtSeconds;
    if (p.age >= p.lifetime) {
      p.mesh.dispose();
      particles.splice(i, 1);
      continue;
    }

    const t = p.age / p.lifetime;
    p.vel.y += p.gravity * dtSeconds;
    p.mesh.position.addInPlaceFromFloats(
      p.vel.x * dtSeconds,
      p.vel.y * dtSeconds,
      p.vel.z * dtSeconds
    );

    const scale = p.initialScale + (p.endScale - p.initialScale) * t;
    p.mesh.scaling.set(scale, scale, scale);
    p.mesh.visibility = p.initialAlpha * (1.0 - t);
  }
}

