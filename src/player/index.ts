/**
 * Barrel export for player entity, visual factories, asset loaders, and animation types.
 */

export { LocalPlayer } from './LocalPlayer';

export type {
  CharacterAssets,
  NetworkShotEvent,
  SpieAnimContext,
  CharacterVisual,
  SpieAnimationName,
  SpieTrack,
} from './types';
export { SPIE_TRACK_CONFIGS } from './types';

export {
  loadCharacterAssets,
} from './assets';

export { createSpieVisual } from './visuals/spie';
export { createMercVisual, createMercWorldVisual } from './visuals/merc';
export * from './systems';
