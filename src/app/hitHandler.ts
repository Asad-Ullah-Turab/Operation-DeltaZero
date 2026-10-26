/**
 * Bullet collision handler dispatching authoritative damage to local player or remote network peers.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { getDamageForHitZone, type CharacterType } from '../../shared';
import type { CombatEffectsManager, BulletHitEvent } from '../combat';
import type { LocalPlayer } from '../player';
import type { NetworkManager } from '../network';

/**
 * Wires operative character bullet hit events to local damage reception or network replication.
 */
export function setupHitHandler(
  combatEffects: CombatEffectsManager,
  network: NetworkManager
): void {
  combatEffects.onHit = (event: BulletHitEvent) => {
    const hitBody = event.body;
    if (!hitBody || !(hitBody as unknown as { userData?: unknown }).userData) {
      return;
    }

    const data = (
      hitBody as unknown as {
        userData: {
          isLocal?: boolean;
          isRemote?: boolean;
          sessionId?: string;
          player?: LocalPlayer;
          remotePlayer?: {
            characterType: CharacterType;
            visual: { getHitZone?: (p: Vector3) => 'head' | 'torso' | 'limbs' };
          };
          characterType?: CharacterType;
        };
      }
    ).userData;

    if (data.isLocal && data.player) {
      if (data.player.characterType === 'Spie') {
        const zone = data.player.classifyHitZone(event.hitPoint);
        const damage = getDamageForHitZone(zone);
        data.player.takeDamage(damage, zone);
      }
    } else if (data.isRemote && data.sessionId && data.remotePlayer) {
      if (data.remotePlayer.characterType === 'Spie') {
        const zone = data.remotePlayer.visual.getHitZone
          ? data.remotePlayer.visual.getHitZone(event.hitPoint)
          : 'torso';
        const damage = getDamageForHitZone(zone);
        network.sendPlayerHit(data.sessionId, damage, zone);
      }
    }
  };
}
