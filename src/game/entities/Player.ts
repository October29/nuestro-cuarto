import Phaser from 'phaser';

import { PLAYER_SPEED, ROOM_HEIGHT, ROOM_WIDTH } from '../config';
import { InteractionActor } from '../objects/InteractionActor';

export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export class Player extends Phaser.GameObjects.Container implements InteractionActor {
  private readonly standingHalfWidth = 14;
  private readonly standingHalfHeight = 26;
  private readonly sittingHalfWidth = 18;
  private readonly sittingHalfHeight = 18;

  private speed: number;
  private sitting = false;

  constructor(scene: Phaser.Scene, x: number, y: number, speed: number = PLAYER_SPEED) {
    super(scene, x, y);

    this.speed = speed;

    this.buildStandingBody();

    scene.add.existing(this);
  }

  update(delta: number, input: PlayerInput): void {
    const hasMovement = input.up || input.down || input.left || input.right;

    if (this.sitting) {
      if (hasMovement) {
        this.setSitting(false);
      } else {
        return;
      }
    }

    let vx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let vy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

    if (vx !== 0 && vy !== 0) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }

    const step = (this.speed * delta) / 1000;

    this.x += vx * step;
    this.y += vy * step;

    this.clampInsideRoom();
  }

  setSitting(sitting: boolean): void {
    if (this.sitting === sitting) return;
    this.sitting = sitting;

    this.removeAll(true);

    if (sitting) {
      this.buildSittingBody();
    } else {
      this.buildStandingBody();
    }

    this.clampInsideRoom();
  }

  isSitting(): boolean {
    return this.sitting;
  }

  private clampInsideRoom(): void {
    const hw = this.sitting ? this.sittingHalfWidth : this.standingHalfWidth;
    const hh = this.sitting ? this.sittingHalfHeight : this.standingHalfHeight;
    this.x = Phaser.Math.Clamp(this.x, hw, ROOM_WIDTH - hw);
    this.y = Phaser.Math.Clamp(this.y, hh, ROOM_HEIGHT - hh);
  }

  private buildStandingBody(): void {
    const head = this.scene.add.circle(0, -14, 11, 0xffd9b3);
    const body = this.scene.add.rectangle(0, 4, 26, 34, 0xe8a87c);

    body.setStrokeStyle(2, 0x9a6a4a);

    this.add([head, body]);
  }

  private buildSittingBody(): void {
    const head = this.scene.add.circle(0, -6, 11, 0xffd9b3);
    const body = this.scene.add.rectangle(0, 10, 28, 22, 0xe8a87c);

    body.setStrokeStyle(2, 0x9a6a4a);

    this.add([head, body]);
  }
}
