Last verified: 2026-10-26 at commit 208a701

## 1. What this is
3D asymmetrical LAN arena shooter (TypeScript, Babylon.js, Rapier3D, Colyseus). Two playable classes: Mercenary (`'Merc'`, first-person, rifle ADS/recoil) and Spy (`'Spie'`, third-person parkour/mantling). Scope: obstacle arena, client hitscan ballistics, skeletal animations, death/respawn loop, 20 Hz state sync for $\le 32$ players.

## 2. Stack and commands

| Layer | Technology | Version |
| :--- | :--- | :--- |
| 3D Engine | Babylon.js (`@babylonjs/core`, `@babylonjs/loaders`) | `^7.0.0` |
| Physics | Rapier3D (`@dimforge/rapier3d-compat`) | `^0.14.0` |
| Networking | Colyseus (`colyseus`, `colyseus.js`, `@colyseus/schema`) | `^0.15.0` |
| Server | Node.js + Express (`^4.21.0`) + `tsx` (`^4.19.0`) | Node 20+ |
| Bundler | Vite + TypeScript | ES2022 |
| Desktop | Tauri v2 (`@tauri-apps/cli`) | `^2.0.0` |

### Commands (`package.json`)
- `npm run dev` / `server`: Vite client (`:5173`) / Colyseus server (`ws://:2567`).
- `npm run build` / `preview`: `tsc && vite build` (to `dist/`) / preview.
- `npm run tauri:dev` / `tauri:build`: Desktop dev / package build.
- `npm run build:linux` / `build:win`: Platform release scripts.

### Pre-commit Verification Gate
- `npx tsc --noEmit` (strict mode, 0 unused errors).
- `npm run build` (production Vite bundle).
- Cycle check (DFS script: 0 cycles in 81 `.ts` files).
- `timeout 3 npx tsx server/index.ts` (boots on `:2567`).

## 3. Current state

### Implemented
- Classes: `'Merc'` (first-person) and `'Spie'` (third-person parkour).
- Mercenary: ADS sights, sway/bob, recoil springs, 30/120 ammo, reload timer, muzzle flash, sparks, smoke.
- Spy: Raycast obstacle checks, climb, ledge grab, mantling, crouch toggle, hide pose.
- Physics: Rapier3D kinematic cylinder, ground raycasts, static obstacle boxes.
- Combat: Bullet tracers, hitzones (head 50, torso 25, limbs 10 HP), damage flash.
- Network & UI: Colyseus room ($\le 32$ players), 20 Hz sync, 33.3 Hz patches, interpolation, reticle, HUDs, modal select, respawn.

### Not Implemented
- Teams, friendly fire, score/match flow, timers, win conditions, or game modes (intel/control points).
- Audio (zero SFX or music; no Babylon sound engine).
- Stealth (vision cones, shadow detection, disguise, radar).
- Secondary weapons, grenades, gadgets, melee combat.
- Level files (arena generated procedurally via seeded PRNG).
- Server lag compensation, rewind buffers, authoritative hit checks, tests.

### Known Bugs and Limitations
- Client-authoritative hits: shooter detects hits locally; server relays damage without validation (`combatHandlers.ts`).
- Server schema lacks health: `Player` schema has no HP; server forwards damage to victim for local deduction (`GameState.ts`).
- Variable timestep: `world.step()` uses delta-time; jumps and mantling vary across refresh rates (`gameLoop.ts`).
- Spy hide override: 'H' triggers hide animation even when airborne, climbing, or mantling (`InputController.ts`).
- Remote Merc pose reset: remote Mercenary models rely on per-frame bone pose fixing that can reset if animations update (`staticPose.ts`).

## 4. Architecture in brief

### Client / Server Split
- **Server owns**: connection lifecycle, client roster, boundary clamping, state broadcasting, binary delta patching (`x`, `y`, `z`, `rotationY`, `anim`, `characterType`).
- **Client decides**: locomotion physics, input capture, ballistics, raycasts, hitzones, health deduction, reload timers, camera rigs.

