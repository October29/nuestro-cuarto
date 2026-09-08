import Phaser from 'phaser';

import { SOFA_BLOCK_HALF_HEIGHT, SOFA_BLOCK_HALF_WIDTH, SOFA_EXIT_GAP } from '../config';
import { Obstacle } from '../physics/Obstacle';
import { InteractionActor } from './InteractionActor';
import { Interactable } from './Interactable';

export class Sofa implements Interactable, Obstacle {
  private container: Phaser.GameObjects.Container;
  private collisionRect: Phaser.Geom.Rectangle;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const width = 120;
    const height = 50;

    const back = scene.add.rectangle(0, -24, width, 28, 0x5c3a1e);
    const seat = scene.add.rectangle(0, 0, width, height, 0x7a4a2a);
    const leftArm = scene.add.rectangle(-width / 2 + 8, -4, 16, height + 8, 0x6b3f20);
    const rightArm = scene.add.rectangle(width / 2 - 8, -4, 16, height + 8, 0x6b3f20);

    this.container = scene.add.container(x, y, [back, seat, leftArm, rightArm]);
    this.container.setSize(width, height);

    this.collisionRect = new Phaser.Geom.Rectangle(
      x - SOFA_BLOCK_HALF_WIDTH,
      y - SOFA_BLOCK_HALF_HEIGHT,
      SOFA_BLOCK_HALF_WIDTH * 2,
      SOFA_BLOCK_HALF_HEIGHT * 2,
    );
  }

  getGameObject(): Phaser.GameObjects.Container {
    return this.container;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y };
  }

  /** Actualiza la posición del sofá. Usado al recibir room:updated del servidor. */
  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
    this.collisionRect.setPosition(
      x - SOFA_BLOCK_HALF_WIDTH,
      y - SOFA_BLOCK_HALF_HEIGHT,
    );
  }

  getCollisionRect(): Phaser.Geom.Rectangle {
    return this.collisionRect;
  }

  getActionLabel(): string {
    return 'Sentarse';
  }

  getExitPoint(): { x: number; y: number } {
    return {
      x: this.container.x,
      y: this.container.y + SOFA_BLOCK_HALF_HEIGHT + SOFA_EXIT_GAP,
    };
  }

  onInteract(actor: InteractionActor): void {
    actor.setSitting(true);
  }
}
