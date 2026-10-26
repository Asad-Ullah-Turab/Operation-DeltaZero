/**
 * In-game FPS monitor display updater.
 */

import { getHtmlElement } from './dom';

let cachedFpsCounterEl: HTMLElement | null = null;

/**
 * Updates the text content of the FPS counter overlay.
 */
export function updateFpsCounter(fps: number): void {
  if (!cachedFpsCounterEl) {
    cachedFpsCounterEl = getHtmlElement('fps-counter');
  }
  if (cachedFpsCounterEl) {
    cachedFpsCounterEl.textContent = 'FPS: ' + fps.toFixed(0);
  }
}

