import Phaser from 'phaser';

import { PLAYER_SPEED, ROOM_HEIGHT, ROOM_WIDTH } from '../config';

export interface PlayerInput {
  up: boolean;
  down: boolean;
  left: boolean;
  right: boolean;
}

export class Player extends Phaser.GameObjects.Container {
  private readonly halfWidth = 14;
  private readonly halfHeight = 26;

  private speed: number;

  constructor(scene: Phaser.Scene, x: number, y: number, speed: number = PLAYER_SPEED) {
    super(scene, x, y);

    this.speed = speed;

    this.buildBody();

    scene.add.existing(this);
  }

  update(delta: number, input: PlayerInput): void {
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

  private clampInsideRoom(): void {
    this.x = Phaser.Math.Clamp(this.x, this.halfWidth, ROOM_WIDTH - this.halfWidth);
    this.y = Phaser.Math.Clamp(this.y, this.halfHeight, ROOM_HEIGHT - this.halfHeight);
  }

  private buildBody(): void {
    const head = this.scene.add.circle(0, -14, 11, 0xffd9b3);
    const body = this.scene.add.rectangle(0, 4, 26, 34, 0xe8a87c);

    body.setStrokeStyle(2, 0x9a6a4a);

    this.add([head, body]);
  }
}