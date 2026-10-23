import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { PhysicsContext } from './physics';

export const PLAYER_RADIUS = 0.6;
export const PLAYER_HEIGHT = 1.8;
const MOVE_SPEED = 9.0;
const JUMP_VELOCITY = 10.5;

/**
 * Creates a 3D cylinder mesh group with a small visor on the front (+Z local)
 * so players can see each cylinder's facing rotation.
 */
export function createCylinderMesh(color: number): THREE.Group {
  const group = new THREE.Group();

  // Main cylinder body
  const geometry = new THREE.CylinderGeometry(
    PLAYER_RADIUS,
    PLAYER_RADIUS,
    PLAYER_HEIGHT,
    24
  );
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: 0.35,
    metalness: 0.2,
  });
  const cylinder = new THREE.Mesh(geometry, material);
  cylinder.castShadow = true;
  cylinder.receiveShadow = true;
  group.add(cylinder);

  // Direction indicator visor on the front (+Z side) of the cylinder
  const visorGeo = new THREE.BoxGeometry(PLAYER_RADIUS * 1.1, 0.25, 0.25);
  const visorMat = new THREE.MeshStandardMaterial({
    color: 0xf8fafc,
    roughness: 0.2,
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.position.set(0, PLAYER_HEIGHT * 0.22, PLAYER_RADIUS * 0.85);
  visor.castShadow = true;
  group.add(visor);

  return group;
}

/**
 * Manages the local player's 3D cylinder mesh, Cannon-es physics body,
 * keyboard input (WASD + Spacebar), and camera-relative movement.
 */
export class Player {
  public readonly mesh: THREE.Group;
  public readonly body: CANNON.Body;
  public rotationY = 0;

  private readonly world: CANNON.World;
  private readonly keys: Record<string, boolean> = {};
  private jumpRequested = false;

  constructor(scene: THREE.Scene, physics: PhysicsContext, initialColor = 0x3b82f6) {
    this.world = physics.world;

    // 1. Create Three.js visual representation
    this.mesh = createCylinderMesh(initialColor);
    scene.add(this.mesh);

    // 2. Create Cannon-es physics cylinder
    const cylinderShape = new CANNON.Cylinder(
      PLAYER_RADIUS,
      PLAYER_RADIUS,
      PLAYER_HEIGHT,
      16
    );

    this.body = new CANNON.Body({
      mass: 5,
      shape: cylinderShape,
      position: new CANNON.Vec3(0, 3, 0),
      material: physics.playerMaterial,
      linearDamping: 0.01,
    });

    // Lock X/Z rotation so the cylinder stays upright like a character controller
    this.body.fixedRotation = true;
    this.body.updateMassProperties();

    this.world.addBody(this.body);

    // 3. Register keyboard listeners
    this.initInput();
  }

  private initInput(): void {
    window.addEventListener('keydown', (event: KeyboardEvent) => {
      this.keys[event.code] = true;
      if (event.code === 'Space' && !event.repeat) {
        this.jumpRequested = true;
      }
    });

    window.addEventListener('keyup', (event: KeyboardEvent) => {
      this.keys[event.code] = false;
    });

    // Clear held keys if user switches tabs/windows
    window.addEventListener('blur', () => {
      for (const key of Object.keys(this.keys)) {
        this.keys[key] = false;
      }
    });
  }

  /**
   * Updates the local player's color and initial spawn coordinates once
   * the server assigns them.
   */
  public applyServerSpawn(x: number, y: number, z: number, color: number): void {
    this.body.position.set(x, y, z);
    this.body.velocity.set(0, 0, 0);

    const mainCylinder = this.mesh.children[0];
    if (mainCylinder instanceof THREE.Mesh) {
      (mainCylinder.material as THREE.MeshStandardMaterial).color.setHex(color);
    }
  }

  /**
   * Checks if the bottom of the player cylinder is resting on the ground or a box
   * by inspecting active physics contacts with an upward-pointing normal.
   */
  private isGrounded(): boolean {
    for (const contact of this.world.contacts) {
      if (contact.bi === this.body || contact.bj === this.body) {
        // contact.ni points from bi to bj
        const normalY =
          contact.bi === this.body ? -contact.ni.y : contact.ni.y;
        if (normalY > 0.5) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Computes WASD movement relative to the camera orientation, handles jumping,
   * and synchronizes the Three.js mesh with the Cannon-es physics body.
   */
  public update(camera: THREE.Camera): void {
    // 1. Compute camera forward and right vectors projected onto the flat XZ plane
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(forward, up).normalize();

    // 2. Accumulate movement direction from WASD keys
    const moveDir = new THREE.Vector3();
    if (this.keys['KeyW'] || this.keys['ArrowUp']) moveDir.add(forward);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) moveDir.sub(forward);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.add(right);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir.sub(right);

    if (moveDir.lengthSq() > 0) {
      moveDir.normalize();
      this.body.velocity.x = moveDir.x * MOVE_SPEED;
      this.body.velocity.z = moveDir.z * MOVE_SPEED;

      // Rotate cylinder to face the direction of travel
      this.rotationY = Math.atan2(moveDir.x, moveDir.z);
    } else {
      // Stop horizontal movement cleanly when no WASD keys are pressed
      this.body.velocity.x = 0;
      this.body.velocity.z = 0;
    }

    // 3. Handle Jump (Spacebar)
    if (this.jumpRequested) {
      if (this.isGrounded()) {
        this.body.velocity.y = JUMP_VELOCITY;
      }
      this.jumpRequested = false;
    }

    // Respawn safety net if player somehow falls off the world edge
    if (this.body.position.y < -15) {
      this.body.position.set(0, 4, 0);
      this.body.velocity.set(0, 0, 0);
    }

    // 4. Sync Three.js visual mesh with Cannon-es physics body
    this.mesh.position.set(
      this.body.position.x,
      this.body.position.y,
      this.body.position.z
    );
    this.mesh.rotation.y = this.rotationY;
  }
}

