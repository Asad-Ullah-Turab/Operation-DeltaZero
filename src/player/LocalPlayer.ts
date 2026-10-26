/**
 * Local player coordinator composing health, input, parkour, weapons, and movement systems.
 */

import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import '@babylonjs/loaders/glTF/2.0';
import { clamp, type CharacterType } from '../../shared';
import {
  RAPIER,
  createPlayerCylinderBody,
} from '../physics';
import type { CombatEffectsManager } from '../combat';
import {
  setCrosshairVisible,
  setAmmoHudVisible,
  setHealthHudVisible,
} from '../ui';
import {
  STANDING_EYE_OFFSET,
  HIP_FOV_RAD,
} from '../config/weapons';
import type {
  CharacterAssets,
  CharacterVisual,
  NetworkShotEvent,
} from './types';
import { createMercVisual } from './visuals/merc';
import { createSpieVisual } from './visuals/spie';
import {
  HealthController,
  InputController,
  ViewmodelMotion,
  WeaponController,
  ParkourController,
  updateMercFirstPerson,
  updateSpieThirdPerson,
  toggleSpieCrouch,
} from './systems';

export class LocalPlayer {
  public characterType: CharacterType;
  public visual: CharacterVisual;
  public mesh: Mesh;
  public readonly body: RAPIER.RigidBody;
  public readonly fpCamera: FreeCamera | null = null;
  public currentAnim = 'Idle';

  private readonly scene: Scene;
  private readonly world: RAPIER.World;
  private readonly combatEffects: CombatEffectsManager;

  // Composed subsystem controllers
  private readonly healthController = new HealthController();
  private readonly inputController: InputController;
  private readonly viewmodelMotion = new ViewmodelMotion();
  private readonly weaponController = new WeaponController();
  private readonly parkourController = new ParkourController();

  // Spie crouch state & Merc first-person viewmodel rig
  private isCrouchToggled = false;
  private readonly viewmodelRig: TransformNode | null = null;
  private wasGrounded = true;

  // Scratch vectors for zero GC allocation in locomotion updates
  private readonly forwardScratch = new Vector3();
  private readonly rightScratch = new Vector3();
  private readonly moveDirScratch = new Vector3();

  // Public state accessors delegating to subsystems
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
  public get rotationY(): number {
    return this.inputController.rotationY;
  }
  public set rotationY(val: number) {
    this.inputController.rotationY = val;
  }

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
      this.mesh = new Mesh('local_merc_collision_root', scene);
      this.mesh.isVisible = false;
      this.mesh.isPickable = false;

      const fpCam = new FreeCamera(
        'mercFirstPersonCamera',
        new Vector3(0, 2.0 + STANDING_EYE_OFFSET, 0),
        scene
      );
      fpCam.minZ = 0.02;
      fpCam.fov = HIP_FOV_RAD;
      fpCam.inputs.clear();
      this.fpCamera = fpCam;

      const rig = new TransformNode('mercViewmodelRig', scene);
      rig.parent = fpCam;
      this.viewmodelRig = rig;

      this.visual = createMercVisual(
        'local_merc_viewmodel',
        scene,
        assets.mercContainer,
        true
      );
      this.visual.root.parent = rig;
      this.currentAnim = this.visual.getCurrentAnimation();

      setCrosshairVisible(true);
      setAmmoHudVisible(true);
      setHealthHudVisible(false);
      this.weaponController.updateAmmoHud();
    } else {
      this.visual = createSpieVisual(
        'local_spie_player',
        scene,
        assets.spieContainer
      );
      this.mesh = this.visual.root;
      this.currentAnim = 'Idle';

      setCrosshairVisible(false);
      setHealthHudVisible(true);
      setAmmoHudVisible(false);
      this.healthController.updateHealthHud();
    }

    this.inputController = new InputController({
      getCharacterType: () => this.characterType,
      getIsDead: () => this.isDead,
      getAdsBlend: () => this.viewmodelMotion.adsBlend,
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
      this.healthController.updateHealthHud();
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

  private tryTacticalReload(): void {
    const started = this.weaponController.tryTacticalReload(this.visual, () => {
      this.inputController.isAdsHeld = false;
      this.inputController.isAdsToggled = false;
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
    this.inputController.targetRotationY = rotationY;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotationY;

    if (this.fpCamera) {
      this.fpCamera.position.set(x, y + this.viewmodelMotion.currentEyeOffset, z);
      this.fpCamera.rotation.set(this.inputController.pitchX, this.rotationY, 0);
    }
  }

  public consumeJumpEvent(): boolean {
    return this.inputController.consumeJumpEvent();
  }

  public consumePendingShots(): NetworkShotEvent[] {
    return this.weaponController.consumePendingShots();
  }

  private fireSingleRound(): void {
    if (!this.fpCamera) return;
    this.weaponController.fireSingleRound({
      world: this.world,
      body: this.body,
      fpCamera: this.fpCamera,
      visual: this.visual,
      combatEffects: this.combatEffects,
      viewmodelMotion: this.viewmodelMotion,
      pitchX: this.inputController.pitchX,
      rotationY: this.rotationY,
      onAdjustPitch: (delta) => {
        this.inputController.pitchX = clamp(
          this.inputController.pitchX + delta,
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
        keys: this.inputController.keys,
        rotationY: this.rotationY,
        pitchX: this.inputController.pitchX,
        jumpRequested: this.inputController.jumpRequested,
        isFiringHeld: this.inputController.isFiringHeld,
        isAdsHeld: this.inputController.isAdsHeld,
        isAdsToggled: this.inputController.isAdsToggled,
        lookDeltaX: this.inputController.lookDeltaX,
        lookDeltaY: this.inputController.lookDeltaY,
        wasGrounded: this.wasGrounded,
        forwardScratch: this.forwardScratch,
        rightScratch: this.rightScratch,
        moveDirScratch: this.moveDirScratch,
        onSetSpawnPosition: (x, y, z, rotY) =>
          this.setSpawnPosition(x, y, z, rotY),
        onFireSingleRound: () => this.fireSingleRound(),
        onJumpConsumed: () => {
          this.inputController.jumpedThisFrame = true;
          this.inputController.jumpRequested = false;
        },
        onDecayLookDeltas: (decay) => {
          this.inputController.lookDeltaX *= 1.0 - decay;
          this.inputController.lookDeltaY *= 1.0 - decay;
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
      this.inputController.keys,
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
        keys: this.inputController.keys,
        rotationY: this.rotationY,
        targetRotationY: this.inputController.targetRotationY,
        jumpRequested: this.inputController.jumpRequested,
        isRightClickHeld: this.inputController.isRightClickHeld,
        isCrouchToggled: this.isCrouchToggled,
        forwardScratch: this.forwardScratch,
        rightScratch: this.rightScratch,
        moveDirScratch: this.moveDirScratch,
        onSetSpawnPosition: (x, y, z, rotY) =>
          this.setSpawnPosition(x, y, z, rotY),
        onOrientCharacter: (rotY, targetRotY) => {
          this.rotationY = rotY;
          this.inputController.targetRotationY = targetRotY;
        },
        onJumpConsumed: () => {
          this.inputController.jumpRequested = false;
          this.inputController.jumpedThisFrame = true;
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
