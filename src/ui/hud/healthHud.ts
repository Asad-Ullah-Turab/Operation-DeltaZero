/**
 * Operative health status HUD updates and visibility management for Spy operative.
 */

import { getHtmlElement } from '../dom';

let cachedHealthHudEl: HTMLElement | null = null;
let cachedHealthValueEl: HTMLElement | null = null;
let cachedHealthFillEl: HTMLElement | null = null;

function resolveHealthElements(): void {
  if (!cachedHealthHudEl) cachedHealthHudEl = getHtmlElement('health-hud');
  if (!cachedHealthValueEl) cachedHealthValueEl = getHtmlElement('health-value');
  if (!cachedHealthFillEl) cachedHealthFillEl = getHtmlElement('health-bar-fill');
}

/**
 * Toggles the visibility of the health status HUD widget.
 */
export function setHealthHudVisible(visible: boolean): void {
  resolveHealthElements();
  if (cachedHealthHudEl) {
    cachedHealthHudEl.classList.toggle('hidden', !visible);
  }
}

/**
 * Updates the operative health status readout and colored bar fill.
 */
export function updateHealthHud(currentHp: number, maxHp = 100): void {
  resolveHealthElements();

  if (cachedHealthValueEl) {
    cachedHealthValueEl.textContent = String(currentHp);
    cachedHealthValueEl.className = 'health-value';
    if (currentHp <= 25) {
      cachedHealthValueEl.classList.add('low');
    } else if (currentHp <= 50) {
      cachedHealthValueEl.classList.add('mid');
    }
  }

  if (cachedHealthFillEl) {
    const pct = Math.max(0, Math.min(100, (currentHp / maxHp) * 100));
    cachedHealthFillEl.style.width = `${pct}%`;
    cachedHealthFillEl.className = 'health-bar-fill';
    if (currentHp <= 25) {
      cachedHealthFillEl.classList.add('low');
    } else if (currentHp <= 50) {
      cachedHealthFillEl.classList.add('mid');
    }
  }

  if (cachedHealthHudEl) {
    if (currentHp <= 25) {
      cachedHealthHudEl.style.borderRightColor = '#ef4444';
    } else if (currentHp <= 50) {
      cachedHealthHudEl.style.borderRightColor = '#f59e0b';
    } else {
      cachedHealthHudEl.style.borderRightColor = '#10b981';
    }
  }
}

