import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import * as colyseusPkg from 'colyseus';
import type { Server as ServerType } from 'colyseus';
import { GameRoom } from './GameRoom';

const { Server } = ((colyseusPkg as unknown as { default?: typeof colyseusPkg }).default ??
  colyseusPkg) as { Server: typeof ServerType };

const PORT = Number(process.env.PORT) || 2567;
const HOST = '0.0.0.0';

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', engine: 'colyseus' });
});

const httpServer = createServer(app);

const gameServer = new Server({
  server: httpServer,
});

// Expose the authoritative binary-synced game room
gameServer.define('game_room', GameRoom);

gameServer.listen(PORT, HOST).then(() => {
  console.log(`Colyseus server listening on ws://${HOST}:${PORT}`);
});
