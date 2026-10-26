import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import '@babylonjs/loaders/glTF/2.0';
import {
  RAPIER,
  createPlayerCylinderBody,
  isPlayerGrounded,
} from './physics';
import { PLAYER_HALF_HEIGHT } from './config/arena';
import { CombatEffectsManager } from './combat';
import { clamp, type CharacterType } from '../shared';
import {
  setCrosshairVisible,
  setCrosshairOpacity,
  setAmmoHudVisible,
  setHealthHudVisible,
  updateAmmoHud as uiUpdateAmmoHud,
} from './ui';
import { normalizeAngle, lerpAngleY } from './utils/math';
import { HealthController } from './player/systems/HealthController';

export { normalizeAngle, lerpAngleY };

export type { CharacterType };

import {
  type CharacterAssets,
  type NetworkShotEvent,
  type SpieAnimContext,
  type CharacterVisual,
  type SpieAnimationName,
  type SpieTrack,
  SPIE_TRACK_CONFIGS,
} from './player/types';

export type { CharacterAssets, NetworkShotEvent, SpieAnimContext, CharacterVisual, SpieAnimationName, SpieTrack };
export { SPIE_TRACK_CONFIGS };

import {
  loadCharacterAssets,
  loadPlayerAssetContainer,
} from './player/assets';

export { loadCharacterAssets, loadPlayerAssetContainer };

import { createSpieVisual } from './player/visuals/spie';
export { createSpieVisual };

import { createMercVisual, createMercWorldVisual } from './player/visuals/merc';
export { createMercVisual, createMercWorldVisual };

const WALK_SPEED = 7.5;
const RUN_SPEED = 11.5;
const CROUCH_SPEED = 4.2;
const ADS_WALK_SPEED = 4.8;
const JUMP_IMPULSE = 6.2;
const TURN_SMOOTH_SPEED = 14.0;
const MOUSE_SENSITIVITY = 0.0022;
const ADS_MOUSE_SENSITIVITY = 0.0014;

const STANDING_EYE_OFFSET = 0.68;
const CROUCH_EYE_OFFSET = 0.18;

// Magazine & Firing Constants (M4A1: 30 rounds/mag, 5 magazines total: 1 loaded + 4 reserve)
const MAGAZINE_CAPACITY = 30;
const INITIAL_RESERVE_MAGAZINES = 4;
const FIRE_INTERVAL_SECONDS = 0.1; // 100ms between shots (600 RPM)
const BURST_SMOKE_THRESHOLD = 3;

// Procedural ADS Constants (~150ms transition, 72 deg hip FOV -> 52 deg ADS FOV)
const ADS_TRANSITION_DURATION = 0.15;
const HIP_FOV_RAD = (72 * Math.PI) / 180;
const ADS_FOV_RAD = (52 * Math.PI) / 180;
const ADS_OFFSET_X = -0.0547;
const ADS_OFFSET_Y = 0.0365;
const ADS_OFFSET_Z = -0.055;

/**
 * Local player controller supporting both 'Spie' (third-person) and 'Merc'
 * (first-person M4A1 viewmodel with magazine-based ammunition, procedural ADS,
 * automatic firing, procedural recoil, bullet projectiles, muzzle flash,
 * surface impacts, and barrel smoke).
 */
export class LocalPlayer {
  public characterType: CharacterType;
  public visual: CharacterVisual;
  public mesh: Mesh;
  public readonly body: RAPIER.RigidBody;
  public readonly fpCamera: FreeCamera | null = null;
  public rotationY = 0;
  public currentAnim = 'Idle';

  private readonly healthController = new HealthController();

  public get currentHp(): number {
    return this.healthController.currentHp;
  }
  public set currentHp(val: number) {
    this.healthController.currentHp = val;
  }
  public get maxHp(): number {
    return this.healthController.maxHp;
  }
  public get isDead(): boolean {
    return this.healthController.isDead;
  }
  public set isDead(val: boolean) {
    this.healthController.isDead = val;
  }
  public get onDeath(): (() => void) | undefined {
    return this.healthController.onDeath;
  }
  public set onDeath(val: (() => void) | undefined) {
    this.healthController.onDeath = val;
  }

  private readonly scene: Scene;

  private pitchX = 0;
  private targetRotationY = 0;
  private readonly world: RAPIER.World;
  private readonly combatEffects: CombatEffectsManager;
  private readonly keys: Record<string, boolean> = {};
  private jumpRequested = false;
  private jumpedThisFrame = false;

  // Spie third-person crouch & climbing state
  private isCrouchToggled = false;
  private isClimbing = false;
  private climbElapsed = 0;
  private climbDuration = 1.15;
  private readonly climbStartPos = new Vector3();
  private readonly climbTargetPos = new Vector3();

  // Magazine-based ammunition state (1 loaded magazine + 4 individual reserve magazines)
  private currentMagazineRounds = MAGAZINE_CAPACITY;
  private readonly reserveMagazines: number[] = [];

  // Firing & ADS input state
  private isRightClickHeld = false;
  private isFiringHeld = false;
  private fireCooldown = 0;
  private burstShotsFired = 0;
  private isAdsHeld = false;
  private isAdsToggled = false;
  private rmbDownTimestamp = 0;
  private adsBlend = 0;

  // Queued network shot events for replication
  private readonly pendingShots: NetworkShotEvent[] = [];

  // Procedural Recoil State (viewmodel kick + camera climb/shake + spring recovery)
  private recoilPosX = 0;
  private recoilPosY = 0;
  private recoilPosZ = 0;
  private recoilVelZ = 0;
  private recoilPitchX = 0;
  private recoilPitchVelX = 0;
  private recoilYawY = 0;
  private camRecoilPitch = 0;
  private camRecoilYaw = 0;

  // First-person viewmodel rig & procedural motion state (Merc)
  private readonly viewmodelRig: TransformNode | null = null;
  private bobTimer = 0;
  private bobOffsetX = 0;
  private bobOffsetY = 0;
  private bobRollZ = 0;

