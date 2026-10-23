import { Scene } from '@babylonjs/core/scene';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import {
  RAPIER,
  PLAYER_RADIUS,
  PLAYER_HEIGHT,
  createPlayerCylinderBody,
  isPlayerGrounded,
} from './physics';

const MOVE_SPEED = 8.0;
const JUMP_IMPULSE = 6.2;

/**
 * Helper to create a low-poly, GPU-friendly cylinder mesh with a front-facing
 * visor so player orientation is clearly visible.
 */
export function createCylinderVisual(
  name: string,
  scene: Scene,
  color: Color3
): Mesh {
  const cylinder = MeshBuilder.CreateCylinder(
    name,
    {
      height: PLAYER_HEIGHT,
      diameter: PLAYER_RADIUS * 2,
      tessellation: 16, // Low-spec friendly tessellation
    },
    scene
  );

  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.diffuseColor = color;
  mat.specularColor = Color3.Black(); // Disable specular calculations for iGPU speed
  mat.freeze();
  cylinder.material = mat;

  // Lightweight front visor mesh parented to the cylinder (+Z local forward)
  const visor = MeshBuilder.CreateBox(
    `${name}_visor`,
    {
      width: PLAYER_RADIUS * 1.1,
      height: 0.22,
      depth: 0.2,
    },
    scene
  );
  visor.position.set(0, PLAYER_HEIGHT * 0.22, PLAYER_RADIUS * 0.85);
  visor.parent = cylinder;

  const visorMat = new StandardMaterial(`${name}_visor_mat`, scene);
  visorMat.diffuseColor = new Color3(0.95, 0.97, 1.0);
  visorMat.specularColor = Color3.Black();
  visorMat.freeze();
  visor.material = visorMat;

  return cylinder;
}

/**
 * Local player controller tying Babylon.js visual cylinder, Rapier3D dynamic
 * rigid body, and camera-relative WASD + Spacebar input together.
 */
export class LocalPlayer {
  public readonly mesh: Mesh;
  public readonly body: RAPIER.RigidBody;
  public rotationY = 0;

  private readonly world: RAPIER.World;
  private readonly keys: Record<string, boolean> = {};
  private jumpRequested = false;
  private jumpedThisFrame = false;

  // Pre-allocated scratch vectors to avoid GC pauses in the render loop
  private readonly forwardScratch = new Vector3();
  private readonly rightScratch = new Vector3();
  private readonly moveDirScratch = new Vector3();

  constructor(scene: Scene, world: RAPIER.World) {
    this.world = world;
    this.mesh = createCylinderVisual(
      'local_player',
      scene,
      new Color3(0.23, 0.51, 0.96)
    );
    this.body = createPlayerCylinderBody(world, 0, 2.0, 0);

    this.initInput();
  }

  private initInput(): void {
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this.keys[e.code] = true;
      if (e.code === 'Space' && !e.repeat) {
        this.jumpRequested = true;
      }
    });

    window.addEventListener('keyup', (e: KeyboardEvent) => {
      this.keys[e.code] = false;
    });

    window.addEventListener('blur', () => {
      for (const k of Object.keys(this.keys)) {
        this.keys[k] = false;
      }
    });
  }

  public setSpawnPosition(x: number, y: number, z: number, rotationY = 0): void {
    this.body.setTranslation({ x, y, z }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.rotationY = rotationY;
    this.mesh.position.set(x, y, z);
    this.mesh.rotation.y = rotationY;
  }

  public consumeJumpEvent(): boolean {
    const jumped = this.jumpedThisFrame;
    this.jumpedThisFrame = false;
    return jumped;
  }

  /**
   * Updates linear velocity from WASD relative to the ArcRotateCamera,
   * applies vertical impulse on Spacebar when grounded, and syncs the mesh.
   */
  public update(camera: ArcRotateCamera): void {
    // 1. Compute camera-relative XZ forward and right vectors directly from camera.alpha.
    // In Babylon's ArcRotateCamera, the camera is positioned at (radius*cos(alpha)*sin(beta), y, radius*sin(alpha)*sin(beta))
    // relative to its target, so the horizontal unit vector from camera toward the target is (-cos(alpha), 0, -sin(alpha)).
    this.forwardScratch.set(-Math.cos(camera.alpha), 0, -Math.sin(camera.alpha));
    this.forwardScratch.normalize();

    // In Babylon's left-handed coordinate system, Up (0,1,0) x Forward gives Right
    Vector3.CrossToRef(
      Vector3.UpReadOnly,
      this.forwardScratch,
      this.rightScratch
    );
    this.rightScratch.normalize();

    // 2. Accumulate WASD movement vector
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

    const currentVel = this.body.linvel();
    let vx = 0;
    let vz = 0;

    if (this.moveDirScratch.lengthSquared() > 0.0001) {
      this.moveDirScratch.normalize();
      vx = this.moveDirScratch.x * MOVE_SPEED;
      vz = this.moveDirScratch.z * MOVE_SPEED;
      this.rotationY = Math.atan2(this.moveDirScratch.x, this.moveDirScratch.z);
    }

    this.body.setLinvel({ x: vx, y: currentVel.y, z: vz }, true);

    // 3. Spacebar Jump (verify ground contact before applying vertical impulse)
    if (this.jumpRequested) {
      if (isPlayerGrounded(this.world, this.body)) {
        this.body.applyImpulse({ x: 0, y: JUMP_IMPULSE, z: 0 }, true);
        this.jumpedThisFrame = true;
      }
      this.jumpRequested = false;
    }

    // Safety respawn if player falls off the map
    const pos = this.body.translation();
    if (pos.y < -15) {
      this.setSpawnPosition(0, 3, 0, 0);
      return;
    }

    // 4. Sync Babylon mesh transform from Rapier body
    this.mesh.position.set(pos.x, pos.y, pos.z);
    this.mesh.rotation.y = this.rotationY;
  }
}
