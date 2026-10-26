/**
 * Network configuration constants and server URL resolution.
 */

export const DEFAULT_SERVER_PORT = 2567;
export const NETWORK_TICK_RATE_HZ = 20;
export const NETWORK_SEND_INTERVAL_MS = 50;

/**
 * Resolves the WebSocket URL for the authoritative Colyseus server.
 */
export function getServerUrl(port = DEFAULT_SERVER_PORT): string {
  const hostname =
    typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'localhost';
  return `ws://${hostname}:${port}`;
}

