import { Scene } from '@babylonjs/core/scene';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import '@babylonjs/core/Meshes/Builders/planeBuilder';
import '@babylonjs/core/Meshes/Builders/sphereBuilder';
import '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import '@babylonjs/core/Meshes/Builders/boxBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { RAPIER } from './physics';

const BULLET_SPEED = 145.0;
const MAX_BULLET_DISTANCE = 160.0;

interface ActiveBullet {
  mesh: Mesh;
  pos: Vector3;
  dir: Vector3;
  distanceTraveled: number;
  ignoreBody?: RAPIER.RigidBody;
}

interface ActiveParticle {
  mesh: Mesh;
  vel: Vector3;
  gravity: number;
  age: number;
  lifetime: number;
  initialScale: number;
  endScale: number;
  initialAlpha: number;
}

interface ActiveMuzzleFlash {
  mesh: Mesh;
  framesRemaining: number;
}

/**
 * Orients a mesh whose primary length axis is local +Y (such as a Babylon
 * cylinder) so its +Y axis points along the given unit direction vector `dir`.
 */
function orientCylinderAlongDirection(mesh: Mesh, dir: Vector3): void {
  const up = dir.normalizeToNew();
  const helper =
    Math.abs(up.y) < 0.98 ? Vector3.UpReadOnly : Vector3.RightReadOnly;
  const right = Vector3.Cross(helper, up).normalize();
  const forward = Vector3.Cross(up, right).normalize();
  Vector3.RotationFromAxisToRef(right, up, forward, mesh.rotation);
}

/**
 * Creates a lightweight crossed-plane muzzle flash mesh parented to a barrel
 * tip node (`muzzleNode`), hidden by default.
 */
export function createMuzzleFlashMesh(
  name: string,
  scene: Scene,
  muzzleNode: TransformNode,
  scale = 1.0
): Mesh {
  const flashRoot = new Mesh(name, scene);
  flashRoot.parent = muzzleNode;
  flashRoot.isPickable = false;
  flashRoot.isVisible = false;

  const mat = new StandardMaterial(`${name}_mat`, scene);
  mat.emissiveColor = new Color3(1.0, 0.82, 0.25);
  mat.diffuseColor = new Color3(1.0, 0.9, 0.4);
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.backFaceCulling = false;
  mat.alpha = 0.92;

  const planeA = MeshBuilder.CreatePlane(
    `${name}_a`,
    { width: 0.22 * scale, height: 0.22 * scale },
    scene
  );
  planeA.parent = flashRoot;
  planeA.isPickable = false;
  planeA.material = mat;
  planeA.alwaysSelectAsActiveMesh = true;

  const planeB = MeshBuilder.CreatePlane(
    `${name}_b`,
    { width: 0.18 * scale, height: 0.32 * scale },
    scene
  );
  planeB.parent = flashRoot;
  planeB.rotation.z = Math.PI / 4;
  planeB.isPickable = false;
  planeB.material = mat;
  planeB.alwaysSelectAsActiveMesh = true;

  const coreCone = MeshBuilder.CreateCylinder(
    `${name}_cone`,
    {
      height: 0.28 * scale,
      diameterTop: 0.01,
      diameterBottom: 0.12 * scale,
      tessellation: 6,
    },
    scene
  );
  coreCone.parent = flashRoot;
  coreCone.rotation.x = Math.PI / 2;
  coreCone.position.z = 0.12 * scale;
  coreCone.isPickable = false;
  coreCone.material = mat;
  coreCone.alwaysSelectAsActiveMesh = true;

  flashRoot.setEnabled(false);
  return flashRoot;
}

/**
 * Manages fast-moving yellow bullet projectiles with continuous per-segment
 * Rapier raycast collision, single-frame muzzle flashes, surface impact bursts,
 * and barrel smoke puffs.
 */
export class CombatEffectsManager {
  private readonly scene: Scene;
  private readonly world: RAPIER.World;

  private readonly bulletMat: StandardMaterial;
  private readonly sparkMat: StandardMaterial;
  private readonly dustMat: StandardMaterial;
  private readonly smokeMat: StandardMaterial;

  private readonly bullets: ActiveBullet[] = [];
  private readonly particles: ActiveParticle[] = [];
  private readonly activeFlashes: ActiveMuzzleFlash[] = [];

