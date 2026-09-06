import Phaser from 'phaser';

import { INTERACTION_RADIUS } from '../config';
import { Player } from '../entities/Player';
import { Interactable } from '../objects/Interactable';

export class InteractionSystem {
  private player: Player;
  private interactables: Interactable[] = [];
  private currentTarget: Interactable | null = null;
  private seatedInteractable: Interactable | null = null;
  private interactKey: Phaser.Input.Keyboard.Key;
  private promptText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, player: Player) {
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

  update(): void {
    this.detectNearest();
    this.updatePrompt();

    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
      this.performInteract();
    }
  }

  /** Returns true if the click landed on the (visible) prompt and the interaction was performed. */
  tryInteractFromPointer(pointer: Phaser.Input.Pointer): boolean {
    if (!this.promptText.visible) return false;

    const bounds = this.promptText.getBounds();
    if (Phaser.Geom.Rectangle.Contains(bounds, pointer.x, pointer.y)) {
      this.performInteract();
      return true;
    }

    return false;
  }

  private performInteract(): void {
    if (this.player.isSitting()) {
      if (this.seatedInteractable) {
        const exit = this.seatedInteractable.getExitPoint();
        this.player.standUpAt(exit.x, exit.y);
      }
      return;
    }

    if (this.currentTarget) {
      this.currentTarget.onInteract(this.player);
      if (this.player.isSitting()) {
        this.seatedInteractable = this.currentTarget;
      }
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
      const w = go.displayWidth / 2;
      const h = go.displayHeight / 2;

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

  private updatePrompt(): void {
    if (this.currentTarget) {
      this.promptText.setText(`[E] ${this.currentTarget.getActionLabel()}`);
      this.promptText.setVisible(true);
    } else {
      this.promptText.setVisible(false);
    }
  }
}
