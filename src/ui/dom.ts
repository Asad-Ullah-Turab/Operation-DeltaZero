/**
 * Typed DOM lookup helpers for UI components and HUD overlays.
 */

/**
 * Retrieves a typed HTML element by its document ID.
 */
export function getHtmlElement<T extends HTMLElement>(id: string): T | null {
  if (typeof document === 'undefined') return null;
  return document.getElementById(id) as T | null;
}

