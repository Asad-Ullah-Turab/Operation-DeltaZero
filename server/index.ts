import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';
import cors from 'cors';
import os from 'os';

// --- Shared Types for Network State ---
export interface PlayerState {
  id: string;
  x: number;
  y: number;
  z: number;
  rotationY: number;
  color: number;
}

export interface PlayerMovementPayload {
  x: number;
  y: number;
  z: number;
  rotationY: number;
}

interface ServerToClientEvents {
  currentPlayers: (players: Record<string, PlayerState>) => void;
  playerJoined: (player: PlayerState) => void;
  playerMoved: (player: PlayerState) => void;
  playerDisconnected: (playerId: string) => void;
}

interface ClientToServerEvents {
  playerMovement: (movement: PlayerMovementPayload) => void;
}

const PORT = Number(process.env.PORT) || 3000;
const app = express();
app.use(cors());

// Simple health-check endpoint
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', playersOnline: players.size });
});

const httpServer = createServer(app);

// Configure Socket.IO with open CORS so LAN devices can connect directly
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
});

// In-memory store of connected players keyed by socket.id
const players = new Map<string, PlayerState>();

// Distinct palette for spawned player cylinders
const PLAYER_COLORS = [
  0x3b82f6, // Blue
  0xef4444, // Red
  0x10b981, // Emerald
  0xf59e0b, // Amber
  0x8b5cf6, // Purple
  0xec4899, // Pink
  0x06b6d4, // Cyan
  0x84cc16, // Lime
];

function getRandomColor(): number {
  const index = Math.floor(Math.random() * PLAYER_COLORS.length);
  return PLAYER_COLORS[index] ?? 0x3b82f6;
}

io.on(
  'connection',
  (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
    console.log(`[Server] Player connected: ${socket.id}`);

    // Create initial state for the newly connected player
    const spawnRadius = 3;
    const newPlayer: PlayerState = {
      id: socket.id,
      x: (Math.random() - 0.5) * spawnRadius * 2,
      y: 3, // Spawn slightly above the ground so gravity drops them in
      z: (Math.random() - 0.5) * spawnRadius * 2,
      rotationY: 0,
      color: getRandomColor(),
    };

    players.set(socket.id, newPlayer);

    // 1. Send the complete dictionary of current players to the newcomer
    const playersRecord: Record<string, PlayerState> = Object.fromEntries(players);
    socket.emit('currentPlayers', playersRecord);

    // 2. Notify all other connected clients about the new player
    socket.broadcast.emit('playerJoined', newPlayer);

    // 3. Listen for position/rotation updates from this player
    socket.on('playerMovement', (movement: PlayerMovementPayload) => {
      const player = players.get(socket.id);
      if (!player) return;

      player.x = movement.x;
      player.y = movement.y;
      player.z = movement.z;
      player.rotationY = movement.rotationY;

      // Broadcast updated transform to everyone else on the LAN
      socket.broadcast.emit('playerMoved', player);
    });

    // 4. Clean up when the player disconnects
    socket.on('disconnect', () => {
      console.log(`[Server] Player disconnected: ${socket.id}`);
      players.delete(socket.id);
      io.emit('playerDisconnected', socket.id);
    });
  }
);

// Helper to display LAN IP addresses in the terminal
function getLanAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    const netInterface = interfaces[name];
    if (!netInterface) continue;
    for (const net of netInterface) {
      if (net.family === 'IPv4' && !net.internal) {
        addresses.push(net.address);
      }
    }
  }
  return addresses;
}

// Listen on 0.0.0.0 so all LAN devices can reach the server
httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 Socket.IO Multiplayer Server running on port ${PORT}`);
  console.log(`   Local:   http://localhost:${PORT}`);
  const lanIps = getLanAddresses();
  for (const ip of lanIps) {
    console.log(`   LAN:     http://${ip}:${PORT} (Vite Client: http://${ip}:5173)`);
  }
  console.log('');
});

