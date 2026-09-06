import Phaser from 'phaser';

export class RoomScene extends Phaser.Scene {
  constructor() {
    super('room');
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    const floorY = 400;

    this.add.rectangle(0, 0, width, floorY, 0x182238).setOrigin(0, 0);
    this.add.rectangle(0, floorY, width, height - floorY, 0x3c292c).setOrigin(0, 0);

    this.windowAt(120, 90);
    this.add.ellipse(width / 2, height - 70, 620, 180, 0x714c4c);

    this.add
      .text(width / 2, height - 24, 'Nuestro cuartito 🌙', {
        fontSize: '22px',
        color: '#d8deff',
      })
      .setOrigin(0.5);
  }

  private windowAt(x: number, y: number): void {
    const windowWidth = 210;
    const windowHeight = 170;

    this.add.rectangle(x, y, windowWidth, windowHeight, 0x10182d).setStrokeStyle(12, 0x674d4d);

    const top = y - windowHeight / 2;
    const bottom = y + windowHeight / 2;

    this.add.text(x, top + 20, '🌙', { fontSize: '46px' }).setOrigin(0.5, 0);

    this.add
      .text(x, bottom - 26, '✦  ·  ✧  ·  ✦', {
        fontSize: '16px',
        color: '#ffe9d6',
      })
      .setOrigin(0.5);
  }
}