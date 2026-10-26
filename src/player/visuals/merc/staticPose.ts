/**
 * Synthesizes a static single-frame hold pose animation group from a keyframe index.
 */

import { Scene } from '@babylonjs/core/scene';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Animation } from '@babylonjs/core/Animations/animation';

/**
 * Synthesizes a static looping AnimationGroup from a specific keyframe index
 * of a source AnimationGroup.
 */
export function createStaticPoseAnimationGroupAtFrame(
  groupName: string,
  sourceGroup: AnimationGroup,
  targetFrame: number,
  scene: Scene
): AnimationGroup {
  const staticGroup = new AnimationGroup(groupName, scene);

  for (const ta of sourceGroup.targetedAnimations) {
    const srcAnim = ta.animation;
    const keys = srcAnim.getKeys();
    if (!keys || keys.length === 0) continue;

    let bestKey = keys[keys.length - 1];
    let bestDist = Math.abs(bestKey.frame - targetFrame);
    for (const k of keys) {
      const d = Math.abs(k.frame - targetFrame);
      if (d < bestDist) {
        bestDist = d;
        bestKey = k;
      }
    }

    const rawValue = bestKey.value;
    const val0 =
      rawValue && typeof rawValue.clone === 'function'
        ? rawValue.clone()
        : rawValue;
    const val1 =
      rawValue && typeof rawValue.clone === 'function'
        ? rawValue.clone()
        : rawValue;

    const anim = new Animation(
      `${srcAnim.name}_${groupName}`,
      srcAnim.targetProperty,
      srcAnim.framePerSecond || 30,
      srcAnim.dataType,
      Animation.ANIMATIONLOOPMODE_CYCLE
    );
    anim.setKeys([
      { frame: 0, value: val0 },
      { frame: 30, value: val1 },
    ]);
    staticGroup.addTargetedAnimation(anim, ta.target);
  }

  return staticGroup;
}

