/**
 * First-person procedural viewmodel motion, sway, bobbing, recoil springs, and ADS iron-sight alignment.
 *
 * NOTE: Exceeds 300 lines (320 lines, ceiling 400) to keep procedural sway matrices, bobbing trigonometry,
 * and dual-spring recoil simulation tightly coupled in a single coherent system.
 */

import type { FreeCamera } from '@babylonjs/core/Cameras/freeCamera';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { clamp } from '../../../shared';
import { setCrosshairOpacity } from '../../ui';
import {
  STANDING_EYE_OFFSET,
  CROUCH_EYE_OFFSET,
  ADS_TRANSITION_DURATION,
  HIP_FOV_RAD,
  ADS_FOV_RAD,
  ADS_OFFSET_X,
  ADS_OFFSET_Y,
  ADS_OFFSET_Z,
} from '../../config/weapons';

export interface ViewmodelMotionParams {
  dtSeconds: number;
  wantsAds: boolean;
  isCrouching: boolean;
  isSprinting: boolean;
  isMovingHorizontally: boolean;
  grounded: boolean;
  velY: number;
  lookDeltaX: number;
  lookDeltaY: number;
  currentAnim: string;
  pos: { x: number; y: number; z: number };
  pitchX: number;
  rotationY: number;
  fpCamera: FreeCamera | null;
  viewmodelRig: TransformNode | null;
}

export class ViewmodelMotion {
  // ADS blend [0, 1]
  public adsBlend = 0;

  // Camera recoil offsets
  public camRecoilPitch = 0;
  public camRecoilYaw = 0;

  // Viewmodel recoil state
  public recoilPosX = 0;
  public recoilPosY = 0;
  public recoilPosZ = 0;
  public recoilVelZ = 0;
  public recoilPitchX = 0;
  public recoilPitchVelX = 0;
  public recoilYawY = 0;

  // Motion bobbing, lag, sway state
  public bobTimer = 0;
  public bobOffsetX = 0;
  public bobOffsetY = 0;
  public bobRollZ = 0;

  public jumpLagY = 0;
  public jumpPitchX = 0;
  public landSpringPosY = 0;
  public landSpringVelY = 0;

  public swayPosX = 0;
  public swayPosY = 0;
  public swayRotX = 0;
  public swayRotY = 0;

  public crouchBlend = 0;
  public lowReadyBlend = 0;
  public currentEyeOffset = STANDING_EYE_OFFSET;

  /**
   * Applies recoil snap to viewmodel and camera kick upon firing a round.
   */
  public applyRecoilKick(
    onAdjustPitch: (delta: number) => void
  ): void {
    const isAds = this.adsBlend > 0.5;

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

    // Negative X pitches the muzzle upward in Babylon camera space
    this.recoilPitchX = Math.max(this.recoilPitchX - kickUpPitch, -0.13);
    this.recoilPitchVelX -= isAds ? 0.35 : 0.75;
    this.recoilYawY = clamp(this.recoilYawY + randHoriz * 1.4, -0.035, 0.035);

    // Camera climb and jitter
    const camPitchClimb = isAds ? 0.007 : 0.011;
    const camYawJitter = (Math.random() - 0.5) * (isAds ? 0.0045 : 0.0085);
    onAdjustPitch(-camPitchClimb * 0.45);

    this.camRecoilPitch = Math.max(
      this.camRecoilPitch - camPitchClimb * 0.55,
      -0.065
    );
    this.camRecoilYaw = clamp(this.camRecoilYaw + camYawJitter, -0.03, 0.03);
  }

  /**
   * Updates ADS transition and updates crosshair opacity accordingly.
   */
  public updateAds(wantsAds: boolean, dtSeconds: number): void {
    const targetAds = wantsAds ? 1.0 : 0.0;
    const adsStep = dtSeconds / ADS_TRANSITION_DURATION;
    if (this.adsBlend < targetAds) {
      this.adsBlend = Math.min(targetAds, this.adsBlend + adsStep);
    } else if (this.adsBlend > targetAds) {
      this.adsBlend = Math.max(targetAds, this.adsBlend - adsStep);
    }
    setCrosshairOpacity(1.0 - this.adsBlend);
  }

