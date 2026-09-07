import Phaser from 'phaser';

import { RoomScene } from './scenes/RoomScene';

export const ROOM_WIDTH = 1200;
export const ROOM_HEIGHT = 800;
export const PLAYER_SPEED = 260;

// Collider del Player: espacio físico que ocupa en el suelo, más pequeño que
// el dibujo visual para que la navegación se sienta natural. El centro del
// collider coincide con la posición (x, y) del Player.
export const PLAYER_COLLIDER_HALF_WIDTH = 10;
export const PLAYER_COLLIDER_HALF_HEIGHT = 14;

// Espacio físico (área bloqueante) del sofá, independiente de su dibujo.
export const SOFA_BLOCK_HALF_WIDTH = 60;
export const SOFA_BLOCK_HALF_HEIGHT = 30;
// Hueco del punto de salida del sofá, medido desde el borde inferior del bloque.
export const SOFA_EXIT_GAP = 40;

// Sincronización de estado del jugador: un envío cada ~100 ms (10 Hz).
export const PLAYER_STATE_INTERVAL_MS = 100;

export const gameConfig: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#182238',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 800,
    height: 600,
  },
  scene: [RoomScene],
};
