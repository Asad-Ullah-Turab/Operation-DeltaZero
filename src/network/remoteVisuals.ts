/**
 * Factory for creating visual avatar representations for remote players in the scene.
 */

import type { Scene } from '@babylonjs/core/scene';
import type { CharacterType } from '../../shared';
import {
  createSpyVisual,
  createMercWorldVisual,
  type CharacterAssets,
  type CharacterVisual,
} from '../player';

/**
 * Instantiates the appropriate 3D visual avatar for a remote player.
 */
export function createRemoteVisual(
  sessionId: string,
  characterType: CharacterType,
  scene: Scene,
  assets: CharacterAssets
): CharacterVisual {
  if (characterType === 'Merc') {
    return createMercWorldVisual(
      `remote_merc_${sessionId}`,
      scene,
      assets.mercenaryContainer,
      assets.weaponM4A1Container
    );
  }
  return createSpyVisual(
    `remote_spy_${sessionId}`,
    scene,
    assets.spyContainer
  );
}

