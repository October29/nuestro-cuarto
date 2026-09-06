import Phaser from 'phaser';

import { INTERACTION_RADIUS } from '../config';
import { Interactable } from '../objects/Interactable';

export class InteractionSystem {
  private player: Phaser.GameObjects.Container;
  private interactables: Interactable[] = [];
  private currentTarget: Interactable | null = null;
  private interactKey: Phaser.Input.Keyboard.Key;
  private promptText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, player: Phaser.GameObjects.Container) {
    this.player = player;
    this.interactKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.promptText = scene.add.text(0, 0, '', {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 8, y: 4 },
    });
    this.promptText.setOrigin(0.5, 1);
    this.promptText.setVisible(false);
    this.promptText.setScrollFactor(0);
    this.promptText.setPosition(400, 560);
  }

  addInteractable(interactable: Interactable): void {
    this.interactables.push(interactable);
  }

  update(_delta: number, isMoving: boolean): void {
    const playerObj = this.player as unknown as { isSitting(): boolean; setSitting(s: boolean): void };
    if (playerObj.isSitting()) {
      if (isMoving) {
        playerObj.setSitting(false);
      }
      this.clearTarget();
      return;
    }

    this.detectNearest();
    this.updatePrompt();

    if (this.currentTarget && Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.currentTarget.onInteract(this.player);
    }
  }

  private detectNearest(): void {
    const px = this.player.x;
    const py = this.player.y;
    let closest: Interactable | null = null;
    let minDist = Infinity;

    for (const obj of this.interactables) {
      const pos = obj.getPosition();
      const go = obj.getGameObject();
      const w = (go as unknown as { displayWidth: number }).displayWidth / 2;
      const h = (go as unknown as { displayHeight: number }).displayHeight / 2;

      const cx = Phaser.Math.Clamp(px, pos.x - w, pos.x + w);
      const cy = Phaser.Math.Clamp(py, pos.y - h, pos.y + h);
      const dist = Phaser.Math.Distance.Between(px, py, cx, cy);

      if (dist < INTERACTION_RADIUS && dist < minDist) {
        minDist = dist;
        closest = obj;
      }
    }

    this.currentTarget = closest;
  }

  private clearTarget(): void {
    this.currentTarget = null;
    this.promptText.setVisible(false);
  }

  private updatePrompt(): void {
    if (this.currentTarget) {
      this.promptText.setText(`[E] ${this.currentTarget.getActionLabel()}`);
      this.promptText.setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }
  }
}
