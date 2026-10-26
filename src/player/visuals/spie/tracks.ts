/**
 * Animation track allocation, weight blending, and normalization for Spy operative skeletal animations.
 */

import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import {
  SPIE_TRACK_CONFIGS,
  type SpieAnimationName,
  type SpieTrack,
} from '../../types';

export const CROSSFADE_RATE = 14.0; // Linear transition rate: full 0 -> 1 in ~70ms (4-5 frames)

/**
 * Maps instantiated animation groups to typed SpieTrack records based on configurations.
 */
export function buildSpieTracks(
  animationGroups: AnimationGroup[]
): Map<SpieAnimationName, SpieTrack> {
  const findGroup = (target: string): AnimationGroup | undefined => {
    return animationGroups.find(
      (ag) => ag.name === target || ag.name.endsWith('|' + target)
    );
  };

  const tracks = new Map<SpieAnimationName, SpieTrack>();
  for (const cfg of SPIE_TRACK_CONFIGS) {
    const ag = findGroup(cfg.name);
    if (ag) {
      const durationSec = (ag.to - ag.from) / (60.0 * cfg.speedRatio);
      tracks.set(cfg.name, {
        ...cfg,
        group: ag,
        currentWeight: cfg.name === 'idle' ? 1.0 : 0.0,
        targetWeight: cfg.name === 'idle' ? 1.0 : 0.0,
        durationSec,
      });
    }
  }

  const idleTrack = tracks.get('idle');
  if (idleTrack) {
    idleTrack.group.start(true, idleTrack.speedRatio);
    idleTrack.group.setWeightForAllAnimatables(1.0);
  }

  return tracks;
}

/**
 * Updates crossfade weights towards target weights and normalizes animatable weights.
 */
export function updateSpieCrossfade(
  tracks: Map<SpieAnimationName, SpieTrack>,
  dtSeconds: number,
  rate = CROSSFADE_RATE
): void {
  const step = dtSeconds * rate;
  let totalWeight = 0;

  for (const track of tracks.values()) {
    if (track.currentWeight < track.targetWeight) {
      track.currentWeight = Math.min(
        track.targetWeight,
        track.currentWeight + step
      );
    } else if (track.currentWeight > track.targetWeight) {
      track.currentWeight = Math.max(
        track.targetWeight,
        track.currentWeight - step
      );
    }
    totalWeight += track.currentWeight;
  }

  if (totalWeight > 0.0001) {
    for (const track of tracks.values()) {
      const norm = track.currentWeight / totalWeight;
      if (norm > 0.001) {
        if (track.isLooping && !track.group.isPlaying) {
          track.group.start(true, track.speedRatio);
        }
        track.group.setWeightForAllAnimatables(norm);
      } else {
        track.group.setWeightForAllAnimatables(0);
        if (
          track.targetWeight === 0 &&
          track.isLooping &&
          track.group.isPlaying
        ) {
          track.group.stop();
        }
      }
    }
  }
}
