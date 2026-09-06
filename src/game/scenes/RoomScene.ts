import Phaser from 'phaser';

import { ROOM_HEIGHT, ROOM_WIDTH } from '../config';
import { Player, PlayerInput } from '../entities/Player';
import { Sofa } from '../objects/Sofa';
import { CollisionSystem } from '../physics/CollisionSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { PlayerSync } from '../network/PlayerSync';

import type { NetworkSession } from '../../network/NetworkSession';
import type { PeerMessage } from '../../network/protocol';

interface WasdKeys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
}

export class RoomScene extends Phaser.Scene {
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: WasdKeys;
  private player!: Player;
  private interactionSystem!: InteractionSystem;
  private playerSync: PlayerSync | null = null;
  private pendingSession: NetworkSession | null = null;

  constructor() {
    super('room');
  }

  create(): void {
    const floorY = 420;

    this.add.rectangle(0, 0, ROOM_WIDTH, floorY, 0x182238).setOrigin(0, 0);
    this.add.rectangle(0, floorY, ROOM_WIDTH, ROOM_HEIGHT - floorY, 0x3c292c).setOrigin(0, 0);

    this.windowAt(120, 80);
    this.add.ellipse(ROOM_WIDTH / 2, ROOM_HEIGHT - 60, 640, 190, 0x714c4c);

    this.add
      .text(ROOM_WIDTH / 2, ROOM_HEIGHT - 26, 'Nuestro cuartito 🌙', {
        fontSize: '22px',
        color: '#d8deff',
      })
      .setOrigin(0.5);

    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as WasdKeys;

    const collisionSystem = new CollisionSystem();

    this.player = new Player(this, ROOM_WIDTH / 2, ROOM_HEIGHT - 110, collisionSystem);
    this.player.setDepth(1);

    const sofa = new Sofa(this, ROOM_WIDTH / 2, ROOM_HEIGHT - 230);
    collisionSystem.addObstacle(sofa);

    this.interactionSystem = new InteractionSystem(this, this.player);
    this.interactionSystem.addInteractable(sofa);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.interactionSystem.tryInteractFromPointer(pointer)) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.player.moveToPoint(world.x, world.y);
    });

    this.cameras.main.setBounds(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    if (this.pendingSession) {
      this.startSync(this.pendingSession);
      this.pendingSession = null;
    }
  }

  update(_time: number, delta: number): void {
    const input = this.getPlayerInput();

    this.interactionSystem.update();
    this.player.update(delta, input, this.interactionSystem.getSeatedExitPoint());
    this.playerSync?.update();
  }

  /** Vincula o desvincula la sesión activa de la red (null al salir/perderla). */
  setNetworkSession(session: NetworkSession | null): void {
    this.playerSync?.stop();
    this.playerSync = null;

    if (!session) return;
    if (!this.player) {
      this.pendingSession = session;
      return;
    }
    this.startSync(session);
  }

  /** Reenvía los mensajes P2P de la sesión a la sincronización visual. */
  handleNetworkMessage(message: PeerMessage): void {
    this.playerSync?.onMessage(message);
  }

  private startSync(session: NetworkSession): void {
    this.playerSync = new PlayerSync(this, session, this.player);
    this.playerSync.start();
  }

  private getPlayerInput(): PlayerInput {
    const { up, down, left, right } = this.cursors;

    return {
      up: up.isDown || this.wasd.W.isDown,
      down: down.isDown || this.wasd.S.isDown,
      left: left.isDown || this.wasd.A.isDown,
      right: right.isDown || this.wasd.D.isDown,
    };
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
