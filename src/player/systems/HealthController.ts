/**
 * Health management, damage reception, death state, and health HUD updates.
 */

import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { PLAYER_HALF_HEIGHT } from '../../config/arena';
import {
  updateHealthHud as uiUpdateHealthHud,
  triggerDamageFlash as uiTriggerDamageFlash,
} from '../../ui';
import type { CharacterVisual } from '../types';

export class HealthController {
  public currentHp = 100;
  public readonly maxHp = 100;
  public isDead = false;
  public onDeath?: () => void;

  /**
   * Applies damage to player, updates HUD and flash, and triggers death when depleted.
   */
  public takeDamage(
    amount: number,
    zone = 'torso',
    onKilled?: () => void
  ): void {
    if (this.isDead) return;

    this.currentHp = Math.max(0, this.currentHp - amount);
    this.updateHealthHud();
    this.triggerDamageFlash();

    console.log(
      `[Health] Took ${amount} damage (${zone}). Remaining HP: ${this.currentHp}/100`
    );

    if (this.currentHp <= 0) {
      this.handleDeath(onKilled);
    }
  }

  /**
   * Classifies a bullet impact into head, torso, or limbs using character hitboxes
   * with geometric fallback.
   */
  public classifyHitZone(
    hitPoint: Vector3,
    visual: CharacterVisual,
    meshPosition: Vector3
  ): 'head' | 'torso' | 'limbs' {
    if (visual.getHitZone) {
      return visual.getHitZone(hitPoint);
    }
    const feetY = meshPosition.y - PLAYER_HALF_HEIGHT;
    const relY = hitPoint.y - feetY;
    if (relY >= 1.42) return 'head';
    if (relY >= 0.82) {
      const dx = hitPoint.x - meshPosition.x;
      const dz = hitPoint.z - meshPosition.z;
      if (Math.hypot(dx, dz) <= 0.22) return 'torso';
    }
    return 'limbs';
  }

  /**
   * Pushes current HP to the UI HUD component.
   */
  public updateHealthHud(): void {
    uiUpdateHealthHud(this.currentHp, this.maxHp);
  }

  /**
   * Triggers visual red damage flash vignette in UI.
   */
  public triggerDamageFlash(): void {
    uiTriggerDamageFlash();
  }

  /**
   * Handles player death: flags dead state, exits pointer lock, and fires death callbacks.
   */
  public handleDeath(onKilled?: () => void): void {
    if (this.isDead) return;
    this.isDead = true;

    if (document.pointerLockElement) {
      document.exitPointerLock?.();
    }

    onKilled?.();
    this.onDeath?.();
  }

  /**
   * Resets health and death state to initial values upon respawn.
   */
  public reset(): void {
    this.currentHp = 100;
    this.isDead = false;
  }
}

