import * as THREE from 'three';
import { initPhysics } from './physics';
import { Player } from './player';
import { NetworkManager } from './network';

// --- 1. Three.js Scene, Camera, and Renderer Setup ---
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0f172a);
scene.fog = new THREE.FogExp2(0x0f172a, 0.012);

const camera = new THREE.PerspectiveCamera(
  65,
  window.innerWidth / window.innerHeight,
  0.1,
  200
);

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// --- 2. Lighting ---
const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(25, 45, 25);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 120;
const shadowBounds = 50;
dirLight.shadow.camera.left = -shadowBounds;
dirLight.shadow.camera.right = shadowBounds;
dirLight.shadow.camera.top = shadowBounds;
dirLight.shadow.camera.bottom = -shadowBounds;
scene.add(dirLight);

// --- 3. Initialize Physics, Local Player, and LAN Networking ---
const physics = initPhysics(scene);
const player = new Player(scene, physics);
const network = new NetworkManager(scene, player);

// --- 4. Third-Person Orbit Camera Controls ---
let cameraYaw = 0; // Horizontal angle around the player (radians)
let cameraPitch = 0.45; // Vertical angle (radians)
const cameraDistance = 11;
let isDragging = false;
const orbitKeys: Record<string, boolean> = {};

window.addEventListener('mousedown', (e: MouseEvent) => {
  if (e.button === 0) isDragging = true;
});
window.addEventListener('mouseup', () => {
  isDragging = false;
});
window.addEventListener('mousemove', (e: MouseEvent) => {
  if (!isDragging) return;
  cameraYaw -= e.movementX * 0.006;
  cameraPitch = THREE.MathUtils.clamp(
    cameraPitch + e.movementY * 0.005,
    0.15,
    1.25
  );
});
window.addEventListener('keydown', (e: KeyboardEvent) => {
  orbitKeys[e.code] = true;
});
window.addEventListener('keyup', (e: KeyboardEvent) => {
  orbitKeys[e.code] = false;
});

function updateCamera(deltaTime: number): void {
  // Allow Q and E keys to rotate camera horizontally in addition to mouse drag
  const keyboardTurnSpeed = 1.8;
  if (orbitKeys['KeyQ']) cameraYaw += keyboardTurnSpeed * deltaTime;
  if (orbitKeys['KeyE']) cameraYaw -= keyboardTurnSpeed * deltaTime;

  const target = player.mesh.position;

  // Spherical offset from the player cylinder
  const horizontalDist = cameraDistance * Math.cos(cameraPitch);
  const verticalDist = cameraDistance * Math.sin(cameraPitch);

  const desiredX = target.x + Math.sin(cameraYaw) * horizontalDist;
  const desiredY = target.y + verticalDist;
  const desiredZ = target.z + Math.cos(cameraYaw) * horizontalDist;

  camera.position.set(desiredX, desiredY, desiredZ);
  camera.lookAt(target.x, target.y + 0.8, target.z);
}

// --- 5. Handle Window Resizing ---
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- 6. Main Game & Render Loop ---
const FIXED_TIME_STEP = 1 / 60;
const MAX_SUB_STEPS = 3;
const clock = new THREE.Clock();

function animate(): void {
  requestAnimationFrame(animate);

  // Clamp deltaTime so tab switching doesn't cause a huge physics jump
  const deltaTime = Math.min(clock.getDelta(), 0.1);

  // Step Cannon-es physics simulation
  physics.world.step(FIXED_TIME_STEP, deltaTime, MAX_SUB_STEPS);

  // Update local player movement (relative to current camera angle) & sync mesh
  player.update(camera);

  // Update third-person follow camera
  updateCamera(deltaTime);

  // Emit local transform & interpolate remote players
  network.update(deltaTime);

  // Render scene
  renderer.render(scene, camera);
}

animate();

