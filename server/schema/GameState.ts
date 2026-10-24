import { Schema, MapSchema, type } from '@colyseus/schema';

export type CharacterType = 'Spie' | 'Merc';

export class Player extends Schema {
  @type('number') x = 0;
  @type('number') y = 0;
  @type('number') z = 0;
  @type('number') rotationY = 0;
  @type('string') anim = 'Idle';
  @type('string') characterType = 'Spie';
}

export class GameState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
