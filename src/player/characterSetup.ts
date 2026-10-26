/**
 * Character setup and visual initialization for LocalPlayer.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { CharacterType } from '../../shared';
import {
  setCrosshairVisible,
  setAmmoHudVisible,
  setHealthHudVisible,
} from '../ui';
import {
  STANDING_EYE_OFFSET,
  HIP_FOV_RAD,
} from '../config/weapons';
import type {
  CharacterAssets,
  CharacterVisual,
} from './types';
import { createMercVisual } from './visuals/merc';
import { createSpyVisual } from './visuals/spy';
import type { HealthController, WeaponController } from './systems';

export interface LocalCharacterSetup {
  mesh: Mesh;
  visual: CharacterVisual;
  fpCamera: FreeCamera | null;
  viewmodelRig: TransformNode | null;
  currentAnim: string;
}

/**
 * Instantiates visual nodes, camera rigs, and UI elements for the local player.
 */
export function setupLocalCharacter(
  scene: Scene,
  assets: CharacterAssets,
  characterType: CharacterType,
  weaponController: WeaponController,
  healthController: HealthController
): LocalCharacterSetup {
  if (characterType === 'Merc') {
    const mesh = new Mesh('local_merc_collision_root', scene);
    mesh.isVisible = false;
    mesh.isPickable = false;

    const fpCam = new FreeCamera(
      'mercFirstPersonCamera',
      new Vector3(0, 2.0 + STANDING_EYE_OFFSET, 0),
      scene
    );
    fpCam.minZ = 0.02;
    fpCam.fov = HIP_FOV_RAD;
    fpCam.inputs.clear();

    const rig = new TransformNode('mercViewmodelRig', scene);
    rig.parent = fpCam;

    const visual = createMercVisual(
      'local_merc_viewmodel',
      scene,
      assets.mercContainer,
      true
    );
    visual.root.parent = rig;
    const currentAnim = visual.getCurrentAnimation();

    setCrosshairVisible(true);
    setAmmoHudVisible(true);
    setHealthHudVisible(false);
    weaponController.updateAmmoHud();

    return {
      mesh,
      visual,
      fpCamera: fpCam,
      viewmodelRig: rig,
      currentAnim,
    };
  }

  const visual = createSpyVisual(
    'local_spie_player',
    scene,
    assets.spyContainer
  );
  const mesh = visual.root;
  const currentAnim = 'Idle';

  setCrosshairVisible(false);
  setHealthHudVisible(true);
  setAmmoHudVisible(false);
  healthController.updateHealthHud();

  return {
    mesh,
    visual,
    fpCamera: null,
    viewmodelRig: null,
    currentAnim,
  };
}

/**
 * Switches UI and camera when the player respawns as a new character type.
 */
export function applyRespawnCharacterType(
  scene: Scene,
  selectedType: CharacterType,
  visual: CharacterVisual,
  fpCamera: FreeCamera | null,
  arcCamera: ArcRotateCamera | null | undefined,
  healthController: HealthController,
  weaponController: WeaponController
): void {
  if (selectedType === 'Spie') {
    setHealthHudVisible(true);
    setAmmoHudVisible(false);
    setCrosshairVisible(false);
    healthController.updateHealthHud();
    visual.playAnimation('idle');
    if (arcCamera) {
      scene.activeCamera = arcCamera;
    }
  } else {
    setHealthHudVisible(false);
    setAmmoHudVisible(true);
    setCrosshairVisible(true);
    weaponController.resetAmmo();
    if (fpCamera) {
      scene.activeCamera = fpCamera;
    }
  }
}

