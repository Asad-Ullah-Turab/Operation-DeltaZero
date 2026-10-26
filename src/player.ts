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
} from './physics';
import { CombatEffectsManager } from './combat';
import { clamp, type CharacterType } from '../shared';
import {
  setCrosshairVisible,
  setAmmoHudVisible,
  setHealthHudVisible,
} from './ui';
import { normalizeAngle, lerpAngleY } from './utils/math';
import { HealthController } from './player/systems/HealthController';
import { InputController } from './player/systems/InputController';
import { ViewmodelMotion } from './player/systems/ViewmodelMotion';
import { WeaponController } from './player/systems/WeaponController';
import { ParkourController } from './player/systems/ParkourController';
import { updateMercFirstPerson } from './player/systems/MercMovement';
import {
  updateSpieThirdPerson,
  toggleSpieCrouch,
} from './player/systems/SpieMovement';
import {
  STANDING_EYE_OFFSET,
  HIP_FOV_RAD,
} from './config/weapons';

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

  private readonly inputController: InputController;

  public get pitchX(): number {
    return this.inputController.pitchX;
  }
  public set pitchX(v: number) {
    this.inputController.pitchX = v;
  }
  public get targetRotationY(): number {
    return this.inputController.targetRotationY;
  }
  public set targetRotationY(v: number) {
    this.inputController.targetRotationY = v;
  }
  public get rotationY(): number {
    return this.inputController.rotationY;
  }
  public set rotationY(v: number) {
    this.inputController.rotationY = v;
  }
  public get keys(): Record<string, boolean> {
    return this.inputController.keys;
  }
  public get jumpRequested(): boolean {
    return this.inputController.jumpRequested;
  }
  public set jumpRequested(v: boolean) {
    this.inputController.jumpRequested = v;
  }
  public get jumpedThisFrame(): boolean {
    return this.inputController.jumpedThisFrame;
  }
  public set jumpedThisFrame(v: boolean) {
    this.inputController.jumpedThisFrame = v;
  }
  public get isRightClickHeld(): boolean {
    return this.inputController.isRightClickHeld;
  }
  public set isRightClickHeld(v: boolean) {
    this.inputController.isRightClickHeld = v;
  }
  public get isFiringHeld(): boolean {
    return this.inputController.isFiringHeld;
  }
  public set isFiringHeld(v: boolean) {
    this.inputController.isFiringHeld = v;
  }
  public get isAdsHeld(): boolean {
    return this.inputController.isAdsHeld;
  }
  public set isAdsHeld(v: boolean) {
    this.inputController.isAdsHeld = v;
  }
  public get isAdsToggled(): boolean {
    return this.inputController.isAdsToggled;
  }
  public set isAdsToggled(v: boolean) {
    this.inputController.isAdsToggled = v;
  }
  public get lookDeltaX(): number {
    return this.inputController.lookDeltaX;
  }
  public set lookDeltaX(v: number) {
    this.inputController.lookDeltaX = v;
  }
  public get lookDeltaY(): number {
    return this.inputController.lookDeltaY;
  }
  public set lookDeltaY(v: number) {
    this.inputController.lookDeltaY = v;
  }

  private readonly world: RAPIER.World;
  private readonly combatEffects: CombatEffectsManager;

  // Spie third-person crouch state
  private isCrouchToggled = false;
  private readonly parkourController = new ParkourController();

  public get isClimbing(): boolean {
    return this.parkourController.isClimbing;
  }
  public set isClimbing(v: boolean) {
    this.parkourController.isClimbing = v;
  }

  private readonly weaponController = new WeaponController();
  private readonly viewmodelMotion = new ViewmodelMotion();

  public get currentMagazineRounds(): number {
    return this.weaponController.currentMagazineRounds;
  }
  public set currentMagazineRounds(v: number) {
    this.weaponController.currentMagazineRounds = v;
  }
  public get reserveMagazines(): number[] {
    return this.weaponController.reserveMagazines;
  }
  public get pendingShots(): NetworkShotEvent[] {
    return this.weaponController.pendingShots;
  }
  public get fireCooldown(): number {
    return this.weaponController.fireCooldown;
  }
  public set fireCooldown(v: number) {
    this.weaponController.fireCooldown = v;
  }
  public get burstShotsFired(): number {
    return this.weaponController.burstShotsFired;
  }
  public set burstShotsFired(v: number) {
    this.weaponController.burstShotsFired = v;
  }
  public get adsBlend(): number {
    return this.viewmodelMotion.adsBlend;
  }
  public set adsBlend(v: number) {
    this.viewmodelMotion.adsBlend = v;
  }
  public get currentEyeOffset(): number {
    return this.viewmodelMotion.currentEyeOffset;
  }
  public set currentEyeOffset(v: number) {
    this.viewmodelMotion.currentEyeOffset = v;
  }

  // First-person viewmodel rig & procedural motion state (Merc)
  private readonly viewmodelRig: TransformNode | null = null;
  private wasGrounded = true;

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

    this.inputController = new InputController({
      getCharacterType: () => this.characterType,
      getIsDead: () => this.isDead,
      getAdsBlend: () => this.adsBlend,
      onDebugDamage: () => this.takeDamage(25, 'torso'),
      onToggleCrouch: () => this.toggleSpieCrouch(),
      onReload: () => this.tryTacticalReload(),
      onHide: () => {
        this.visual.triggerHide?.();
        this.currentAnim = this.visual.getCurrentAnimation();
      },
      onStopFiringBurst: () => this.stopFiringBurstIfNeeded(),
    });
  }

  private updateAmmoHud(): void {
    this.weaponController.updateAmmoHud();
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
    this.parkourController.reset();
    this.inputController.resetKeys();
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
    this.parkourController.reset();
    this.inputController.resetKeys();
    this.inputController.resetAimAndFiring();

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
      this.weaponController.resetAmmo();
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
    const started = this.weaponController.tryTacticalReload(this.visual, () => {
      this.isAdsHeld = false;
      this.isAdsToggled = false;
      this.stopFiringBurstIfNeeded();
    });
    if (started) {
      this.currentAnim = this.visual.getCurrentAnimation();
    }
  }

  private stopFiringBurstIfNeeded(): void {
    this.weaponController.stopFiringBurstIfNeeded(
      this.combatEffects,
      this.visual.muzzleNode
    );
  }

  public handleMouseMove(
    movementX: number,
    movementY: number,
    arcCamera: ArcRotateCamera | null
  ): void {
    this.inputController.handleMouseMove(movementX, movementY, arcCamera);
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
    return this.inputController.consumeJumpEvent();
  }

  public consumePendingShots(): NetworkShotEvent[] {
    return this.weaponController.consumePendingShots();
  }

  /**
   * Fires a single round from the currently loaded magazine.
   */
  private fireSingleRound(): void {
    if (!this.fpCamera) return;
    this.weaponController.fireSingleRound({
      world: this.world,
      body: this.body,
      fpCamera: this.fpCamera,
      visual: this.visual,
      combatEffects: this.combatEffects,
      viewmodelMotion: this.viewmodelMotion,
      pitchX: this.pitchX,
      rotationY: this.rotationY,
      onAdjustPitch: (delta) => {
        this.pitchX = clamp(
          this.pitchX + delta,
          -Math.PI / 2.15,
          Math.PI / 2.15
        );
      },
    });
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
    const res = updateMercFirstPerson(
      {
        body: this.body,
        mesh: this.mesh,
        fpCamera: this.fpCamera,
        viewmodelRig: this.viewmodelRig,
        visual: this.visual,
        world: this.world,
        viewmodelMotion: this.viewmodelMotion,
        weaponController: this.weaponController,
        keys: this.keys,
        rotationY: this.rotationY,
        pitchX: this.pitchX,
        jumpRequested: this.jumpRequested,
        isFiringHeld: this.isFiringHeld,
        isAdsHeld: this.isAdsHeld,
        isAdsToggled: this.isAdsToggled,
        lookDeltaX: this.lookDeltaX,
        lookDeltaY: this.lookDeltaY,
        wasGrounded: this.wasGrounded,
        forwardScratch: this.forwardScratch,
        rightScratch: this.rightScratch,
        moveDirScratch: this.moveDirScratch,
        onSetSpawnPosition: (x, y, z, rotY) =>
          this.setSpawnPosition(x, y, z, rotY),
        onFireSingleRound: () => this.fireSingleRound(),
        onJumpConsumed: () => {
          this.jumpedThisFrame = true;
          this.jumpRequested = false;
        },
        onDecayLookDeltas: (decay) => {
          this.lookDeltaX *= 1.0 - decay;
          this.lookDeltaY *= 1.0 - decay;
        },
      },
      dtSeconds
    );
    this.wasGrounded = res.wasGrounded;
    this.currentAnim = res.currentAnim;
  }

  private toggleSpieCrouch(): void {
    toggleSpieCrouch(
      this.parkourController.isClimbing,
      this.isCrouchToggled,
      this.keys,
      this.visual,
      (isCrouched) => {
        this.isCrouchToggled = isCrouched;
      }
    );
  }

  private updateSpieThirdPerson(
    camera: ArcRotateCamera | null,
    dtSeconds: number
  ): void {
    this.currentAnim = updateSpieThirdPerson(
      {
        body: this.body,
        mesh: this.mesh,
        visual: this.visual,
        world: this.world,
        parkourController: this.parkourController,
        keys: this.keys,
        rotationY: this.rotationY,
        targetRotationY: this.targetRotationY,
        jumpRequested: this.jumpRequested,
        isRightClickHeld: this.isRightClickHeld,
        isCrouchToggled: this.isCrouchToggled,
        forwardScratch: this.forwardScratch,
        rightScratch: this.rightScratch,
        moveDirScratch: this.moveDirScratch,
        onSetSpawnPosition: (x, y, z, rotY) =>
          this.setSpawnPosition(x, y, z, rotY),
        onOrientCharacter: (rotY, targetRotY) => {
          this.rotationY = rotY;
          this.targetRotationY = targetRotY;
        },
        onJumpConsumed: () => {
          this.jumpRequested = false;
          this.jumpedThisFrame = true;
        },
        onCrouchChanged: (isCrouched) => {
          this.isCrouchToggled = isCrouched;
        },
      },
      camera,
      dtSeconds
    );
  }
}
