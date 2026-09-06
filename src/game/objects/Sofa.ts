import Phaser from 'phaser';

import { InteractionActor } from './InteractionActor';
import { Interactable } from './Interactable';

export class Sofa implements Interactable {
  private container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const width = 120;
    const height = 50;

    const back = scene.add.rectangle(0, -24, width, 28, 0x5c3a1e);
    const seat = scene.add.rectangle(0, 0, width, height, 0x7a4a2a);
    const leftArm = scene.add.rectangle(-width / 2 + 8, -4, 16, height + 8, 0x6b3f20);
    const rightArm = scene.add.rectangle(width / 2 - 8, -4, 16, height + 8, 0x6b3f20);

    this.container = scene.add.container(x, y, [back, seat, leftArm, rightArm]);
    this.container.setSize(width, height);
  }

  getGameObject(): Phaser.GameObjects.Container {
    return this.container;
  }

  getPosition(): { x: number; y: number } {
    return { x: this.container.x, y: this.container.y };
  }

  getActionLabel(): string {
    return 'Sentarse';
  }

  getExitPoint(): { x: number; y: number } {
    const gap = 30;
    return { x: this.container.x, y: this.container.y + this.container.height / 2 + gap };
  }

  onInteract(actor: InteractionActor): void {
    actor.setSitting(true);
  }
}
