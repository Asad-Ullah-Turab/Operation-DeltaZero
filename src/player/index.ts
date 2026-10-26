/**
 * Barrel export for player entity, visual factories, asset loaders, and animation types.
 */

export { LocalPlayer } from './LocalPlayer';

export type {
  CharacterAssets,
  NetworkShotEvent,
  SpyAnimContext,
  CharacterVisual,
  SpyAnimationName,
  SpyTrack,
} from './types';
export { SPY_TRACK_CONFIGS } from './types';

export {
  loadCharacterAssets,
} from './assets';

export { createSpyVisual } from './visuals/spy';
export { createMercVisual, createMercWorldVisual } from './visuals/merc';
export * from './systems';