### Layering Rules
`src/app/` $\to$ `src/player/`, `src/combat/`, `src/network/`, `src/world/`, `src/ui/` $\to$ `src/physics/`, `src/config/` $\to$ `src/utils/`, `shared/`
- Top-level folders export public APIs solely via `index.ts` barrels.
- `shared/` never imports Babylon, Rapier, DOM, or Colyseus server.
- `combat/` cannot import `player/` or `network/`; `player/` cannot import `network/` or `app/`. 0 cycles.

### Folder Responsibilities
- `shared/`: Types, protocol, combat config, clamp.
- `server/`: Colyseus room lifecycle & handlers.
- `src/app/`: Bootstrap, scene, cameras, game loop, respawn.
- `src/player/`: LocalPlayer coordinator, input, rigs, movement.
- `src/combat/`: Bullet tracers, muzzle flash, impact VFX.
- `src/network/`: NetworkManager, entity interpolation, room events.
- `src/physics/`: Rapier3D world setup, colliders, raycasts.
- `src/world/`: Seeded obstacles and arena builder.
- `src/ui/`: DOM cache, FPS, character select, HUD.
- `src/config/`: Arena, asset paths, network, weapons tuning.
- `src/utils/`: Angle normalization, yaw math.
- `src/styles/`: CSS (canvas, reticle, HUD, menus).

### Flow Summaries (Files Only)
- **Startup**: `main.ts` $\to$ `bootstrap.ts` (`scene`, `world`, `assets`, `arena`, `player`, `cameras`, `network`, `gameLoop`).
- **Loop & Combat**: `gameLoop.ts` (`physics.step()` $\to$ `player.update()` $\to$ `combatEffects.update()` $\to$ `network.sendUpdate()` $\to$ `scene.render()`); combat flows `WeaponController` $\to$ `BulletSimulator` $\to$ `hitHandler` $\to$ `network` $\to$ `server` $\to$ `HealthController` $\to$ `respawnFlow`.

### Key Files (Top 12)
1. `src/main.ts`: 9-line app entry. | 2. `src/app/bootstrap.ts`: Startup pipeline.
3. `src/app/gameLoop.ts`: Render loop & order. | 4. `src/player/LocalPlayer.ts`: Player facade.
5. `src/player/characterSetup.ts`: Visuals/cameras. | 6. `src/combat/CombatEffectsManager.ts`: VFX facade.
7. `src/network/NetworkManager.ts`: Client sync. | 8. `server/rooms/GameRoom.ts`: Room lifecycle.
9. `shared/protocol.ts`: Wire schemas. | 10. `shared/combatConfig.ts`: Damage & max HP.
11. `src/config/weapons.ts`: Weapon tuning. | 12. `src/physics/colliders.ts`: Rapier colliders.

## 5. Network protocol

| Message | Dir | Payload | Handler |
| :--- | :--- | :--- | :--- |
| `selectCharacter` | C $\to$ S | `{ characterType: 'Spie' \| 'Merc' }` | `server/handlers/characterHandlers.ts` |
| `move` | C $\to$ S | `{ x, y, z, rotationY, anim?, characterType? }` | `server/handlers/movementHandlers.ts` |
| `jump` | C $\to$ S | `{ y?, anim? }` | `server/handlers/movementHandlers.ts` |
| `shoot` | C $\to$ S | `{ originX..Z, dirX..Z }` | `server/handlers/combatHandlers.ts` |
| `playerHit` | C $\to$ S | `{ targetSessionId, damage, zone? }` | `server/handlers/combatHandlers.ts` |
| `playerDied` | C $\to$ S / S $\to$ C | `{ sessionId? }` | `server/handlers/combatHandlers.ts` / `roomHandlers.ts` |
| `respawn` | C $\to$ S | `{ characterType, x, y, z }` | `server/handlers/characterHandlers.ts` |
| `playerShoot` | S $\to$ C | `{ sessionId, originX..Z, dirX..Z }` | `src/network/roomHandlers.ts` |
| `takeDamage` | S $\to$ C | `{ attackerSessionId?, damage, zone? }` | `src/network/roomHandlers.ts` |
| `playerRespawned` | S $\to$ C | `{ sessionId, characterType, x, y, z }` | `src/network/roomHandlers.ts` |

