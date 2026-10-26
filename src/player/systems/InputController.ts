/**
 * Keyboard and pointer input capture, mouse look handling, and pointer lock binding.
 */

import type { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { clamp, type CharacterType } from '../../../shared';

export const MOUSE_SENSITIVITY = 0.0022;
export const ADS_MOUSE_SENSITIVITY = 0.0014;

export interface InputCallbacks {
  getCharacterType: () => CharacterType;
  getIsDead: () => boolean;
  getAdsBlend: () => number;
  onDebugDamage?: () => void;
  onToggleCrouch?: () => void;
  onReload?: () => void;
  onHide?: () => void;
  onStopFiringBurst?: () => void;
}

export class InputController {
  public readonly keys: Record<string, boolean> = {};
  public pitchX = 0;
  public targetRotationY = 0;
  public rotationY = 0;
  public jumpRequested = false;
  public jumpedThisFrame = false;

  public isRightClickHeld = false;
  public isFiringHeld = false;
  public isAdsHeld = false;
  public isAdsToggled = false;
  private rmbDownTimestamp = 0;

  public lookDeltaX = 0;
  public lookDeltaY = 0;

  private readonly callbacks: InputCallbacks;
  private readonly listeners: Array<{
    target: EventTarget;
    type: string;
    listener: EventListenerOrEventListenerObject;
    options?: boolean | AddEventListenerOptions;
  }> = [];

  constructor(callbacks: InputCallbacks) {
    this.callbacks = callbacks;
    this.initListeners();
  }

  private addListener(
    target: EventTarget,
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void {
    target.addEventListener(type, listener, options);
    this.listeners.push({ target, type, listener, options });
  }

  private initListeners(): void {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (this.callbacks.getIsDead()) return;
      const charType = this.callbacks.getCharacterType();

      if (e.code === 'KeyK' && charType === 'Spy') {
        this.callbacks.onDebugDamage?.();
        return;
      }

      this.keys[e.code] = true;

      if (e.code === 'Space' && !e.repeat) {
        this.jumpRequested = true;
      }

      if (e.code === 'KeyC' && !e.repeat && charType === 'Spy') {
        this.callbacks.onToggleCrouch?.();
      }

      if (charType === 'Merc' && !e.repeat) {
        if (e.code === 'KeyR') {
          this.callbacks.onReload?.();
        } else if (e.code === 'KeyH') {
          this.isAdsHeld = false;
          this.isAdsToggled = false;
          this.callbacks.onStopFiringBurst?.();
          this.callbacks.onHide?.();
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent): void => {
      this.keys[e.code] = false;
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType !== 'mouse') return;
      if (
        document.pointerLockElement === null ||
        this.callbacks.getIsDead()
      ) {
        return;
      }

      if (e.button === 2) {
        this.isRightClickHeld = true;
      }

      if (this.callbacks.getCharacterType() === 'Merc') {
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

      if (this.callbacks.getCharacterType() === 'Merc') {
        if (e.button === 0) {
          this.isFiringHeld = false;
          this.callbacks.onStopFiringBurst?.();
        } else if (e.button === 2) {
          const heldMs = performance.now() - this.rmbDownTimestamp;
          if (this.isAdsHeld && heldMs < 180) {
            this.isAdsToggled = true;
          }
          this.isAdsHeld = false;
        }
      }
    };

    const onPointerLockChange = (): void => {
      if (document.pointerLockElement === null) {
        this.resetAimAndFiring();
      }
    };

    const onContextMenu = (e: MouseEvent): void => {
      e.preventDefault();
    };

    const onBlur = (): void => {
      this.resetKeys();
      this.resetAimAndFiring();
    };

    this.addListener(window, 'keydown', onKeyDown as EventListener);
    this.addListener(window, 'keyup', onKeyUp as EventListener);
    this.addListener(
      window,
      'pointerdown',
      onPointerDown as EventListener,
      { capture: true }
    );
    this.addListener(
      window,
      'pointerup',
      onPointerUp as EventListener,
      { capture: true }
    );
    this.addListener(
      window,
      'pointercancel',
      (() => this.resetAimAndFiring()) as EventListener
    );
    this.addListener(
      document,
      'pointerlockchange',
      onPointerLockChange as EventListener
    );
    this.addListener(window, 'contextmenu', onContextMenu as EventListener);
    this.addListener(window, 'blur', onBlur as EventListener);
  }

  /**
   * Translates raw mouse movements to pitch and yaw angles or orbital camera rotation.
   */
  public handleMouseMove(
    movementX: number,
    movementY: number,
    arcCamera: ArcRotateCamera | null
  ): void {
    if (this.callbacks.getIsDead()) return;

    if (this.callbacks.getCharacterType() === 'Merc') {
      const adsBlend = this.callbacks.getAdsBlend();
      const sens =
        MOUSE_SENSITIVITY +
        (ADS_MOUSE_SENSITIVITY - MOUSE_SENSITIVITY) * adsBlend;
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

  /**
   * Resets all aim and firing hold/toggle states and triggers burst cessation.
   */
  public resetAimAndFiring(): void {
    this.isRightClickHeld = false;
    this.isFiringHeld = false;
    this.isAdsHeld = false;
    this.isAdsToggled = false;
    this.callbacks.onStopFiringBurst?.();
  }

  /**
   * Clears active key states on window blur or respawn.
   */
  public resetKeys(): void {
    for (const k of Object.keys(this.keys)) {
      this.keys[k] = false;
    }
  }

  /**
   * Retrieves and resets jump event flag.
   */
  public consumeJumpEvent(): boolean {
    const jumped = this.jumpedThisFrame;
    this.jumpedThisFrame = false;
    return jumped;
  }

  /**
   * Cleans up all registered window and document listeners.
   */
  public dispose(): void {
    for (const item of this.listeners) {
      item.target.removeEventListener(item.type, item.listener, item.options);
    }
    this.listeners.length = 0;
  }
}

