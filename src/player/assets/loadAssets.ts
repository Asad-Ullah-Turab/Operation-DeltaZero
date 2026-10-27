/**
 * Asynchronous GLB asset container loader for operative 3D avatars and viewmodels.
 */

import { Scene } from '@babylonjs/core/scene';
import { SceneLoader } from '@babylonjs/core/Loading/sceneLoader';
import {
  ASSET_BASE_PATH,
  CHARACTER_ASSET_FILES,
  WEAPON_ASSET_BASE_PATH,
  WEAPON_ASSET_FILES,
} from '../../config/assets';
import type { CharacterAssets } from '../types';
import { normalizeMercContainerGeometry } from './normalizeMerc';

/**
 * Preloads `spy.glb` (Spy), `fps_merc_m4a1.glb` (FPS Merc viewmodel),
 * `mercenary.glb` (third-person Merc world model), and `m4a1.glb` (weapon model)
 * into reusable Babylon AssetContainers.
 */
export async function loadCharacterAssets(
  scene: Scene
): Promise<CharacterAssets> {
  const [
    spyContainer,
    mercContainer,
    mercenaryContainer,
    weaponM4A1Container,
  ] = await Promise.all([
    SceneLoader.LoadAssetContainerAsync(
      ASSET_BASE_PATH,
      CHARACTER_ASSET_FILES.SPY,
      scene
    ),
    SceneLoader.LoadAssetContainerAsync(
      ASSET_BASE_PATH,
      CHARACTER_ASSET_FILES.FPS_MERC,
      scene
    ),
    SceneLoader.LoadAssetContainerAsync(
      ASSET_BASE_PATH,
      CHARACTER_ASSET_FILES.MERCENARY,
      scene
    ),
    SceneLoader.LoadAssetContainerAsync(
      WEAPON_ASSET_BASE_PATH,
      WEAPON_ASSET_FILES.M4A1,
      scene
    ),
  ]);

  normalizeMercContainerGeometry(mercContainer);

  return {
    spyContainer,
    mercContainer,
    mercenaryContainer,
    weaponM4A1Container,
  };
}
