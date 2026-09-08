import Phaser from 'phaser';

import { ROOM_HEIGHT, ROOM_WIDTH } from '../config';
import { Player, PlayerInput } from '../entities/Player';
import { Sofa } from '../objects/Sofa';
import { CollisionSystem } from '../physics/CollisionSystem';
import { InteractionSystem } from '../systems/InteractionSystem';
import { PlayerSync } from '../network/PlayerSync';
import { isEditableFocused } from '../../ui/domFocus';

import type { NetworkSession } from '../../network/NetworkSession';
import type { PeerMessage, RoomState } from '../../network/protocol';

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
  private activeSession: NetworkSession | null = null;
  private roomState: RoomState | null = null;

  private roomWidth = ROOM_WIDTH;
  private roomHeight = ROOM_HEIGHT;
  private roomContainer: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('room');
  }

  create(): void {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as WasdKeys;

    this.input.keyboard!.clearCaptures();

    if (this.roomState) {
      this.roomWidth = this.roomState.width;
      this.roomHeight = this.roomState.height;
    }

    const collisionSystem = new CollisionSystem();

    this.rebuildGeometry();

    this.player = new Player(this, this.roomWidth / 2, this.roomHeight - 110, collisionSystem);
    this.player.setDepth(1);

    const sofa = new Sofa(this, this.roomWidth / 2, this.roomHeight - 230);
    collisionSystem.addObstacle(sofa);

    this.interactionSystem = new InteractionSystem(this, this.player, Phaser);
    this.interactionSystem.addInteractable(sofa);

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.interactionSystem.tryInteractFromPointer(pointer)) return;

      const world = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.player.moveToPoint(world.x, world.y);
    });

    this.cameras.main.setBounds(0, 0, this.roomWidth, this.roomHeight);
    this.cameras.main.startFollow(this.player, true, 0.1, 0.1);

    if (this.pendingSession) {
      this.startSync(this.pendingSession);
      this.pendingSession = null;
    }
  }

  private rebuildGeometry(): void {
    this.roomContainer?.destroy();

    this.roomContainer = this.add.container(0, 0);

    const floorY = 420;

    this.roomContainer.add(
      this.add.rectangle(0, 0, this.roomWidth, floorY, 0x182238).setOrigin(0, 0),
    );
    this.roomContainer.add(
      this.add.rectangle(0, floorY, this.roomWidth, this.roomHeight - floorY, 0x3c292c).setOrigin(0, 0),
    );

    this.roomContainer.add(this.buildWindow(120, 80));

    this.roomContainer.add(
      this.add.ellipse(this.roomWidth / 2, this.roomHeight - 60, 640, 190, 0x714c4c),
    );

    this.roomContainer.add(
      this.add
        .text(this.roomWidth / 2, this.roomHeight - 26, 'Nuestro cuartito 🌙', {
          fontSize: '22px',
          color: '#d8deff',
        })
        .setOrigin(0.5),
    );
  }

  private buildWindow(x: number, y: number): Phaser.GameObjects.GameObject[] {
    const windowWidth = 210;
    const windowHeight = 170;

    const top = y - windowHeight / 2;
    const bottom = y + windowHeight / 2;

    return [
      this.add.rectangle(x, y, windowWidth, windowHeight, 0x10182d).setStrokeStyle(12, 0x674d4d),
      this.add.text(x, top + 20, '🌙', { fontSize: '46px' }).setOrigin(0.5, 0),
      this.add
        .text(x, bottom - 26, '✦  ·  ✧  ·  ✦', {
          fontSize: '16px',
          color: '#ffe9d6',
        })
        .setOrigin(0.5),
    ];
  }

  update(_time: number, delta: number): void {
    const input = this.getPlayerInput();

    this.interactionSystem.update();
    this.player.update(delta, input, this.interactionSystem.getSeatedExitPoint());
    this.playerSync?.update();
  }

  /** Vincula o desvincula la sesión activa de la red (null al salir/perderla). */
  setNetworkSession(session: NetworkSession | null): void {
    const prevId = (this.activeSession as { diagId?: number } | null)?.diagId ?? null;
    const nextId = (session as { diagId?: number } | null)?.diagId ?? null;
    console.log(
      `[M07A-DIAG] [${new Date().toISOString()}] [RoomScene setNetworkSession]`,
      JSON.stringify({ prevSession: prevId, nextSession: nextId, sameSession: prevId === nextId && nextId !== null }),
    );

    if (session) {
      if (session === this.activeSession) return;
      this.activeSession = session;
    } else {
      this.activeSession = null;
      this.roomState = null;
    }

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

  /** Recibe y conserva el RoomState del servidor. RoomScene NO es dueña del estado. */
  setRoomState(state: RoomState): void {
    this.roomState = state;

    if (this.roomWidth !== state.width || this.roomHeight !== state.height) {
      this.roomWidth = state.width;
      this.roomHeight = state.height;
      if (this.scene.isActive()) {
        this.rebuildGeometry();
        this.cameras.main.setBounds(0, 0, this.roomWidth, this.roomHeight);
      }
    }
  }

  /** Devuelve el último RoomState recibido (null si no se ha conectado). */
  getRoomState(): RoomState | null {
    return this.roomState;
  }

  private startSync(session: NetworkSession): void {
    console.log(
      `[M07A-DIAG] [${new Date().toISOString()}] [RoomScene startSync]`,
      JSON.stringify({ session: session.diagId }),
    );
    this.playerSync = new PlayerSync(this, session, this.player);
    this.playerSync.start();
  }

  private getPlayerInput(): PlayerInput {
    if (isEditableFocused()) {
      return { up: false, down: false, left: false, right: false };
    }

    const { up, down, left, right } = this.cursors;

    return {
      up: up.isDown || this.wasd.W.isDown,
      down: down.isDown || this.wasd.S.isDown,
      left: left.isDown || this.wasd.A.isDown,
      right: right.isDown || this.wasd.D.isDown,
    };
  }
}
