import { io, Socket } from 'socket.io-client';
import * as THREE from 'three';
import { Player, createCylinderMesh } from './player';

export interface PlayerState {
  id: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  color: number;
}

interface RemotePlayerEntry {
  mesh: THREE.Group;
  targetPosition: THREE.Vector3;
  targetRotationY: number;
}

/**
 * Manages Socket.IO connection over LAN, synchronizes the local player's
 * transform to the server, and renders/interpolates remote players.
 */
export class NetworkManager {
  private readonly socket: Socket;
  private readonly scene: THREE.Scene;
  private readonly localPlayer: Player;
  private readonly remotePlayers = new Map<string, RemotePlayerEntry>();
  private readonly statusEl: HTMLElement | null;

  private lastSentPosition = new THREE.Vector3();
  private lastSentRotationY = 0;

  constructor(scene: THREE.Scene, localPlayer: Player) {
    this.scene = scene;
    this.localPlayer = localPlayer;
    this.statusEl = document.getElementById('status');

    // Connect to port 3000 on whichever LAN IP the browser used to load the page
    // (fallback to localhost when loaded via Electron's file:// protocol)
    const host = window.location.hostname || 'localhost';
    const serverUrl = `http://${host}:3000`;
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
    });

    this.registerSocketEvents();
  }

  private registerSocketEvents(): void {
    this.socket.on('connect', () => {
      console.log(`[Network] Connected to LAN server as ${this.socket.id}`);
      this.updateStatusHud();
    });

    this.socket.on('disconnect', () => {
      console.log('[Network] Disconnected from server');
      if (this.statusEl) {
        this.statusEl.textContent = 'Disconnected from server';
        this.statusEl.style.color = '#f87171';
      }
    });

    // 1. Receive initial snapshot of all connected players
    this.socket.on('currentPlayers', (players: Record<string, PlayerState>) => {
      for (const [id, state] of Object.entries(players)) {
        if (id === this.socket.id) {
          // Apply server-assigned color & spawn point to our local player
          this.localPlayer.applyServerSpawn(
            state.x,
            state.y,
            state.z,
            state.color
          );
        } else {
          this.addRemotePlayer(state);
        }
      }
      this.updateStatusHud();
    });

    // 2. A new player joined the LAN session
    this.socket.on('playerJoined', (state: PlayerState) => {
      if (state.id === this.socket.id) return;
      console.log(`[Network] Remote player joined: ${state.id}`);
      this.addRemotePlayer(state);
      this.updateStatusHud();
    });

    // 3. A remote player moved
    this.socket.on('playerMoved', (state: PlayerState) => {
      const remote = this.remotePlayers.get(state.id);
      if (!remote) {
        this.addRemotePlayer(state);
        return;
      }
      remote.targetPosition.set(state.x, state.y, state.z);
      remote.targetRotationY = state.rotationY;
    });

    // 4. A remote player disconnected -> remove their cylinder
    this.socket.on('playerDisconnected', (playerId: string) => {
      console.log(`[Network] Remote player disconnected: ${playerId}`);
      this.removeRemotePlayer(playerId);
      this.updateStatusHud();
    });
  }

  private addRemotePlayer(state: PlayerState): void {
    if (this.remotePlayers.has(state.id)) return;

    const mesh = createCylinderMesh(state.color);
    mesh.position.set(state.x, state.y, state.z);
    mesh.rotation.y = state.rotationY;
    this.scene.add(mesh);

    this.remotePlayers.set(state.id, {
      mesh,
      targetPosition: new THREE.Vector3(state.x, state.y, state.z),
      targetRotationY: state.rotationY,
    });
  }

  private removeRemotePlayer(playerId: string): void {
    const remote = this.remotePlayers.get(playerId);
    if (!remote) return;

    this.scene.remove(remote.mesh);
    remote.mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach((m) => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    this.remotePlayers.delete(playerId);
  }

  private updateStatusHud(): void {
    if (!this.statusEl) return;
    const totalPlayers = this.remotePlayers.size + (this.socket.connected ? 1 : 0);
    this.statusEl.textContent = `Connected • Players Online: ${totalPlayers}`;
    this.statusEl.style.color = '#4ade80';
  }

  /**
   * Called each frame in the render loop:
   * 1. Emits local player position/rotation if it changed beyond a small threshold.
   * 2. Smoothly interpolates remote player cylinders toward their latest network state.
   */
  public update(deltaTime: number): void {
    // 1. Emit local player transform when moving/rotating
    if (this.socket.connected) {
      const pos = this.localPlayer.mesh.position;
      const rotY = this.localPlayer.rotationY;

      const positionDeltaSq = pos.distanceToSquared(this.lastSentPosition);
      const rotationDelta = Math.abs(rotY - this.lastSentRotationY);

      if (positionDeltaSq > 0.0004 || rotationDelta > 0.01) {
        this.socket.emit('playerMovement', {
          x: pos.x,
          y: pos.y,
          z: pos.z,
          rotationY: rotY,
        });
        this.lastSentPosition.copy(pos);
        this.lastSentRotationY = rotY;
      }
    }

    // 2. Smoothly interpolate remote players
    const lerpFactor = Math.min(1, deltaTime * 15);
    for (const remote of this.remotePlayers.values()) {
      remote.mesh.position.lerp(remote.targetPosition, lerpFactor);
      remote.mesh.rotation.y = remote.targetRotationY;
    }
  }
}

