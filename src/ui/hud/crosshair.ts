/**
 * Centered weapon crosshair overlay visibility manager.
 */

import { getHtmlElement } from '../dom';

let cachedCrosshairEl: HTMLElement | null = null;

/**
 * Toggles the visibility of the centered screen crosshair.
 */
export function setCrosshairVisible(visible: boolean): void {
  if (!cachedCrosshairEl) {
    cachedCrosshairEl = getHtmlElement('crosshair');
  }
  if (cachedCrosshairEl) {
    cachedCrosshairEl.classList.toggle('hidden', !visible);
  }
}

/**
 * Sets the opacity of the centered screen crosshair (used during ADS blending).
 */
export function setCrosshairOpacity(opacity: number): void {
  if (!cachedCrosshairEl) {
    cachedCrosshairEl = getHtmlElement('crosshair');
  }
  if (cachedCrosshairEl) {
    cachedCrosshairEl.style.opacity = opacity.toFixed(2);
  }
}
