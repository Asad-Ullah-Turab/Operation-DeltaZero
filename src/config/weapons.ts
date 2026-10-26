/**
 * Weapon configuration constants, movement speeds, ADS tuning, and animation frame markers.
 */

// Movement Speeds & Physics Impulses
export const WALK_SPEED = 7.5;
export const RUN_SPEED = 11.5;
export const CROUCH_SPEED = 4.2;
export const ADS_WALK_SPEED = 4.8;
export const JUMP_IMPULSE = 6.2;
export const TURN_SMOOTH_SPEED = 14.0;
export const MOUSE_SENSITIVITY = 0.0022;
export const ADS_MOUSE_SENSITIVITY = 0.0014;

// Camera Eye Offsets
export const STANDING_EYE_OFFSET = 0.68;
export const CROUCH_EYE_OFFSET = 0.18;

// Magazine & Firing Constants (M4A1: 30 rounds/mag, 5 magazines total: 1 loaded + 4 reserve)
export const MAGAZINE_CAPACITY = 30;
export const INITIAL_RESERVE_MAGAZINES = 4;
export const FIRE_INTERVAL_SECONDS = 0.1; // 100ms between shots (600 RPM)
export const BURST_SMOKE_THRESHOLD = 3;

// Procedural ADS Constants (~150ms transition, 72 deg hip FOV -> 52 deg ADS FOV)
export const ADS_TRANSITION_DURATION = 0.15;
export const HIP_FOV_RAD = (72 * Math.PI) / 180;
export const ADS_FOV_RAD = (52 * Math.PI) / 180;
export const ADS_OFFSET_X = -0.0547;
export const ADS_OFFSET_Y = 0.0365;
export const ADS_OFFSET_Z = -0.055;

// Arm Correction Scale for fps_merc_m4a1.glb
export const ARM_VERTEX_CORRECTION_SCALE = -1.0 / 3840.0;

// Low-Ready Animation Frame Markers
export const HIDE_LOW_READY_FRAME = 10;
export const DRAW_FROM_LOW_READY_FRAME = 22;