  constructor(scene: Scene, world: RAPIER.World) {
    this.scene = scene;
    this.world = world;

    this.bulletMat = new StandardMaterial('bulletTracerMat', scene);
    this.bulletMat.emissiveColor = new Color3(1.0, 0.94, 0.22);
    this.bulletMat.diffuseColor = new Color3(1.0, 0.94, 0.22);
    this.bulletMat.specularColor = Color3.Black();
    this.bulletMat.disableLighting = true;
    this.bulletMat.freeze();

    this.sparkMat = new StandardMaterial('impactSparkMat', scene);
    this.sparkMat.emissiveColor = new Color3(1.0, 0.78, 0.24);
    this.sparkMat.diffuseColor = new Color3(1.0, 0.78, 0.24);
    this.sparkMat.specularColor = Color3.Black();
    this.sparkMat.disableLighting = true;
    this.sparkMat.freeze();

    this.dustMat = new StandardMaterial('impactDustMat', scene);
    this.dustMat.emissiveColor = new Color3(0.68, 0.74, 0.82);
    this.dustMat.diffuseColor = new Color3(0.68, 0.74, 0.82);
    this.dustMat.specularColor = Color3.Black();
    this.dustMat.disableLighting = true;

    this.smokeMat = new StandardMaterial('barrelSmokeMat', scene);
    this.smokeMat.emissiveColor = new Color3(0.76, 0.8, 0.85);
    this.smokeMat.diffuseColor = new Color3(0.76, 0.8, 0.85);
    this.smokeMat.specularColor = Color3.Black();
    this.smokeMat.disableLighting = true;
  }

  /**
   * Shows a muzzle flash mesh for a single frame at a randomized roll angle,
   * then automatically hides it on the next frame.
   */
  public triggerSingleFrameMuzzleFlash(flashMesh: Mesh | null): void {
    if (!flashMesh) return;

    flashMesh.setEnabled(true);
    flashMesh.rotation.z = Math.random() * Math.PI * 2;
    const s = 0.85 + Math.random() * 0.35;
    flashMesh.scaling.set(s, s, s);

    const existing = this.activeFlashes.find((f) => f.mesh === flashMesh);
    if (existing) {
      existing.framesRemaining = 1;
    } else {
      this.activeFlashes.push({ mesh: flashMesh, framesRemaining: 1 });
    }
  }

  /**
   * Spawns a small, bright yellow cylinder projectile at `origin` oriented
   * along `direction` and propels it forward at high speed.
   */
  public spawnBullet(
    origin: Vector3,
    direction: Vector3,
    ignoreBody?: RAPIER.RigidBody
  ): void {
    const dir = direction.normalizeToNew();

    const bulletMesh = MeshBuilder.CreateCylinder(
      'bullet_projectile',
      {
        height: 0.52,
        diameter: 0.032,
        tessellation: 6,
      },
      this.scene
    );
    bulletMesh.isPickable = false;
    bulletMesh.material = this.bulletMat;
    bulletMesh.position.copyFrom(origin);
    orientCylinderAlongDirection(bulletMesh, dir);

    this.bullets.push({
      mesh: bulletMesh,
      pos: origin.clone(),
      dir,
      distanceTraveled: 0,
      ignoreBody,
    });
  }

  /**
   * Spawns an instantaneous burst of sparks and dust directed outward from
   * the surface impact normal.
   */
  public spawnSurfaceImpact(point: Vector3, normal: Vector3): void {
    const n = normal.normalizeToNew();

    // 1. Bright yellow-orange sparks bouncing off the surface
    const sparkCount = 6;
    for (let i = 0; i < sparkCount; i++) {
      const spark = MeshBuilder.CreateBox(
        'impact_spark',
        { size: 0.042 },
        this.scene
      );
      spark.isPickable = false;
      spark.material = this.sparkMat;
      spark.position.copyFrom(point).addInPlaceFromFloats(
        n.x * 0.02,
        n.y * 0.02,
        n.z * 0.02
      );

      const speed = 3.2 + Math.random() * 4.5;
      const spreadX = (Math.random() - 0.5) * 1.4;
      const spreadY = (Math.random() - 0.5) * 1.4;
      const spreadZ = (Math.random() - 0.5) * 1.4;
      const vel = new Vector3(
        (n.x + spreadX) * speed,
        (n.y + Math.abs(spreadY) * 0.6) * speed,
        (n.z + spreadZ) * speed
      );

      this.particles.push({
        mesh: spark,
        vel,
        gravity: -14.0,
        age: 0,
        lifetime: 0.14 + Math.random() * 0.1,
        initialScale: 1.0,
        endScale: 0.1,
        initialAlpha: 1.0,
      });
    }

    // 2. Small puff of surface dust
    const dustCount = 4;
    for (let i = 0; i < dustCount; i++) {
      const dust = MeshBuilder.CreateSphere(
        'impact_dust',
        { diameter: 0.09, segments: 4 },
        this.scene
      );
      dust.isPickable = false;
      dust.material = this.dustMat;
      dust.visibility = 0.65;
      dust.position.copyFrom(point).addInPlaceFromFloats(
        n.x * 0.03,
        n.y * 0.03,
        n.z * 0.03
      );

      const speed = 0.9 + Math.random() * 1.5;
      const vel = new Vector3(
        (n.x + (Math.random() - 0.5) * 0.9) * speed,
        (n.y + (Math.random() - 0.5) * 0.9) * speed + 0.35,
        (n.z + (Math.random() - 0.5) * 0.9) * speed
      );

      this.particles.push({
        mesh: dust,
        vel,
        gravity: 0.6,
        age: 0,
        lifetime: 0.22 + Math.random() * 0.12,
        initialScale: 0.8,
        endScale: 2.1,
        initialAlpha: 0.65,
      });
    }
  }

