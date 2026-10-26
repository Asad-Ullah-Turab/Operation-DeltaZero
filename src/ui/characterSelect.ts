/**
 * Character selection overlay menu logic and selection promise resolver.
 */

import type { CharacterType } from '../../shared';
import { getHtmlElement } from './dom';

/**
 * Shows the character selection menu and registers selection handlers.
 */
export function showCharacterSelectMenu(
  onSelect: (type: CharacterType) => void
): void {
  const menuEl = getHtmlElement('character-select-menu');
  const spieBtn = getHtmlElement('select-spie-btn');
  const mercBtn = getHtmlElement('select-merc-btn');

  if (menuEl) {
    menuEl.classList.remove('hidden');
  }

  const cleanup = (): void => {
    spieBtn?.removeEventListener('click', handleSpie);
    mercBtn?.removeEventListener('click', handleMerc);
  };

  const handleSpie = (): void => {
    cleanup();
    if (menuEl) menuEl.classList.add('hidden');
    onSelect('Spie');
  };

  const handleMerc = (): void => {
    cleanup();
    if (menuEl) menuEl.classList.add('hidden');
    onSelect('Merc');
  };

  spieBtn?.addEventListener('click', handleSpie);
  mercBtn?.addEventListener('click', handleMerc);
}

/**
 * Returns a promise that resolves once the user selects a character class.
 */
export function waitForCharacterSelection(): Promise<CharacterType> {
  return new Promise((resolve) => {
    showCharacterSelectMenu((type) => resolve(type));
  });
}

