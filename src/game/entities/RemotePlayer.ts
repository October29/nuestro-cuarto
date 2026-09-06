import Phaser from 'phaser';

import { ROOM_HEIGHT, ROOM_WIDTH } from '../config';

// Suavizado visual mínimo hacia la última posición recibida. No es
// interpolación de red, ni física, ni predicción: solo un lerp por fotograma.
export const REMOTE_LERP_ALPHA = 0.25;

/**
 * Representación visual mínima de un jugador remoto.
 *
 * Solo recibe el estado que envía el peer (x, y, sitting) y lo replica. NO
 * tiene control por teclado ni click, NO ejecuta colisiones locales y NO
 * participa en la resolución de movimiento de la habitación: es un reflejo,
 * no otro Player.
 */
export class RemotePlayer extends Phaser.GameObjects.Container {
  private targetX: number;
  private targetY: number;
  private sitting = false;

  constructor(
    scene: Phaser.Scene,
    private readonly playerId: string,
    x: number,
    y: number,
  ) {
    super(scene, x, y);
    this.targetX = this.x;
    this.targetY = this.y;
    this.buildStandingBody();
    scene.add.existing(this);
  }

  get id(): string {
    return this.playerId;
  }

  isSitting(): boolean {
    return this.sitting;
  }

  /** Actualiza el destino visual del remoto desde el estado recibido del peer. */
  updateState(x: number, y: number, sitting: boolean): void {
    this.targetX = Phaser.Math.Clamp(x, 14, ROOM_WIDTH - 14);
    this.targetY = Phaser.Math.Clamp(y, 14, ROOM_HEIGHT - 14);

    if (sitting !== this.sitting) {
      this.sitting = sitting;
      this.rebuildBody();
    }
  }

  /** Acerca suavemente la posición visual hacia el último estado recibido. */
  update(): void {
    this.x += (this.targetX - this.x) * REMOTE_LERP_ALPHA;
    this.y += (this.targetY - this.y) * REMOTE_LERP_ALPHA;
  }

  private rebuildBody(): void {
    this.removeAll(true);
    if (this.sitting) {
      this.buildSittingBody();
    } else {
      this.buildStandingBody();
    }
  }

  private buildStandingBody(): void {
    const head = this.scene.add.circle(0, -14, 11, 0xcfe0f5);
    const body = this.scene.add.rectangle(0, 4, 26, 34, 0x8fb4d8);

    body.setStrokeStyle(2, 0x5d7fa6);

    this.add([head, body]);
  }

  private buildSittingBody(): void {
    const head = this.scene.add.circle(0, -6, 11, 0xcfe0f5);
    const body = this.scene.add.rectangle(0, 10, 28, 22, 0x8fb4d8);

    body.setStrokeStyle(2, 0x5d7fa6);

    this.add([head, body]);
  }
}