  /**
   * Emits a subtle puff of barrel smoke from the muzzle that gently drifts
   * upward and fades out after releasing a sustained burst.
   */
  public spawnBarrelSmoke(muzzleNode: TransformNode | null): void {
    if (!muzzleNode) return;
    muzzleNode.computeWorldMatrix(true);
    const origin = muzzleNode.getAbsolutePosition();

    const puffCount = 5;
    for (let i = 0; i < puffCount; i++) {
      const puff = MeshBuilder.CreateSphere(
        'barrel_smoke',
        { diameter: 0.045, segments: 5 },
        this.scene
      );
      puff.isPickable = false;
      puff.material = this.smokeMat;
      puff.visibility = 0.42;
      puff.position.set(
        origin.x + (Math.random() - 0.5) * 0.02,
        origin.y + (Math.random() - 0.5) * 0.02,
        origin.z + (Math.random() - 0.5) * 0.02
      );

      const vel = new Vector3(
        (Math.random() - 0.5) * 0.16,
        0.32 + Math.random() * 0.28,
        (Math.random() - 0.5) * 0.16
      );

      this.particles.push({
        mesh: puff,
        vel,
        gravity: 0.18,
        age: 0,
        lifetime: 0.65 + Math.random() * 0.35,
        initialScale: 0.7,
        endScale: 2.8,
        initialAlpha: 0.42,
      });
    }
  }

  /**
   * Steps all active muzzle flashes, high-speed bullets (with continuous
   * raycast collision), and impact/smoke particles.
   */
  public update(dtSeconds: number): void {
    // 1. Hide single-frame muzzle flashes after 1 rendered frame
    for (let i = this.activeFlashes.length - 1; i >= 0; i--) {
      const entry = this.activeFlashes[i];
      if (entry.framesRemaining <= 0) {
        entry.mesh.setEnabled(false);
        this.activeFlashes.splice(i, 1);
      } else {
        entry.framesRemaining--;
      }
    }

    // 2. Step high-velocity bullets & check segment collision via Rapier raycast
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const stepDist = BULLET_SPEED * dtSeconds;

      const ray = new RAPIER.Ray(
        { x: b.pos.x, y: b.pos.y, z: b.pos.z },
        { x: b.dir.x, y: b.dir.y, z: b.dir.z }
      );

      const hit = this.world.castRayAndGetNormal(
        ray,
        stepDist,
        true,
        undefined,
        undefined,
        undefined,
        b.ignoreBody
      );

      if (hit !== null) {
        const hitPoint = new Vector3(
          b.pos.x + b.dir.x * hit.timeOfImpact,
          b.pos.y + b.dir.y * hit.timeOfImpact,
          b.pos.z + b.dir.z * hit.timeOfImpact
        );
        const hitNormal = new Vector3(
          hit.normal.x,
          hit.normal.y,
          hit.normal.z
        );
        this.spawnSurfaceImpact(hitPoint, hitNormal);
        b.mesh.dispose();
        this.bullets.splice(i, 1);
        continue;
      }

      b.pos.addInPlaceFromFloats(
        b.dir.x * stepDist,
        b.dir.y * stepDist,
        b.dir.z * stepDist
      );
      b.mesh.position.copyFrom(b.pos);
      b.distanceTraveled += stepDist;

      if (b.distanceTraveled >= MAX_BULLET_DISTANCE) {
        b.mesh.dispose();
        this.bullets.splice(i, 1);
      }
    }

    // 3. Step impact sparks, dust, and barrel smoke particles
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.age += dtSeconds;
      if (p.age >= p.lifetime) {
        p.mesh.dispose();
        this.particles.splice(i, 1);
        continue;
      }

      const t = p.age / p.lifetime;
      p.vel.y += p.gravity * dtSeconds;
      p.mesh.position.addInPlaceFromFloats(
        p.vel.x * dtSeconds,
        p.vel.y * dtSeconds,
        p.vel.z * dtSeconds
      );

      const scale = p.initialScale + (p.endScale - p.initialScale) * t;
      p.mesh.scaling.set(scale, scale, scale);
      p.mesh.visibility = p.initialAlpha * (1.0 - t);
    }
  }
}
