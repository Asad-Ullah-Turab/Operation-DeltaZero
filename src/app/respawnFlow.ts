/**
 * Player death lifecycle, character selection menu prompting, network respawn broadcasts, and pointer lock reacquisition.
 */

import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { LocalPlayer } from '../player';
import type { NetworkManager } from '../network';
import { showCharacterSelectMenu } from '../ui';

/**
 * Registers death callback on local player: broadcasts death, presents character selection,
 * respawns local entity, notifies the server, and restores canvas focus.
 */
export function setupRespawnFlow(
  localPlayer: LocalPlayer,
  network: NetworkManager,
  arcCamera: ArcRotateCamera,
  canvas: HTMLCanvasElement
): void {
  localPlayer.onDeath = () => {
    network.sendPlayerDied();
    showCharacterSelectMenu((selectedType) => {
      localPlayer.respawn(selectedType, arcCamera);
      network.sendSelectCharacter(selectedType);
      const pos = localPlayer.mesh.position;
      network.sendRespawn(selectedType, pos.x, pos.y, pos.z);
      canvas.focus();
      void canvas.requestPointerLock?.();
    });
  };
}

