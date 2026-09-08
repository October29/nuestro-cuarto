import Phaser from 'phaser';

import { TABLE_BLOCK_HALF_HEIGHT, TABLE_BLOCK_HALF_WIDTH, TABLE_EXIT_GAP } from '../config';
import { Obstacle } from '../physics/Obstacle';
import { InteractionActor } from './InteractionActor';
import { Interactable } from './Interactable';

export class Table implements Interactable, Obstacle {
  private container: Phaser.GameObjects.Container;
  private collisionRect: Phaser.Geom.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const width = 100;
    const height = 70;

    const top = scene.add.rectangle(0, 0, width, 12, 0x6b4a2a);
    const leg1 = scene.add.rectangle(-width / 2 + 8, height / 2 - 6, 16, height, 0x5c3a1e);
    const leg2 = scene.add.rectangle(width / 2 - 8, height / 2 - 6, 16, height, 0x5c3a1e);
    const leg3 = scene.add.rectangle(-width / 2 + 8, -height / 2 + 6, 16, height, 0x5c3a1e);
    const leg4 = scene.add.rectangle(width / 2 - 8, -height / 2 + 6, 16, height, 0x5c3a1e);

    this.container = scene.add.container(x, y, [top, leg1, leg2, leg3, leg4]);
    this.container.setSize(width, height);

    this.collisionRect = new Phaser.Geom.Rectangle(
      x - TABLE_BLOCK_HALF_WIDTH,
      y - TABLE_BLOCK_HALF_HEIGHT,
      TABLE_BLOCK_HALF_WIDTH * 2,
      TABLE_BLOCK_HALF_HEIGHT * 2,
    );
  }

  getGameObject(): Phaser.GameObjects.Container {
    return this.container;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y };
  }

  /** Actualiza la posición de la mesa. Usado al recibir room:updated del servidor. */
  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
    this.collisionRect.setPosition(
      x - TABLE_BLOCK_HALF_WIDTH,
      y - TABLE_BLOCK_HALF_HEIGHT,
    );
  }

  getCollisionRect(): Phaser.Geom.Rectangle {
    return this.collisionRect;
  }

  getActionLabel(): string {
    return 'Usar';
  }

  getExitPoint(): { x: number; y: number } {
    return {
      x: this.container.x,
      y: this.container.y + TABLE_BLOCK_HALF_HEIGHT + TABLE_EXIT_GAP,
    };
  }

  onInteract(_actor: InteractionActor): void {
    // Por ahora no hace nada especial, solo marca la interacción
  }
}