  private wasGrounded = true;
  private jumpLagY = 0;
  private jumpPitchX = 0;
  private landSpringPosY = 0;
  private landSpringVelY = 0;

  private lookDeltaX = 0;
  private lookDeltaY = 0;
  private swayPosX = 0;
  private swayPosY = 0;
  private swayRotX = 0;
  private swayRotY = 0;

  private crouchBlend = 0;
  private lowReadyBlend = 0;
  private currentEyeOffset = STANDING_EYE_OFFSET;

  // Pre-allocated scratch vectors to avoid GC pauses in the render loop
  private readonly forwardScratch = new Vector3();
  private readonly rightScratch = new Vector3();
  private readonly moveDirScratch = new Vector3();

  constructor(
    scene: Scene,
    world: RAPIER.World,
    assets: CharacterAssets,
    characterType: CharacterType,
    combatEffects: CombatEffectsManager
  ) {
    this.scene = scene;
    this.world = world;
    this.characterType = characterType;
    this.combatEffects = combatEffects;
    this.body = createPlayerCylinderBody(world, 0, 2.0, 0);

    (this.body as unknown as { userData?: unknown }).userData = {
      isLocal: true,
      player: this,
    };

    // Initialize 4 reserve magazines of 30 rounds each (5 magazines total with loaded mag)
    for (let i = 0; i < INITIAL_RESERVE_MAGAZINES; i++) {
      this.reserveMagazines.push(MAGAZINE_CAPACITY);
    }

    if (characterType === 'Merc') {
      // Invisible physics sync root so no third-person body obstructs the camera
      this.mesh = new Mesh('local_merc_collision_root', scene);
      this.mesh.isVisible = false;
      this.mesh.isPickable = false;

      // First-person camera at player eye level (72 deg hip-fire FOV)
      const fpCam = new FreeCamera(
        'mercFirstPersonCamera',
        new Vector3(0, 2.0 + STANDING_EYE_OFFSET, 0),
        scene
      );
      fpCam.minZ = 0.02;
      fpCam.fov = HIP_FOV_RAD;
      fpCam.inputs.clear();
      this.fpCamera = fpCam;

      // Procedural motion rig attached directly to the first-person camera
      const rig = new TransformNode('mercViewmodelRig', scene);
      rig.parent = fpCam;
      this.viewmodelRig = rig;

      // Instantiate Merc viewmodel attached to the procedural rig
      this.visual = createMercVisual(
        'local_merc_viewmodel',
        scene,
        assets.mercContainer,
        true
      );
      this.visual.root.parent = rig;
      this.currentAnim = this.visual.getCurrentAnimation();

      // Reveal tactical ammunition HUD in bottom-right corner
      setCrosshairVisible(true);
      setAmmoHudVisible(true);
      setHealthHudVisible(false);
      this.updateAmmoHud();
    } else {
      this.visual = createSpieVisual(
        'local_spie_player',
        scene,
        assets.spieContainer
      );
      this.mesh = this.visual.root;
      this.currentAnim = 'Idle';

      // Reveal tactical health HUD in bottom-right corner
      setCrosshairVisible(false);
      setHealthHudVisible(true);
      setAmmoHudVisible(false);
      this.updateHealthHud();
    }

    this.initInput();
  }

  private updateAmmoHud(): void {
    uiUpdateAmmoHud(this.currentMagazineRounds, this.reserveMagazines.length);
  }

  /**
   * Applies bullet damage to the Spy based on hit zone:
   * - Torso: 25 HP
   * - Head / Neck: 50 HP
   * - Limbs (Arms / Legs): 10 HP
   */
  public takeDamage(amount: number, zone = 'torso'): void {
    this.healthController.takeDamage(amount, zone, () => this.handleDeathInternal());
  }

  public classifyHitZone(hitPoint: Vector3): 'head' | 'torso' | 'limbs' {
    return this.healthController.classifyHitZone(
      hitPoint,
      this.visual,
      this.mesh.position
    );
  }

  public updateHealthHud(): void {
    this.healthController.updateHealthHud();
  }

  public triggerDamageFlash(): void {
    this.healthController.triggerDamageFlash();
  }

