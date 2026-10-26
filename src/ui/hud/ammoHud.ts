/**
 * Tactical ammunition HUD updates and visibility management for Mercenary operative.
 */

import { getHtmlElement } from '../dom';

let cachedAmmoHudEl: HTMLElement | null = null;
let cachedAmmoRoundsEl: HTMLElement | null = null;
let cachedAmmoMagsBarsEl: HTMLElement | null = null;
let cachedAmmoMagsCountEl: HTMLElement | null = null;

function resolveAmmoElements(): void {
  if (!cachedAmmoHudEl) cachedAmmoHudEl = getHtmlElement('ammo-hud');
  if (!cachedAmmoRoundsEl) cachedAmmoRoundsEl = getHtmlElement('ammo-rounds');
  if (!cachedAmmoMagsBarsEl) cachedAmmoMagsBarsEl = getHtmlElement('ammo-mags-bars');
  if (!cachedAmmoMagsCountEl) cachedAmmoMagsCountEl = getHtmlElement('ammo-mags-count');
}

/**
 * Toggles the visibility of the ammunition HUD widget.
 */
export function setAmmoHudVisible(visible: boolean): void {
  resolveAmmoElements();
  if (cachedAmmoHudEl) {
    cachedAmmoHudEl.classList.toggle('hidden', !visible);
  }
}

/**
 * Updates the ammunition HUD numbers and reserve magazine bar indicators.
 */
export function updateAmmoHud(currentRounds: number, reserveMagsCount: number): void {
  resolveAmmoElements();

  if (cachedAmmoRoundsEl) {
    cachedAmmoRoundsEl.textContent = String(currentRounds);
    cachedAmmoRoundsEl.classList.toggle('low', currentRounds > 0 && currentRounds <= 8);
    cachedAmmoRoundsEl.classList.toggle('empty', currentRounds === 0);
  }

  if (cachedAmmoMagsBarsEl) {
    const bars = '|'.repeat(reserveMagsCount);
    cachedAmmoMagsBarsEl.textContent = reserveMagsCount > 0 ? `[ ${bars} ]` : '[   ]';
  }

  if (cachedAmmoMagsCountEl) {
    cachedAmmoMagsCountEl.textContent = `${reserveMagsCount} ${
      reserveMagsCount === 1 ? 'MAG' : 'MAGS'
    }`;
  }
}

