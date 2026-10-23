import { Engine } from '@babylonjs/core/Engines/engine';
import { Scene } from '@babylonjs/core/scene';
import '@babylonjs/core/Inputs/scene.inputManager';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { MeshBuilder } from '@babylonjs/core/Meshes/meshBuilder';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import {
  initPhysicsWorld,
  createGroundCollider,
  createStaticObstacleBox,
  generateObstacleSpecs,
  GROUND_WIDTH,
  GROUND_DEPTH,
} from './physics';
import { LocalPlayer } from './player';
import { NetworkManager } from './network';

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById('renderCanvas') as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #renderCanvas element');
  }

  const fpsElement = document.getElementById('fps-counter');

  // 1. Initialize Babylon Engine optimized for low-spec / integrated GPUs
  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: false,
    stencil: false,
    powerPreference: 'high-performance',
    antialias: true,
  });

  // 2. Create Scene with low-overhead clearing & state management
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.07, 0.09, 0.15, 1.0);
  scene.skipPointerMovePicking = true;

  // 3. Lighting
  const light = new HemisphericLight('hemiLight', new Vector3(0.3, 1, 0.2), scene);
  light.intensity = 0.95;
  light.groundColor = new Color3(0.18, 0.22, 0.3);

  // 4. Initialize Rapier3D WASM Physics World
  const world = await initPhysicsWorld();

  // 5. Build Ground Collider & Visual Plane
  createGroundCollider(world);

  const groundMesh = MeshBuilder.CreateGround(
    'ground',
    { width: GROUND_WIDTH, height: GROUND_DEPTH, subdivisions: 2 },
    scene
  );
  const groundMat = new StandardMaterial('groundMat', scene);
  groundMat.diffuseColor = new Color3(0.14, 0.19, 0.26);
  groundMat.specularColor = Color3.Black();
  groundMat.freeze();
  groundMesh.material = groundMat;
  groundMesh.freezeWorldMatrix();

  // 6. Build Static Obstacle Colliders & Visual Boxes (shared material for draw-call batching)
  const boxMat = new StandardMaterial('obstacleBoxMat', scene);
  boxMat.diffuseColor = new Color3(0.38, 0.48, 0.58);
  boxMat.specularColor = Color3.Black();
  boxMat.freeze();

  const obstacleSpecs = generateObstacleSpecs();
  obstacleSpecs.forEach((spec, index) => {
    createStaticObstacleBox(world, spec);

    const boxMesh = MeshBuilder.CreateBox(
      `obstacle_${index}`,
      {
        width: spec.width,
        height: spec.height,
        depth: spec.depth,
      },
      scene
    );
    boxMesh.position.set(spec.x, spec.y, spec.z);
    boxMesh.material = boxMat;
    boxMesh.freezeWorldMatrix();
  });

  // 7. Spawn Local Player (Babylon cylinder + Rapier dynamic body)
  const localPlayer = new LocalPlayer(scene, world);

  // 8. ArcRotateCamera targeting the local player cylinder
  const camera = new ArcRotateCamera(
    'playerCamera',
    -Math.PI / 2,
    Math.PI / 3.2,
    13,
    new Vector3(0, 2, 0),
    scene
  );
  camera.lowerBetaLimit = 0.25;
  camera.upperBetaLimit = Math.PI / 2 - 0.08;
  camera.lowerRadiusLimit = 5;
  camera.upperRadiusLimit = 28;
  camera.panningSensibility = 0; // Disable right-click camera panning so target stays on player
  camera.keysUp = [];
  camera.keysDown = [];
  camera.keysLeft = [];
  camera.keysRight = [];
  camera.attachControl(canvas, true);

  // 9. Connect to Colyseus Authoritative Server
  const network = new NetworkManager(scene, localPlayer);
  void network.connect();

  // 10. Main Render & Physics Loop
  let lastFpsUpdate = performance.now();

  engine.runRenderLoop(() => {
    const dtSeconds = Math.min(engine.getDeltaTime() / 1000, 0.1);

    // Step Rapier3D physics world
    world.step();

    // Update local player movement & sync mesh from Rapier body
    localPlayer.update(camera);

    // Keep ArcRotateCamera orbit center synced to the player cylinder
    camera.target.copyFrom(localPlayer.mesh.position);

    // Sync local state to Colyseus & interpolate remote players
    network.update(dtSeconds);

    // Update FPS counter once every 500ms to prevent DOM layout thrashing
    const now = performance.now();
    if (fpsElement && now - lastFpsUpdate >= 500) {
      fpsElement.textContent = `FPS: ${engine.getFps().toFixed(0)}`;
      lastFpsUpdate = now;
    }

    scene.render();
  });

  window.addEventListener('resize', () => {
    engine.resize();
  });
}

void bootstrap();
