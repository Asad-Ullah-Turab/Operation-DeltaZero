# Operation DeltaZero

[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-blue.svg)](https://www.typescriptlang.org/)
[![Babylon.js](https://img.shields.io/badge/Babylon.js-7.0-darkred.svg)](https://www.babylonjs.com/)
[![Rapier3D](https://img.shields.io/badge/Rapier3D-WASM-orange.svg)](https://rapier.rs/)
[![Colyseus](https://img.shields.io/badge/Colyseus-0.15-purple.svg)](https://colyseus.io/)
[![Tauri](https://img.shields.io/badge/Tauri-v2-blueviolet.svg)](https://tauri.app/)
[![Vite](https://img.shields.io/badge/Vite-6.0-yellow.svg)](https://vitejs.dev/)

**Operation DeltaZero** is a fast-paced 3D multiplayer tactical combat arena built with **Babylon.js**, **Rapier3D WASM**, **Colyseus**, and **Tauri v2**. The game features authoritative networking, physics-driven character simulation, and two distinct operative classes with unique combat perspectives and mechanics.

---

## Features

- **Authoritative Multiplayer Architecture**: Colyseus WebSocket server with binary delta state synchronization operating at a 30ms patch rate (~33.3 Hz) with smooth remote entity interpolation.
- **WASM Physics Engine**: Rapier3D continuous collision detection with kinematic player cylinder colliders, raycasting, dynamic ground detection, and obstacle collision.
- **Dual Class Gameplay**:
  - **Mercenary**: Immersive first-person tactical shooter experience with magazine tracking, procedural weapon sway, ADS iron sights, and recoil kick.
  - **Spie**: Third-person agility operative with a linear-crossfaded multi-track animation state machine, snappy camera-facing locomotion, and dedicated strafing modes.
- **Cross-Platform Native Desktop Shell**: Packaged with Tauri v2 for high-performance Linux and Windows native execution without browser chrome overhead.
- **Dynamic Combat VFX**: Particle muzzle flashes, ballistic yellow tracers, bullet surface impact sparks, and barrel smoke emission after sustained fire bursts.

---

## Operatives

### 1. Mercenary (First-Person Specialist)
- **First-Person Viewmodel**: Local view features animated arms wielding an M4A1 (`fps_merc_m4a1.glb`) attached to a procedural motion rig.
- **Third-Person World Model**: Other players on the server see a fully rendered tactical operator (`mercenary.glb`) with replicated orientation and muzzle flash synchronization.
- **Weapon Mechanics**:
  - **Ballistics**: 5.56x45mm NATO rounds with Rapier raycast hit-scan detection and visual yellow projectile tracers.
  - **Procedural Recoil**: Viewmodel kickback, vertical climb, horizontal jitter, and camera pitch recovery.
  - **Aim Down Sights (ADS)**: Smooth iron-sight centering with FOV reduction (72° hip-fire to 48° ADS), stabilized weapon sway, and dampened recoil.
  - **Magazine System**: Tactical reload ('R') discards the active magazine and loads from 4 spare magazines (30 rounds per magazine, 150 rounds total).
  - **Procedural Rigging**: Spring-damper jump lag, landing compression, crouching offsets, and mouse-look sway inertia.
  - **Low-Ready**: Toggleable low-ready weapon stow ('H') to clear screen space when traversing the arena.

### 2. Spie (Third-Person Agility Operative)
- **Third-Person Perspective**: Replicated agent model (`spy.glb`) with an orbit camera.
- **Locomotion State Machine**: Multi-track animation blending system featuring:
  - **Crisp Crossfading**: Linear rate blending (~70ms) eliminating asymptotic decay tails and skating.
  - **Instant Paddle**: Movement starts paddling leg strides on frame 1 without preparatory slide lag.
  - **Camera Decoupling**: While stationary, orbiting the camera does not alter character facing; moving immediately turns the character towards movement direction.
  - **180° Directional Reversal**: Rapid reversals trigger dynamic `walking-turn-180` turnarounds in place.
  - **Camera-Locked Strafing**: Holding Right Click locks character facing to the camera crosshair while pressing A/D triggers dedicated `left-strafe-walking` and `right-strafe-walking` animations with mutual exclusion.

---

## Controls

### Common Controls
| Input | Action |
| :--- | :--- |
| **W, A, S, D** / **Arrow Keys** | Character Movement (Forward, Left, Backward, Right) |
| **Space** | Jump |
| **Left Shift** | Sprint |
| **C** / **Ctrl** | Crouch |
| **Mouse Move** | Aim / Look (Pointer lock active) |

### Mercenary Specifics
| Input | Action |
| :--- | :--- |
| **Left Click (LMB)** | Fire M4A1 (Automatic burst / single tap) |
| **Right Click (RMB) [Hold]** | Hold Aim Down Sights (ADS) |
| **Right Click (RMB) [Tap]** | Toggle Aim Down Sights (ADS) |
| **R** | Tactical Magazine Reload |
| **H** | Low-Ready Weapon Stow / Ready Toggle |

### Spie Specifics
| Input | Action |
| :--- | :--- |
| **Mouse Orbit** | Free camera orbit around operative |
| **Right Click (RMB) [Hold]** | Lock character facing to camera & enable Strafe Walking |

---

## Tech Stack & Architecture

```
┌────────────────────────────────────────────────────────┐
│                   Operation DeltaZero                  │
├──────────────────────────┬─────────────────────────────┤
│ Frontend (Client)        │ Authoritative Server        │
├──────────────────────────┼─────────────────────────────┤
│ • Babylon.js 7           │ • Colyseus Server 0.15      │
│ • Rapier3D (WASM)        │ • Express + WebSockets      │
│ • Colyseus.js Client     │ • 30ms State Patch Rate     │
│ • TypeScript + Vite      │ • Room Binary Serialization │
│ • Tauri v2 Desktop Shell │ • Lag-Compensated Sync      │
└──────────────────────────┴─────────────────────────────┘
```

- **`src/main.ts`**: Entry point, engine lifecycle, canvas pointer locking, obstacle generation, and render loop.
- **`src/player.ts`**: Player physics controller, character asset loading, viewmodel procedural rig, animation blending state machine, weapon mechanics, and recoil.
- **`src/combat.ts`**: Bullet projectiles, particle muzzle flashes, surface impact sparks, and barrel smoke.
- **`src/network.ts`**: Colyseus room event handling, movement packet replication, and remote player visual instantiation (`mercenary.glb` and `spy.glb`).
- **`src/physics.ts`**: Rapier3D world initialization, kinematic ground colliders, obstacle bounding boxes, and player cylinder bodies.
- **`server/GameRoom.ts`**: Authoritative Colyseus room managing state synchronization, character selection, shooting replication, and arena bounds.

---

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [npm](https://www.npmjs.com/)

### Installation

1. Clone the repository:
   ```bash
   git clone git@github.com:Asad-Ullah-Turab/Operation-DeltaZero.git
   cd Operation-DeltaZero
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Running Locally

To run the multiplayer game on your local machine:

1. **Start the Colyseus Multiplayer Server** (Terminal 1):
   ```bash
   npm run server
   ```
   *The server starts listening on `ws://0.0.0.0:2567`.*

2. **Start the Vite Client Dev Server** (Terminal 2):
   ```bash
   npm run dev
   ```
   *Open `http://localhost:5173` in your browser (or multiple tabs to test multiplayer).*

3. Click **Spie** or **Mercenary** on the class selection screen to deploy into the arena.

---

## Building & Packaging

### Production Web Build
```bash
npm run build
```
Generates optimized, minified production assets in `dist/`.

### Native Desktop App (Tauri v2)

- **Run in Desktop Dev Mode**:
  ```bash
  npm run tauri:dev
  ```

- **Build Native Linux Package** (`.deb`, `.rpm`, or AppImage):
  ```bash
  npm run build:linux
  ```

- **Build Windows Executable** (Cross-compile via MinGW/scripts):
  ```bash
  npm run build:win
  ```

---

## Repository Structure

```
Operation-DeltaZero/
├── public/
│   └── assets/
│       └── characters/
│           ├── fps_merc_m4a1.glb   # Mercenary first-person arms + weapon
│           ├── mercenary.glb       # Mercenary third-person world model
│           └── spy.glb             # Spie third-person animated operative
├── server/
│   ├── index.ts                    # Colyseus HTTP/WebSocket server entry
│   ├── GameRoom.ts                 # Authoritative game room logic
│   └── schema/
│       └── GameState.ts            # Colyseus binary schema state definition
├── src/
│   ├── combat.ts                   # Ballistics, muzzle flash, impacts, smoke
│   ├── index.html                  # HTML HUD, crosshair, and selection UI
│   ├── main.ts                     # Bootstrap, scene setup, render loop
│   ├── network.ts                  # Network client & remote entity manager
│   ├── physics.ts                  # Rapier3D colliders & physics world
│   ├── player.ts                   # Local player & character visual controllers
│   └── style.css                   # HUD & menu styling
├── src-tauri/                      # Tauri v2 native desktop configuration
├── scripts/                        # Automated build scripts for Linux and Windows
├── package.json                    # Project scripts & dependencies
└── tsconfig.json                   # TypeScript configuration
```

---

## License

MIT License. See project files for details.

