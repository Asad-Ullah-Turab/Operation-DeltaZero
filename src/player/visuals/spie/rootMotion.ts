/**
 * Strips or neutralizes root-motion hip translation tracks in Spy animation groups.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';

/**
 * Strips or neutralizes root-motion translation displacement where appropriate:
 * - Neutralizes in-place tracks (180 turn, start/stop, jump) to lock to collider center
 * - Interpolates horizontal drift in stand-to-crouch and crouch-to-stand for seamless transitions
 * - Smoothly blends hang-to-crouch hip position towards crouch-idle
 */
export function stripSpieRootMotion(
  animationGroups: AnimationGroup[],
  scale: number
): void {
  for (const ag of animationGroups) {
    if (
      ag.name.includes('walking-turn-180') ||
      ag.name.includes('start-walking') ||
      ag.name.includes('stop-walking') ||
      ag.name.includes('jump')
    ) {
      for (const ta of ag.targetedAnimations) {
        if (
          ta.target &&
          typeof ta.target.name === 'string' &&
          ta.target.name.toLowerCase().includes('hips') &&
          ta.animation.targetProperty === 'position'
        ) {
          const keys = ta.animation.getKeys();
          const firstVal = keys[0]?.value;
          if (firstVal instanceof Vector3) {
            for (const k of keys) {
              if (k.value instanceof Vector3) {
                k.value.copyFrom(firstVal);
              }
            }
          }
        }
      }
    } else if (ag.name.includes('stand-to-crouch')) {
      for (const ta of ag.targetedAnimations) {
        if (
          ta.target &&
          typeof ta.target.name === 'string' &&
          ta.target.name.toLowerCase().includes('hips') &&
          ta.animation.targetProperty === 'position'
        ) {
          const keys = ta.animation.getKeys();
          const n = keys.length;
          if (n > 1) {
            const startX = keys[0].value.x;
            const startY = keys[0].value.y;
            const targetX = 17.41;
            const targetY = -4.47;
            for (let i = 0; i < n; i++) {
              const alpha = i / (n - 1);
              keys[i].value.x = startX + (targetX - startX) * alpha;
              keys[i].value.y = startY + (targetY - startY) * alpha;
            }
          }
        }
      }
    } else if (ag.name.includes('crouch-to-stand')) {
      for (const ta of ag.targetedAnimations) {
        if (
          ta.target &&
          typeof ta.target.name === 'string' &&
          ta.target.name.toLowerCase().includes('hips') &&
          ta.animation.targetProperty === 'position'
        ) {
          const keys = ta.animation.getKeys();
          const n = keys.length;
          if (n > 1) {
            const startX = 17.41;
            const startY = -4.47;
            const targetX = 5.1;
            const targetY = -1.5;
            for (let i = 0; i < n; i++) {
              const alpha = i / (n - 1);
              keys[i].value.x = startX + (targetX - startX) * alpha;
              keys[i].value.y = startY + (targetY - startY) * alpha;
            }
          }
        }
      }
    } else if (ag.name.includes('hang-to-crouch')) {
      for (const ta of ag.targetedAnimations) {
        if (
          ta.target &&
          typeof ta.target.name === 'string' &&
          ta.target.name.toLowerCase().includes('hips') &&
          ta.animation.targetProperty === 'position'
        ) {
          const keys = ta.animation.getKeys();
          const n = keys.length;
          const boneFactor = scale * 0.01;
          const palmDeltas = [
            0, 0, -0.0004, 0.0042, 0.0132, 0.0254, 0.0393, 0.0531, 0.0654, 0.0748,
            0.0841, 0.095, 0.1057, 0.1135, 0.1168, 0.1142, 0.1001, 0.0834, 0.0701, 0.0642,
            0.0634, 0.0681, 0.074, 0.0808, 0.0888, 0.1022, 0.1193, 0.1392, 0.1592, 0.1781,
            0.1882, 0.1834, 0.1802, 0.1751, 0.1707, 0.1691
          ];

          // 1. Cancel palm rise during pull-up (frames 0 to 35) so hands stay 100% glued to ledge
          for (let i = 0; i < Math.min(n, palmDeltas.length); i++) {
            keys[i].value.z += palmDeltas[i] / boneFactor;
          }

          // 2. From frame 35 to end, smoothly interpolate hips to crouch-idle pose
          const keyAt35 = keys[Math.min(35, n - 1)].value.clone();
          const targetCrouchIdleHips = new Vector3(17.41, -4.47, -71.06);
          for (let i = 36; i < n; i++) {
            const t = (i - 35) / (n - 1 - 35);
            const smoothT = t * t * (3 - 2 * t);
            keys[i].value = Vector3.Lerp(keyAt35, targetCrouchIdleHips, smoothT);
          }
        }
      }
    }
  }
}