### Colyseus Schema Fields
- `Player`: `x`, `y`, `z`, `rotationY`, `anim`, `characterType` (`server/schema/GameState.ts`).
- `GameState`: `players: MapSchema<Player>` (`server/schema/GameState.ts`).

### Shared Types Location
All shared interfaces live in `shared/` (`types.ts`, `protocol.ts`, `combatConfig.ts`, `utils.ts`), imported via relative paths (`../../shared`).

## 6. Where things live

| If you need to change... | Go to file / folder |
| :--- | :--- |
| **Network message name or payload** | `shared/protocol.ts`, `server/handlers/`, `src/network/roomHandlers.ts` |
| **Health max or hit zone damage** | `shared/combatConfig.ts` |
| **Weapon ammo, recoil, sway, ADS** | `src/config/weapons.ts` |
| **Mercenary speed or jump** | `src/config/weapons.ts`, `player/systems/MercMovement.ts` |
| **New player subsystem** | `player/systems/`, expose in `index.ts`, add to `LocalPlayer.ts` |
| **Character 3D models or rigs** | `player/visuals/spie/` or `player/visuals/merc/` |
| **HUD gauges & styling** | `ui/hud/`, `styles/hud.css` or `crosshair.css` |
| **Combat VFX, muzzle flash, sparks** | `combat/effects/`, `combat/muzzleFlash.ts` |
| **Arena size, obstacles, colliders** | `config/arena.ts`, `world/obstacles.ts`, `physics/colliders.ts` |
| **Character asset paths** | `config/assets.ts` |
| **Server validation or handlers** | `server/handlers/` |
| **Server ports, host, WebSocket URL** | `server/index.ts`, `config/network.ts` |

## 7. Gotchas

1. **Wire names `'Spie'` & `'Merc'`**: Case-sensitive wire protocol string literals (`shared/types.ts`, `server/schema/GameState.ts`). Do not rename to 'Spy'.
2. **Server has no health state**: `Player` schema lacks HP; server relays damage to victim client for local deduction (`GameState.ts`, `HealthController.ts`).
3. **Client-authoritative hit detection**: Raycasts run on shooter; server forwards damage without line-of-sight checks (`hitHandler.ts`, `combatHandlers.ts`).
4. **Frame-dependent physics step**: `world.step()` uses delta-time; jump arcs vary across monitor refresh rates (`src/app/gameLoop.ts`).
5. **Hardcoded DOM IDs**: UI controllers query exact IDs (`renderCanvas`, `ammo-container`, `health-container`, `damage-flash`, `crosshair`, `character-select-overlay`) from `index.html` (`src/ui/dom.ts`).
6. **Feature barrel rule**: External code imports only from a feature's `index.ts`; internal siblings import directly to avoid cyclic dependencies.
7. **No path aliases**: Imports are strictly relative (`../../shared`, `../config/weapons`); tsconfig/Vite do not configure `@/...` aliases (`tsconfig.json`).
8. **Async Rapier WASM init**: `await RAPIER.init()` must resolve before creating physics worlds or colliders (`physics/world.ts`, `bootstrap.ts`).
9. **Dual camera swapping**: Switching classes requires swapping `scene.activeCamera` (`ArcRotateCamera` vs `FreeCamera`) and toggling HUDs (`characterSetup.ts`).
10. **Zero-GC scratch vectors**: Movement loops reuse persistent scratch vectors (`forwardScratch`, `moveDirScratch`) to avoid GC pauses (`LocalPlayer.ts`).
