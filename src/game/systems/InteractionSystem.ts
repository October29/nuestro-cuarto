import type Phaser from 'phaser';

import { isEditableFocused } from '../../ui/domFocus';

import type { Player } from '../entities/Player';
import type { Interactable } from '../objects/Interactable';

// Radio de interacción. Vive aquí (y no en game/config.ts, que importa Phaser)
// para que este módulo siga siendo importable en los tests de Node.
const INTERACTION_RADIUS = 80;

/**
 * API mínima de Phaser que InteractionSystem necesita. RoomScene la satisface
 * pasando el namespace `Phaser`; en los tests de Node se inyecta un sustituto
 * (phaser no se puede importar en Node: accede a `window` al evaluarse).
 */
export interface InteractionPhaserApi {
  Input: {
    Keyboard: {
      KeyCodes: { E: number };
      JustDown(key: Phaser.Input.Keyboard.Key): boolean;
    };
  };
  Geom: {
    Rectangle: {
      Contains(rect: Phaser.Geom.Rectangle, x: number, y: number): boolean;
    };
  };
  Math: {
    Clamp(value: number, min: number, max: number): number;
    Distance: { Between(x1: number, y1: number, x2: number, y2: number): number };
  };
}

export class InteractionSystem {
  private player: Player;
  private interactables: Interactable[] = [];
  private currentTarget: Interactable | null = null;
  private seatedInteractable: Interactable | null = null;
  private interactKey: Phaser.Input.Keyboard.Key;
  private promptText: Phaser.GameObjects.Text;
  private readonly phaser: InteractionPhaserApi;

  constructor(scene: Phaser.Scene, player: Player, phaser: InteractionPhaserApi) {
    this.phaser = phaser;
    this.player = player;

    // Se registra E sin captura del navegador (false): Phaser no debe llamar
    // preventDefault sobre E y bloquear la escritura en inputs del DOM.
    this.interactKey = scene.input.keyboard!.addKey(
      this.phaser.Input.Keyboard.KeyCodes.E,
      false,
    );

    this.promptText = scene.add.text(0, 0, '', {
      fontSize: '16px',
      color: '#ffffff',
      backgroundColor: '#00000088',
      padding: { x: 8, y: 4 },
    });
    this.promptText.setOrigin(0.5, 1);
    this.promptText.setVisible(false);
    this.promptText.setScrollFactor(0);
    this.promptText.setDepth(10);
    this.promptText.setPosition(400, 560);
  }

  addInteractable(interactable: Interactable): void {
    this.interactables.push(interactable);
  }

  /** Elimina un interactable del sistema. */
  removeInteractable(interactable: Interactable): void {
    const index = this.interactables.indexOf(interactable);
    if (index !== -1) {
      this.interactables.splice(index, 1);
    }
    // Si era el target actual, limpiarlo
    if (this.currentTarget === interactable) {
      this.currentTarget = null;
    }
    // Si era el sentado, limpiarlo
    if (this.seatedInteractable === interactable) {
      this.seatedInteractable = null;
    }
  }

  /** Punto de salida del interactuable sobre el que el Player está sentado, si existe. */
  getSeatedExitPoint(): { x: number; y: number } | null {
    return this.seatedInteractable ? this.seatedInteractable.getExitPoint() : null;
  }

  update(): void {
    this.detectNearest();
    this.updatePrompt();

    // Mientras un campo editable tiene el foco, el teclado del gameplay está
    // inactivo: E no debe ejecutar interacciones.
    if (
      !isEditableFocused() &&
      this.phaser.Input.Keyboard.JustDown(this.interactKey)
    ) {
      this.performInteract();
    }
  }

  /** Returns true if the click landed on the (visible) prompt and the interaction was performed. */
  tryInteractFromPointer(pointer: Phaser.Input.Pointer): boolean {
    if (!this.promptText.visible) return false;

    const bounds = this.promptText.getBounds();
    if (this.phaser.Geom.Rectangle.Contains(bounds, pointer.x, pointer.y)) {
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

      const cx = this.phaser.Math.Clamp(px, pos.x - w, pos.x + w);
      const cy = this.phaser.Math.Clamp(py, pos.y - h, pos.y + h);
      const dist = this.phaser.Math.Distance.Between(px, py, cx, cy);

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