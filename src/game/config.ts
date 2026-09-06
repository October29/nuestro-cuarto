import Phaser from 'phaser';

import { RoomScene } from './scenes/RoomScene';

export const ROOM_WIDTH = 1200;
export const ROOM_HEIGHT = 800;
export const PLAYER_SPEED = 260;
export const INTERACTION_RADIUS = 80;

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