  /**
   * Updates camera position, FOV, crouch offset, and spring recovery.
   */
  public updateCameraAndCrouch(
    isCrouching: boolean,
    pos: { x: number; y: number; z: number },
    pitchX: number,
    rotationY: number,
    fpCamera: FreeCamera | null,
    dtSeconds: number
  ): void {
    const targetCrouch = isCrouching ? 1.0 : 0.0;
    this.crouchBlend +=
      (targetCrouch - this.crouchBlend) * Math.min(1.0, dtSeconds * 10.0);
    this.currentEyeOffset =
      STANDING_EYE_OFFSET +
      (CROUCH_EYE_OFFSET - STANDING_EYE_OFFSET) * this.crouchBlend;

    const camRecoilRecovery = Math.min(1.0, dtSeconds * 14.0);
    this.camRecoilPitch += (0 - this.camRecoilPitch) * camRecoilRecovery;
    this.camRecoilYaw += (0 - this.camRecoilYaw) * camRecoilRecovery;

    if (fpCamera) {
      fpCamera.fov =
        HIP_FOV_RAD + (ADS_FOV_RAD - HIP_FOV_RAD) * this.adsBlend;
      fpCamera.position.set(pos.x, pos.y + this.currentEyeOffset, pos.z);
      fpCamera.rotation.set(
        clamp(
          pitchX + this.camRecoilPitch,
          -Math.PI / 2.15,
          Math.PI / 2.15
        ),
        rotationY + this.camRecoilYaw,
        0
      );
    }
  }

  /**
   * Simulates second-order recoil spring recovery for viewmodel kick.
   */
  public updateRecoilSprings(dtSeconds: number): void {
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
  }

  /**
   * Updates procedural viewmodel bobbing, sway, jump lag, and low-ready offsets.
   */
  public updateViewmodelRig(params: ViewmodelMotionParams): void {
    const {
      dtSeconds,
      isCrouching,
      isSprinting,
      isMovingHorizontally,
      grounded,
      velY,
      lookDeltaX,
      lookDeltaY,
      currentAnim,
      viewmodelRig,
    } = params;

    if (!viewmodelRig) return;

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
      clamp(-lookDeltaX * 0.00028, -0.01, 0.01) * adsSteadiness;
    const targetSwayY =
      clamp(lookDeltaY * 0.00028, -0.01, 0.01) * adsSteadiness;
    const targetSwayRotY =
      clamp(-lookDeltaX * 0.00055, -0.018, 0.018) * adsSteadiness;
    const targetSwayRotX =
      clamp(-lookDeltaY * 0.00055, -0.018, 0.018) * adsSteadiness;

    const swayLerp = Math.min(1.0, dtSeconds * 18.0);
    this.swayPosX += (targetSwayX - this.swayPosX) * swayLerp;
    this.swayPosY += (targetSwayY - this.swayPosY) * swayLerp;
    this.swayRotX += (targetSwayRotX - this.swayRotX) * swayLerp;
    this.swayRotY += (targetSwayRotY - this.swayRotY) * swayLerp;

    // (d) Crouch & Low-Ready ('H' key) offsets
    const isLowReady =
      currentAnim === 'Hide' || currentAnim === 'Hidden';
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

    viewmodelRig.position.set(
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

    viewmodelRig.rotation.set(
      this.jumpPitchX +
        this.swayRotX +
        lowReadyPitchX +
        this.recoilPitchX,
      this.swayRotY + lowReadyYawY + this.recoilYawY,
      this.bobRollZ + crouchRollZ + lowReadyRollZ
    );
  }
}
