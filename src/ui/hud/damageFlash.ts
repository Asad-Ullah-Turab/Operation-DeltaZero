/**
 * Full-screen damage flash vignette trigger.
 */

import { getHtmlElement } from '../dom';

let cachedDamageFlashEl: HTMLElement | null = null;
let flashTimeout: ReturnType<typeof setTimeout> | null = null;

/**
 * Triggers a subtle red radial screen vignette on damage taken.
 */
export function triggerDamageFlash(): void {
  if (!cachedDamageFlashEl) {
    cachedDamageFlashEl = getHtmlElement('damage-flash');
  }
  if (!cachedDamageFlashEl) return;

  if (flashTimeout !== null) {
    clearTimeout(flashTimeout);
  }

  cachedDamageFlashEl.classList.add('active');
  flashTimeout = setTimeout(() => {
    cachedDamageFlashEl?.classList.remove('active');
    flashTimeout = null;
  }, 120);
}

