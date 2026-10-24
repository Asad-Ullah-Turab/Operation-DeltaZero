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
import {
  LocalPlayer,
  CharacterType,
  loadCharacterAssets,
} from './player';
import { CombatEffectsManager } from './combat';
import { NetworkManager } from './network';

function waitForCharacterSelection(): Promise<CharacterType> {
  return new Promise((resolve) => {
    const menuEl = document.getElementById('character-select-menu');
    const spieBtn = document.getElementById('select-spie-btn');
    const mercBtn = document.getElementById('select-merc-btn');

    const choose = (type: CharacterType): void => {
      if (menuEl) {
        menuEl.classList.add('hidden');
      }
      resolve(type);
    };

    spieBtn?.addEventListener('click', () => choose('Spie'), { once: true });
    mercBtn?.addEventListener('click', () => choose('Merc'), { once: true });
  });
}

async function bootstrap(): Promise<void> {
  const canvas = document.getElementById(
    'renderCanvas'
  ) as HTMLCanvasElement | null;
  if (!canvas) {
    throw new Error('Missing #renderCanvas element');
  }

  const fpsElement = document.getElementById('fps-counter');
  const crosshairElement = document.getElementById('crosshair');

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
  const light = new HemisphericLight(
    'hemiLight',
    new Vector3(0.3, 1, 0.2),
    scene
  );
  light.intensity = 1.05;
  light.groundColor = new Color3(0.22, 0.26, 0.34);

  // 4. Initialize Rapier3D WASM Physics World & Preload Character GLBs in Parallel
  //    while the user views the Character Selection Menu
  const selectionPromise = waitForCharacterSelection();
  const [world, characterAssets] = await Promise.all([
    initPhysicsWorld(),
    loadCharacterAssets(scene),
  ]);

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

  // 7. Wait for player to click 'Spie' or 'Mercenary'
  const selectedCharacterType = await selectionPromise;

  // Show centered crosshair and lock mouse pointer to the game window
  crosshairElement?.classList.remove('hidden');
  canvas.focus();
  void canvas.requestPointerLock?.();

  canvas.addEventListener('click', () => {
    if (document.pointerLockElement !== canvas) {
      void canvas.requestPointerLock?.();
    }
  });

  // 8. Initialize Combat Projectiles & VFX Manager and Spawn Local Player
  const combatEffects = new CombatEffectsManager(scene, world);
  const localPlayer = new LocalPlayer(
    scene,
    world,
    characterAssets,
    selectedCharacterType,
    combatEffects
  );

  // 9. Configure Active Camera based on Character Type
  let arcCamera: ArcRotateCamera | null = null;
  if (selectedCharacterType === 'Merc' && localPlayer.fpCamera) {
    scene.activeCamera = localPlayer.fpCamera;
  } else {
    arcCamera = new ArcRotateCamera(
      'playerCamera',
      -Math.PI / 2,
      Math.PI / 3.2,
      13,
      new Vector3(0, 2, 0),
      scene
    );
    arcCamera.lowerBetaLimit = 0.25;
    arcCamera.upperBetaLimit = Math.PI / 2 - 0.08;
    arcCamera.lowerRadiusLimit = 5;
    arcCamera.upperRadiusLimit = 28;
    arcCamera.panningSensibility = 0;
    arcCamera.keysUp = [];
    arcCamera.keysDown = [];
    arcCamera.keysLeft = [];
    arcCamera.keysRight = [];
    arcCamera.attachControl(canvas, true);
    scene.activeCamera = arcCamera;
  }

  window.addEventListener('mousemove', (e: MouseEvent) => {
    if (document.pointerLockElement === canvas) {
      localPlayer.handleMouseMove(e.movementX, e.movementY, arcCamera);
    }
  });

  // 10. Connect to Colyseus Authoritative Server & announce selected character type
  const network = new NetworkManager(
    scene,
    localPlayer,
    characterAssets,
    combatEffects
  );
  void network.connect();

  // 11. Start Main Render & Physics Loop
  let lastFpsUpdate = performance.now();

  engine.runRenderLoop(() => {
    const dtSeconds = Math.min(engine.getDeltaTime() / 1000, 0.1);

    // Step Rapier3D physics world
    world.step();

    // Update local player movement, firing, ADS, recoil & viewmodel motion
    localPlayer.update(arcCamera, dtSeconds);

    // Step bullets, single-frame muzzle flashes, surface impacts & barrel smoke
    combatEffects.update(dtSeconds);

    // Keep ArcRotateCamera orbit center synced when playing as Spie
    if (arcCamera) {
      arcCamera.target.copyFrom(localPlayer.mesh.position);
    }

    // Sync local state/shots to Colyseus & interpolate remote players
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