  private handleDeathInternal(): void {
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.isCrouchToggled = false;
    this.isClimbing = false;
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
    }
  }

  public handleDeath(): void {
    this.healthController.handleDeath(() => this.handleDeathInternal());
  }

  public respawn(
    selectedType: CharacterType,
    arcCamera?: ArcRotateCamera | null
  ): void {
    this.healthController.reset();
    this.isCrouchToggled = false;
    this.isClimbing = false;
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
    }

    const spawnSpread = 8;
    const sx = (Math.random() - 0.5) * spawnSpread;
    const sz = (Math.random() - 0.5) * spawnSpread;
    this.setSpawnPosition(sx, 2.0, sz, 0);

    if (selectedType === 'Spie') {
      this.characterType = 'Spie';
      setHealthHudVisible(true);
      setAmmoHudVisible(false);
      setCrosshairVisible(false);
      this.updateHealthHud();
      this.visual.playAnimation('idle');
      if (arcCamera) {
        this.scene.activeCamera = arcCamera;
      }
    } else {
      this.characterType = 'Merc';
      setHealthHudVisible(false);
      setAmmoHudVisible(true);
      setCrosshairVisible(true);
      this.currentMagazineRounds = MAGAZINE_CAPACITY;
      this.reserveMagazines.length = 0;
      for (let i = 0; i < INITIAL_RESERVE_MAGAZINES; i++) {
        this.reserveMagazines.push(MAGAZINE_CAPACITY);
      }
      this.updateAmmoHud();
      if (this.fpCamera) {
        this.scene.activeCamera = this.fpCamera;
      }
    }
  }

  /**
   * Tactical Reload ('R' key):
   * Triggered if not already reloading, not drawing, and spare magazines exist.
   * Discards the current magazine (forgetting any remaining rounds inside it)
   * and loads the next magazine from `reserveMagazines`.
   */
  private tryTacticalReload(): void {
    const anim = this.visual.getCurrentAnimation();
    if (anim === 'Reload' || anim === 'Draw') {
      return;
    }
    if (this.reserveMagazines.length <= 0) {
      return;
    }

    const started = this.visual.triggerReload?.() ?? false;
    if (!started) return;

    // Exit ADS and stop firing when reloading
    this.isAdsHeld = false;
    this.isAdsToggled = false;
    this.stopFiringBurstIfNeeded();

    // Discard current magazine and load the next individual magazine
    const nextMagRounds = this.reserveMagazines.shift() ?? MAGAZINE_CAPACITY;
    this.currentMagazineRounds = nextMagRounds;
    this.currentAnim = this.visual.getCurrentAnimation();
    this.updateAmmoHud();
  }

  private stopFiringBurstIfNeeded(): void {
    if (this.burstShotsFired >= BURST_SMOKE_THRESHOLD) {
      this.combatEffects.spawnBarrelSmoke(this.visual.muzzleNode);
    }
    this.burstShotsFired = 0;
  }

  private initInput(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      if (this.isDead) return;

      if (e.code === 'KeyK' && this.characterType === 'Spie') {
        // Debug test shot on Spy (torso -25 HP)
        this.takeDamage(25, 'torso');
        return;
      }

      this.keys[e.code] = true;

      if (e.code === 'Space' && !e.repeat) {
        this.jumpRequested = true;
      }

      if (e.code === 'KeyC' && !e.repeat) {
        if (this.characterType === 'Spie') {
          this.toggleSpieCrouch();
        }
      }

      if (this.characterType === 'Merc' && !e.repeat) {
        if (e.code === 'KeyR') {
          this.tryTacticalReload();
        } else if (e.code === 'KeyH') {
          this.isAdsHeld = false;
          this.isAdsToggled = false;
          this.stopFiringBurstIfNeeded();
          this.visual.triggerHide?.();
          this.currentAnim = this.visual.getCurrentAnimation();
        }
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    });

    // NOTE: Pointer events are used instead of mousedown/mouseup because
    // Babylon's scene InputManager calls preventDefault() on canvas
    // `pointerdown`, which suppresses legacy mouse events.
    //
    // CRITICAL: We deliberately DO NOT listen to `pointermove` for button state!
    // Under pointer lock (especially on Linux/Wayland and in Firefox), `pointermove`
    // events often report `e.buttons === 0` during cursor translation.
    // Relying on `pointermove` to detect LMB state caused the weapon to stop firing
    // immediately whenever the mouse was moved.
    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      // Ignore clicks before pointer lock is active or when eliminated
      if (document.pointerLockElement === null || this.isDead) return;

      if (e.button === 2) {
        this.isRightClickHeld = true;
      }

      if (this.characterType === 'Merc') {
        if (e.button === 0) {
          this.isFiringHeld = true;
        } else if (e.button === 2) {
          this.rmbDownTimestamp = performance.now();
          if (this.isAdsToggled) {
            this.isAdsToggled = false;
            this.isAdsHeld = false;
          } else {
            this.isAdsHeld = true;
          }
        }
      }
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;

      if (e.button === 2) {
        this.isRightClickHeld = false;
      }

      if (this.characterType === 'Merc') {
        if (e.button === 0) {
          this.isFiringHeld = false;
          this.stopFiringBurstIfNeeded();
        } else if (e.button === 2) {
          const heldMs = performance.now() - this.rmbDownTimestamp;
          if (this.isAdsHeld && heldMs < 180) {
            // Short click toggles ADS on
            this.isAdsToggled = true;
          }
          this.isAdsHeld = false;
        }
      }
    };

    const resetAimAndFiring = (): void => {
      this.isRightClickHeld = false;
      this.isFiringHeld = false;
      this.isAdsHeld = false;
      this.isAdsToggled = false;
      this.stopFiringBurstIfNeeded();
    };

    window.addEventListener('pointerdown', onPointerDown, { capture: true });
    window.addEventListener('pointerup', onPointerUp, { capture: true });
    window.addEventListener('pointercancel', resetAimAndFiring);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement === null) {
        resetAimAndFiring();
      }
    });

    window.addEventListener('contextmenu', (e: MouseEvent) => {
      e.preventDefault();
    });

    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys)) {
        this.keys[k] = false;
      }
      resetAimAndFiring();
    });
  }

  public handleMouseMove(
    movementX: number,
    movementY: number,
    arcCamera: ArcRotateCamera | null
  ): void {
    if (this.isDead) return;
    if (this.characterType === 'Merc') {
      const sens =
        MOUSE_SENSITIVITY +
        (ADS_MOUSE_SENSITIVITY - MOUSE_SENSITIVITY) * this.adsBlend;
      this.rotationY += movementX * sens;
      this.pitchX = clamp(
        this.pitchX + movementY * sens,
        -Math.PI / 2.15,
        Math.PI / 2.15
      );
      this.lookDeltaX += movementX;
      this.lookDeltaY += movementY;
    } else if (arcCamera) {
      arcCamera.alpha -= movementX * MOUSE_SENSITIVITY;
      const lowerBeta = arcCamera.lowerBetaLimit ?? 0.25;
      const upperBeta = arcCamera.upperBetaLimit ?? Math.PI / 2 - 0.08;
      arcCamera.beta = clamp(
        arcCamera.beta - movementY * MOUSE_SENSITIVITY,
        lowerBeta,
        upperBeta
      );
    }
  }

  public setSpawnPosition(
    x: number,
    y: number,
    z: number,
    rotationY = 0
  ): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rotationY = rotationY;
    this.targetRotationY = rotationY;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotationY;

    if (this.fpCamera) {
      this.fpCamera.position.set(x, y + this.currentEyeOffset, z);
      this.fpCamera.rotation.set(this.pitchX, this.rotationY, 0);
    }
  }

  public consumeJumpEvent(): boolean {
    const jumped = this.jumpedThisFrame;
    this.jumpedThisFrame = false;
    return jumped;
  }

  public consumePendingShots(): NetworkShotEvent[] {
    if (this.pendingShots.length === 0) return [];
    return this.pendingShots.splice(0, this.pendingShots.length);
  }

  /**
   * Fires a single round from the currently loaded magazine:
   * - Deducts 1 round and updates the HUD
   * - Triggers a single-frame randomized muzzle flash at the barrel tip
   * - Spawns a high-velocity yellow bullet cylinder along the aim ray
   * - Applies procedural viewmodel recoil snap and camera climb/shake
   * - Queues a lightweight network shoot event for remote replication
   */
  private fireSingleRound(): void {
    if (!this.fpCamera) return;

    this.currentMagazineRounds = Math.max(0, this.currentMagazineRounds - 1);
    this.burstShotsFired++;
    this.updateAmmoHud();

    // Ensure camera and viewmodel world matrices are current before sampling muzzle
    this.fpCamera.computeWorldMatrix();
    const muzzleNode = this.visual.muzzleNode;
    let muzzleOrigin: Vector3;
    if (muzzleNode) {
      muzzleNode.computeWorldMatrix(true);
      muzzleOrigin = muzzleNode.getAbsolutePosition().clone();
    } else {
      muzzleOrigin = this.fpCamera.position.clone();
    }

    // Compute camera center aim ray so bullets converge cleanly on the target point
    const camPos = this.fpCamera.position;
    const totalPitch = this.pitchX + this.camRecoilPitch;
    const totalYaw = this.rotationY + this.camRecoilYaw;
    const cosP = Math.cos(totalPitch);
    const aimDir = new Vector3(
      Math.sin(totalYaw) * cosP,
      -Math.sin(totalPitch),
      Math.cos(totalYaw) * cosP
    ).normalize();

    const aimRay = new RAPIER.Ray(
      { x: camPos.x, y: camPos.y, z: camPos.z },
      { x: aimDir.x, y: aimDir.y, z: aimDir.z }
    );
    const hit = this.world.castRay(
      aimRay,
      150.0,
      true,
      undefined,
      undefined,
      undefined,
      this.body
    );

    const targetDist = hit !== null && hit.timeOfImpact > 1.2 ? hit.timeOfImpact : 120.0;
    const targetPoint = new Vector3(
      camPos.x + aimDir.x * targetDist,
      camPos.y + aimDir.y * targetDist,
      camPos.z + aimDir.z * targetDist
    );

    const bulletDir = targetPoint.subtract(muzzleOrigin).normalize();

    // 1. Single-frame randomized muzzle flash at barrel tip
    this.combatEffects.triggerSingleFrameMuzzleFlash(
      this.visual.muzzleFlashMesh
    );

    // 2. Spawn fast yellow bullet projectile from barrel tip
    this.combatEffects.spawnBullet(muzzleOrigin, bulletDir, this.body);

    // 3. Queue network shoot replication packet
    this.pendingShots.push({
      originX: muzzleOrigin.x,
      originY: muzzleOrigin.y,
      originZ: muzzleOrigin.z,
      dirX: bulletDir.x,
      dirY: bulletDir.y,
      dirZ: bulletDir.z,
    });

    // 4. Procedural Recoil (Viewmodel Snap + Camera Climb & Jitter)
    const adsFactor = this.adsBlend;
    const isAds = adsFactor > 0.5;

    // Push viewmodel backward toward camera & kick muzzle upward
    const kickBackZ = isAds ? 0.015 : 0.024;
    const kickUpPitch = isAds ? 0.016 : 0.036;
    const randHoriz = (Math.random() - 0.5) * (isAds ? 0.0025 : 0.009);

    this.recoilPosZ = Math.max(this.recoilPosZ - kickBackZ, -0.055);
    this.recoilVelZ -= isAds ? 0.18 : 0.32;
    this.recoilPosY = Math.min(
      this.recoilPosY + (isAds ? 0.002 : 0.005),
      0.014
    );
    this.recoilPosX = clamp(this.recoilPosX + randHoriz, -0.016, 0.016);

    // In Babylon camera space, negative X rotation pitches the muzzle upward
    this.recoilPitchX = Math.max(this.recoilPitchX - kickUpPitch, -0.13);
    this.recoilPitchVelX -= isAds ? 0.35 : 0.75;
    this.recoilYawY = clamp(this.recoilYawY + randHoriz * 1.4, -0.035, 0.035);

    // Subtle camera climb (upward pitch) and minor horizontal shake
    const camPitchClimb = isAds ? 0.007 : 0.011;
    const camYawJitter = (Math.random() - 0.5) * (isAds ? 0.0045 : 0.0085);
    this.pitchX = clamp(
      this.pitchX - camPitchClimb * 0.45,
      -Math.PI / 2.15,
      Math.PI / 2.15
    );
    this.camRecoilPitch = Math.max(
      this.camRecoilPitch - camPitchClimb * 0.55,
      -0.065
    );
    this.camRecoilYaw = clamp(this.camRecoilYaw + camYawJitter, -0.03, 0.03);

    // If magazine just ran empty after a sustained burst, emit barrel smoke
    if (this.currentMagazineRounds === 0) {
      this.stopFiringBurstIfNeeded();
    }
  }

  public update(arcCamera: ArcRotateCamera | null, dtSeconds = 1 / 60): void {
    if (this.isDead) return;
    if (this.characterType === 'Merc') {
      this.updateMercFirstPerson(dtSeconds);
    } else {
      this.updateSpieThirdPerson(arcCamera, dtSeconds);
    }
  }

  private updateMercFirstPerson(dtSeconds: number): void {
    // 1. Forward and right vectors relative to first-person yaw (rotationY)
    const sinY = Math.sin(this.rotationY);
    const cosY = Math.cos(this.rotationY);
    this.forwardScratch.set(sinY, 0, cosY);
    this.rightScratch.set(cosY, 0, -sinY);

    // 2. Accumulate WASD movement input
    this.moveDirScratch.set(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.moveDirScratch.addInPlace(this.forwardScratch);
    }
    if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      this.moveDirScratch.subtractInPlace(this.forwardScratch);
    }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      this.moveDirScratch.addInPlace(this.rightScratch);
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      this.moveDirScratch.subtractInPlace(this.rightScratch);
    }

    this.currentAnim = this.visual.getCurrentAnimation();
    const canAimOrFire =
      this.currentAnim !== 'Reload' &&
      this.currentAnim !== 'Draw' &&
      this.currentAnim !== 'Hide' &&
      this.currentAnim !== 'Hidden';

    const wantsAds = canAimOrFire && (this.isAdsHeld || this.isAdsToggled);
    const isCrouching = Boolean(
      this.keys['ControlLeft'] || this.keys['ControlRight'] || this.keys['KeyC']
    );
    const isSprinting =
      !isCrouching &&
      !wantsAds &&
      Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']);

    const moveSpeed = isCrouching
      ? CROUCH_SPEED
      : wantsAds
        ? ADS_WALK_SPEED
        : isSprinting
          ? RUN_SPEED
          : WALK_SPEED;
    const isMovingHorizontally = this.moveDirScratch.lengthSquared() > 0.0001;

    const currentVel = this.body.linvel();
    let vx = 0;
    let vz = 0;

    if (isMovingHorizontally) {
      this.moveDirScratch.normalize();
      vx = this.moveDirScratch.x * moveSpeed;
      vz = this.moveDirScratch.z * moveSpeed;
    }

    this.body.setLinvel({ x: vx, y: currentVel.y, z: vz }, true);

    // 3. Spacebar Jump & Landing detection (disabled when crouched or in the air)
    let grounded = isPlayerGrounded(this.world, this.body);
    if (this.jumpRequested) {
      if (grounded && !isCrouching) {
        this.body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
        this.jumpedThisFrame = true;
        grounded = false;
        this.jumpLagY = -0.016;
        this.jumpPitchX = 0.022;
      }
      this.jumpRequested = false;
    }

    if (!this.wasGrounded && grounded) {
      this.landSpringVelY = -0.18;
    }
    this.wasGrounded = grounded;

    // Safety respawn if player falls off the map
    const pos = this.body.translation();
    if (pos.y < -15) {
      this.setSpawnPosition(0, 3, 0, this.rotationY);
      return;
    }

    // Sync collision root
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.rotation.y = this.rotationY;

    // 4. Procedural ADS transition (~150ms), Camera FOV zoom, and Crosshair fade
    const targetAds = wantsAds ? 1.0 : 0.0;
    const adsStep = dtSeconds / ADS_TRANSITION_DURATION;
    if (this.adsBlend < targetAds) {
      this.adsBlend = Math.min(targetAds, this.adsBlend + adsStep);
    } else if (this.adsBlend > targetAds) {
      this.adsBlend = Math.max(targetAds, this.adsBlend - adsStep);
    }

    setCrosshairOpacity(1.0 - this.adsBlend);

    // 5. Procedural Crouching & Camera Recoil Spring Recovery
    const targetCrouch = isCrouching ? 1.0 : 0.0;
    this.crouchBlend +=
      (targetCrouch - this.crouchBlend) * Math.min(1.0, dtSeconds * 10.0);
    this.currentEyeOffset =
      STANDING_EYE_OFFSET +
      (CROUCH_EYE_OFFSET - STANDING_EYE_OFFSET) * this.crouchBlend;

    const camRecoilRecovery = Math.min(1.0, dtSeconds * 14.0);
    this.camRecoilPitch += (0 - this.camRecoilPitch) * camRecoilRecovery;
    this.camRecoilYaw += (0 - this.camRecoilYaw) * camRecoilRecovery;

    if (this.fpCamera) {
      this.fpCamera.fov =
        HIP_FOV_RAD + (ADS_FOV_RAD - HIP_FOV_RAD) * this.adsBlend;
      this.fpCamera.position.set(pos.x, pos.y + this.currentEyeOffset, pos.z);
      this.fpCamera.rotation.set(
        clamp(
          this.pitchX + this.camRecoilPitch,
          -Math.PI / 2.15,
          Math.PI / 2.15
        ),
        this.rotationY + this.camRecoilYaw,
        0
      );
    }

    // 6. Automatic Firing Logic (100ms cooldown, blocked during Reload/Draw/Empty)
    this.fireCooldown = Math.max(0, this.fireCooldown - dtSeconds);
    if (
      this.isFiringHeld &&
      canAimOrFire &&
      this.currentMagazineRounds > 0 &&
      this.fireCooldown <= 0
    ) {
      this.fireSingleRound();
      this.fireCooldown = FIRE_INTERVAL_SECONDS;
    }

    // 7. Viewmodel Recoil Spring Recovery
    const recoilStiff = 180.0;
    const recoilDamp = 18.0;
    this.recoilVelZ +=
      (-recoilStiff * this.recoilPosZ - recoilDamp * this.recoilVelZ) *
      dtSeconds;
    this.recoilPosZ += this.recoilVelZ * dtSeconds;

    this.recoilPitchVelX +=
      (-recoilStiff * this.recoilPitchX - recoilDamp * this.recoilPitchVelX) *
      dtSeconds;
    this.recoilPitchX += this.recoilPitchVelX * dtSeconds;

    const recoilReturnLerp = Math.min(1.0, dtSeconds * 16.0);
    this.recoilPosX += (0 - this.recoilPosX) * recoilReturnLerp;
    this.recoilPosY += (0 - this.recoilPosY) * recoilReturnLerp;
    this.recoilYawY += (0 - this.recoilYawY) * recoilReturnLerp;

    // 8. Procedural Movement Feel + ADS + Recoil on Viewmodel Rig
    if (this.viewmodelRig) {
      const adsSteadiness = 1.0 - 0.78 * this.adsBlend;

      // (a) Footstep Bobbing while moving on the ground
      if (grounded && isMovingHorizontally) {
        const bobFreq = isCrouching ? 6.5 : isSprinting ? 13.0 : 9.5;
        const bobAmpX =
          (isCrouching ? 0.005 : isSprinting ? 0.014 : 0.009) * adsSteadiness;
        const bobAmpY =
          (isCrouching ? 0.006 : isSprinting ? 0.016 : 0.01) * adsSteadiness;
        this.bobTimer += dtSeconds * bobFreq;

        const targetBobX = Math.cos(this.bobTimer) * bobAmpX;
        const targetBobY = -Math.abs(Math.sin(this.bobTimer)) * bobAmpY;
        const targetBobRoll = Math.cos(this.bobTimer) * 0.012 * adsSteadiness;

        const bobLerp = Math.min(1.0, dtSeconds * 12.0);
        this.bobOffsetX += (targetBobX - this.bobOffsetX) * bobLerp;
        this.bobOffsetY += (targetBobY - this.bobOffsetY) * bobLerp;
        this.bobRollZ += (targetBobRoll - this.bobRollZ) * bobLerp;
      } else {
        const damp = Math.min(1.0, dtSeconds * 10.0);
        this.bobOffsetX += (0 - this.bobOffsetX) * damp;
        this.bobOffsetY += (0 - this.bobOffsetY) * damp;
        this.bobRollZ += (0 - this.bobRollZ) * damp;
      }

      // (b) Jump & Landing Reaction
      const velY = this.body.linvel().y;
      const targetAirLagY = grounded
        ? 0
        : clamp(-velY * 0.002, -0.016, 0.016) * adsSteadiness;
      const targetAirPitchX = grounded
        ? 0
        : clamp(velY * 0.0035, -0.022, 0.022) * adsSteadiness;
      this.jumpLagY +=
        (targetAirLagY - this.jumpLagY) * Math.min(1.0, dtSeconds * 12.0);
      this.jumpPitchX +=
        (targetAirPitchX - this.jumpPitchX) * Math.min(1.0, dtSeconds * 12.0);

      const springStiffness = 170.0;
      const springDamping = 16.0;
      const springAccel =
        -springStiffness * this.landSpringPosY -
        springDamping * this.landSpringVelY;
      this.landSpringVelY += springAccel * dtSeconds;
      this.landSpringPosY += this.landSpringVelY * dtSeconds;

      // (c) Snappy Look Sway
      const targetSwayX =
        clamp(-this.lookDeltaX * 0.00028, -0.01, 0.01) * adsSteadiness;
      const targetSwayY =
        clamp(this.lookDeltaY * 0.00028, -0.01, 0.01) * adsSteadiness;
      const targetSwayRotY =
        clamp(-this.lookDeltaX * 0.00055, -0.018, 0.018) * adsSteadiness;
      const targetSwayRotX =
        clamp(-this.lookDeltaY * 0.00055, -0.018, 0.018) * adsSteadiness;

      const swayLerp = Math.min(1.0, dtSeconds * 18.0);
      this.swayPosX += (targetSwayX - this.swayPosX) * swayLerp;
      this.swayPosY += (targetSwayY - this.swayPosY) * swayLerp;
      this.swayRotX += (targetSwayRotX - this.swayRotX) * swayLerp;
      this.swayRotY += (targetSwayRotY - this.swayRotY) * swayLerp;

      const deltaDecay = Math.min(1.0, dtSeconds * 28.0);
      this.lookDeltaX *= 1.0 - deltaDecay;
      this.lookDeltaY *= 1.0 - deltaDecay;

      // (d) Crouch & Low-Ready ('H' key) offsets (suppressed while aiming down sights)
      const isLowReady =
        this.currentAnim === 'Hide' || this.currentAnim === 'Hidden';
      const targetLowReady = isLowReady ? 1.0 : 0.0;
      this.lowReadyBlend +=
        (targetLowReady - this.lowReadyBlend) * Math.min(1.0, dtSeconds * 9.0);

      const hipFactor = 1.0 - this.adsBlend;
      const crouchOffsetX = -0.01 * this.crouchBlend * hipFactor;
      const crouchOffsetY = -0.022 * this.crouchBlend * hipFactor;
      const crouchRollZ = -0.035 * this.crouchBlend * hipFactor;

      const lowReadyOffsetX = -0.012 * this.lowReadyBlend;
      const lowReadyOffsetY = -0.032 * this.lowReadyBlend;
      const lowReadyPitchX = 0.08 * this.lowReadyBlend;
      const lowReadyYawY = -0.08 * this.lowReadyBlend;
      const lowReadyRollZ = -0.06 * this.lowReadyBlend;

      // (e) Procedural ADS iron-sight centering shift
      const adsPosX = ADS_OFFSET_X * this.adsBlend;
      const adsPosY = ADS_OFFSET_Y * this.adsBlend;
      const adsPosZ = ADS_OFFSET_Z * this.adsBlend;

      this.viewmodelRig.position.set(
        adsPosX +
          this.bobOffsetX +
          this.swayPosX +
          crouchOffsetX +
          lowReadyOffsetX +
          this.recoilPosX,
        adsPosY +
          this.bobOffsetY +
          this.jumpLagY +
          this.landSpringPosY +
          this.swayPosY +
          crouchOffsetY +
          lowReadyOffsetY +
          this.recoilPosY,
        adsPosZ + this.recoilPosZ
      );

      this.viewmodelRig.rotation.set(
        this.jumpPitchX +
          this.swayRotX +
          lowReadyPitchX +
          this.recoilPitchX,
        this.swayRotY + lowReadyYawY + this.recoilYawY,
        this.bobRollZ + crouchRollZ + lowReadyRollZ
      );
    }
  }

  private toggleSpieCrouch(): void {
    if (this.isClimbing) return;
    this.isCrouchToggled = !this.isCrouchToggled;
    const isMoveKeyHeld = Boolean(
      this.keys['KeyW'] ||
        this.keys['KeyS'] ||
        this.keys['KeyA'] ||
        this.keys['KeyD'] ||
        this.keys['ArrowUp'] ||
        this.keys['ArrowDown'] ||
        this.keys['ArrowLeft'] ||
        this.keys['ArrowRight']
    );
    if (this.isCrouchToggled) {
      if (isMoveKeyHeld) {
        this.visual.playAnimation('crouched-walking');
      } else {
        this.visual.playAnimation('stand-to-crouch');
      }
    } else {
      if (isMoveKeyHeld) {
        this.visual.playAnimation('walking');
      } else {
        this.visual.playAnimation('crouch-to-stand');
      }
    }
  }

  private checkClimbableLedge(): {
    ledgeTopY: number;
    edgeX: number;
    edgeZ: number;
    facingDir: Vector3;
  } | null {
    const pos = this.body.translation();
    const feetY = pos.y - PLAYER_HALF_HEIGHT;

    // Facing direction vector of character
    const facingDir = new Vector3(
      Math.sin(this.rotationY),
      0,
      Math.cos(this.rotationY)
    );
    facingDir.normalize();

    // 1. Cast forward horizontal rays at multiple heights to find obstacle front wall
    const testHeights = [0.5, 1.0, 1.5, 2.0, 2.5];
    let closestHitDist = Number.POSITIVE_INFINITY;
    const maxForwardReach = 1.35; // Player radius 0.55m + ~0.8m arm reach

    for (const h of testHeights) {
      const rayOrigin = {
        x: pos.x,
        y: feetY + h,
        z: pos.z,
      };
      const rayDir = {
        x: facingDir.x,
        y: 0,
        z: facingDir.z,
      };
      const ray = new RAPIER.Ray(rayOrigin, rayDir);
      const hit = this.world.castRay(
        ray,
        maxForwardReach,
        true,
        undefined,
        undefined,
        undefined,
        this.body
      );
      if (hit !== null && hit.timeOfImpact < closestHitDist) {
        closestHitDist = hit.timeOfImpact;
      }
    }

    if (!Number.isFinite(closestHitDist) || closestHitDist > maxForwardReach) {
      return null;
    }

    // Ledge edge coordinates in front of player
    const edgeX = pos.x + facingDir.x * closestHitDist;
    const edgeZ = pos.z + facingDir.z * closestHitDist;

    // 2. Cast downward ray from above the max obstacle height (probe slightly past front edge)
    const probeDist = closestHitDist + 0.25;
    const probeX = pos.x + facingDir.x * probeDist;
    const probeZ = pos.z + facingDir.z * probeDist;

    const maxCheckY = feetY + 3.1;
    const downRay = new RAPIER.Ray(
      { x: probeX, y: maxCheckY, z: probeZ },
      { x: 0, y: -1, z: 0 }
    );
    const downHit = this.world.castRay(
      downRay,
      2.7,
      true,
      undefined,
      undefined,
      undefined,
      this.body
    );

    if (downHit === null) {
      return null;
    }

    const ledgeTopY = maxCheckY - downHit.timeOfImpact;
    const climbHeight = ledgeTopY - feetY;

    // Hang-to-crouch triggers exclusively for obstacles from waist height (~1.0m)
    // up to 1.7x body size (~2.95m). For objects lower than waist height (e.g. curbs,
    // low boxes < 1.0m), standard jump animation and impulse play instead.
    const WAIST_HEIGHT = 1.0;
    const MAX_CLIMB_HEIGHT = 2.95;
    if (climbHeight < WAIST_HEIGHT || climbHeight > MAX_CLIMB_HEIGHT) {
      return null;
    }

    // 3. Headroom clearance check: ensure no ceiling directly above the landing spot
    const upRay = new RAPIER.Ray(
      { x: probeX, y: ledgeTopY + 0.1, z: probeZ },
      { x: 0, y: 1, z: 0 }
    );
    const upHit = this.world.castRay(
      upRay,
      1.6,
      true,
      undefined,
      undefined,
      undefined,
      this.body
    );
    if (upHit !== null) {
      return null;
    }

    return {
      ledgeTopY,
      edgeX,
      edgeZ,
      facingDir,
    };
  }

  private startLedgeClimb(ledge: {
    ledgeTopY: number;
    edgeX: number;
    edgeZ: number;
    facingDir: Vector3;
  }): void {
    this.isClimbing = true;
    this.climbElapsed = 0;
    this.climbDuration = 1.15;

    // Compute hang start position:
    // With offset 0.525m below ledgeTopY and 0.51m back from edge, the palms and fingers
    // rest flush on top of the obstacle surface rather than floating slightly above it.
    const hangStartX = ledge.edgeX - ledge.facingDir.x * 0.51;
    const hangStartY = ledge.ledgeTopY - 0.525;
    const hangStartZ = ledge.edgeZ - ledge.facingDir.z * 0.51;
    this.climbStartPos.set(hangStartX, hangStartY, hangStartZ);

    // Compute final landing position on top of the ledge
    const targetX = ledge.edgeX + ledge.facingDir.x * 0.45;
    const targetY = ledge.ledgeTopY + PLAYER_HALF_HEIGHT;
    const targetZ = ledge.edgeZ + ledge.facingDir.z * 0.45;
    this.climbTargetPos.set(targetX, targetY, targetZ);

    // Orient character directly towards the wall
    this.rotationY = Math.atan2(ledge.facingDir.x, ledge.facingDir.z);
    this.targetRotationY = this.rotationY;

    // Place body at hang start
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setTranslation(
      { x: hangStartX, y: hangStartY, z: hangStartZ },
      true
    );

    this.visual.playAnimation('hang-to-crouch');
  }

  private updateSpieThirdPerson(
    camera: ArcRotateCamera | null,
    dtSeconds: number
  ): void {
    const alpha = camera ? camera.alpha : -Math.PI / 2;
    this.forwardScratch.set(-Math.cos(alpha), 0, -Math.sin(alpha));
    this.forwardScratch.normalize();

    Vector3.CrossToRef(
      Vector3.UpReadOnly,
      this.forwardScratch,
      this.rightScratch
    );
    this.rightScratch.normalize();

    // 1. Dynamic Ledge Climb Update
    if (this.isClimbing) {
      this.climbElapsed += dtSeconds;
      const p = Math.min(1.0, this.climbElapsed / this.climbDuration);

      let curX = this.climbStartPos.x;
      let curY = this.climbStartPos.y;
      let curZ = this.climbStartPos.z;

      // During first 50% of climb (frames 0-35), root stays at hangStart while hands stay planted and body pulls up.
      // During second 50% (frames 35-68), root smoothly glides to platform top target.
      if (p > 0.5) {
        const t = (p - 0.5) / 0.5;
        const s = t * t * (3 - 2 * t);
        curX =
          this.climbStartPos.x +
          (this.climbTargetPos.x - this.climbStartPos.x) * s;
        curY =
          this.climbStartPos.y +
          (this.climbTargetPos.y - this.climbStartPos.y) * s;
        curZ =
          this.climbStartPos.z +
          (this.climbTargetPos.z - this.climbStartPos.z) * s;
      }

      this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
      this.body.setTranslation({ x: curX, y: curY, z: curZ }, true);

      this.mesh.position.set(curX, curY, curZ);
      this.mesh.rotation.y = this.rotationY;

      this.visual.updateAnimation?.(dtSeconds, {
        isMoving: false,
        isStrafing: false,
        moveDir: this.moveDirScratch,
        camForward: this.forwardScratch,
        camRight: this.rightScratch,
        camAlpha: alpha,
        rotationY: this.rotationY,
        isCrouched: true,
        isClimbing: true,
        isGrounded: false,
      });

      this.currentAnim = this.visual.getCurrentAnimation();

      if (p >= 1.0) {
        this.isClimbing = false;
        this.isCrouchToggled = true;
        this.body.setTranslation(
          {
            x: this.climbTargetPos.x,
            y: this.climbTargetPos.y,
            z: this.climbTargetPos.z,
          },
          true
        );
        this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        this.visual.playAnimation('crouch-idle');
      }
      return;
    }

    // 2. Normal Locomotion Input
    this.moveDirScratch.set(0, 0, 0);
    if (this.keys['KeyW'] || this.keys['ArrowUp']) {
      this.moveDirScratch.addInPlace(this.forwardScratch);
    }
    if (this.keys['KeyS'] || this.keys['ArrowDown']) {
      this.moveDirScratch.subtractInPlace(this.forwardScratch);
    }
    if (this.keys['KeyD'] || this.keys['ArrowRight']) {
      this.moveDirScratch.addInPlace(this.rightScratch);
    }
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) {
      this.moveDirScratch.subtractInPlace(this.rightScratch);
    }

    const isCrouched = this.isCrouchToggled;
    const isSprinting =
      !isCrouched &&
      Boolean(this.keys['ShiftLeft'] || this.keys['ShiftRight']);
    const moveSpeed = isCrouched
      ? CROUCH_SPEED
      : isSprinting
        ? RUN_SPEED
        : WALK_SPEED;
    const isMovingHorizontally = this.moveDirScratch.lengthSquared() > 0.0001;

    const currentVel = this.body.linvel();
    let vx = 0;
    let vz = 0;

    if (isMovingHorizontally) {
      this.moveDirScratch.normalize();
      vx = this.moveDirScratch.x * moveSpeed;
      vz = this.moveDirScratch.z * moveSpeed;
    }

    this.body.setLinvel({ x: vx, y: currentVel.y, z: vz }, true);

    let grounded = isPlayerGrounded(this.world, this.body);
    if (this.jumpRequested) {
      this.jumpRequested = false;
      // Disable jumping when the player is crouched or in the air:
      // Must be on the ground and standing (cannot jump or mantle while in mid-air or crouched)
      if (grounded && !isCrouched) {
        const ledge = this.checkClimbableLedge();
        if (ledge) {
          this.startLedgeClimb(ledge);
          return;
        } else {
          this.body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
          this.jumpedThisFrame = true;
          grounded = false;
          this.visual.playAnimation('jump');
        }
      }
    }

    // Character rotation & heading
    const camAngle = Math.atan2(this.forwardScratch.x, this.forwardScratch.z);
    if (this.isRightClickHeld) {
      // In strafing mode (holding RMB): character locks facing towards camera look direction
      this.targetRotationY = camAngle;
      this.rotationY = lerpAngleY(
        this.rotationY,
        this.targetRotationY,
        dtSeconds * 20.0
      );
    } else if (isMovingHorizontally) {
      // In normal movement: character faces movement direction (which follows camera facing)
      this.targetRotationY = Math.atan2(
        this.moveDirScratch.x,
        this.moveDirScratch.z
      );
      this.rotationY = lerpAngleY(
        this.rotationY,
        this.targetRotationY,
        dtSeconds * TURN_SMOOTH_SPEED
      );
    }
    // When stationary: do not follow camera when orbiting; preserve character orientation

    // Update animations via the weighted blend state machine
    this.visual.updateAnimation?.(dtSeconds, {
      isMoving: isMovingHorizontally,
      isStrafing: this.isRightClickHeld,
      moveDir: this.moveDirScratch,
      camForward: this.forwardScratch,
      camRight: this.rightScratch,
      camAlpha: alpha,
      rotationY: this.rotationY,
      isCrouched: this.isCrouchToggled,
      isClimbing: false,
      isGrounded: grounded,
    });

    this.currentAnim = this.visual.getCurrentAnimation();

    const pos = this.body.translation();
    if (pos.y < -15) {
      this.setSpawnPosition(0, 3, 0, 0);
      return;
    }

    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.rotation.y = this.rotationY;
  }
}
