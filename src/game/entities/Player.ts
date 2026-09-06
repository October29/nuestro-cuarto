import Phaser from 'phaser';

import {
  PLAYER_COLLIDER_HALF_HEIGHT,
  PLAYER_COLLIDER_HALF_WIDTH,
  PLAYER_SPEED,
  ROOM_HEIGHT,
  ROOM_WIDTH,
} from '../config';
import { CollisionSystem } from '../physics/CollisionSystem';
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
  private moveToTarget: { x: number; y: number } | null = null;
  private collisionSystem: CollisionSystem;

  constructor(scene: Phaser.Scene, x: number, y: number, collisionSystem: CollisionSystem, speed: number = PLAYER_SPEED) {
    super(scene, x, y);

    this.speed = speed;
    this.collisionSystem = collisionSystem;

    this.buildStandingBody();

    scene.add.existing(this);
  }

  update(delta: number, input: PlayerInput, seatExitPoint: { x: number; y: number } | null = null): void {
    const hasMovement = input.up || input.down || input.left || input.right;

    if (this.sitting) {
      if (hasMovement) {
        if (seatExitPoint) {
          this.standUpAt(seatExitPoint.x, seatExitPoint.y);
        } else {
          this.setSitting(false);
        }
      } else {
        return;
      }
    }

    if (hasMovement) {
      this.moveToTarget = null;
      this.moveByKeyboard(delta, input);
    } else if (this.moveToTarget) {
      this.moveTowardTarget(delta);
    }

    this.clampInsideRoom();
  }

  moveToPoint(x: number, y: number): void {
    this.moveToTarget = { x, y };
  }

  private moveByKeyboard(delta: number, input: PlayerInput): void {
    let vx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let vy = (input.down ? 1 : 0) - (input.up ? 1 : 0);

    if (vx !== 0 && vy !== 0) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }

    const step = (this.speed * delta) / 1000;
    const dx = vx * step;
    const dy = vy * step;

    // Teclado: deslizamiento lateral habilitado. Si la dirección principal queda
    // bloqueada sin componente lateral, se desliza por el borde (ver CollisionSystem).
    const result = this.collisionSystem.resolveStep(
      this.x,
      this.y,
      dx,
      dy,
      PLAYER_COLLIDER_HALF_WIDTH,
      PLAYER_COLLIDER_HALF_HEIGHT,
      true,
    );
    this.x = result.x;
    this.y = result.y;
  }

  private moveTowardTarget(delta: number): void {
    if (!this.moveToTarget) return;

    const dx = this.moveToTarget.x - this.x;
    const dy = this.moveToTarget.y - this.y;
    const dist = Math.hypot(dx, dy);
    const step = (this.speed * delta) / 1000;

    // Click: se conserva la componente libre (deslizamiento por borde), pero sin
    // el desplazamiento lateral por desempate del teclado. Si un paso queda
    // completamente bloqueado, el destino se descarta: el Player se detiene en
    // la geometría local (no hay pathfinding).
    const hw = PLAYER_COLLIDER_HALF_WIDTH;
    const hh = PLAYER_COLLIDER_HALF_HEIGHT;

    if (dist <= step) {
      const result = this.collisionSystem.resolveStep(this.x, this.y, dx, dy, hw, hh, false);
      this.x = result.x;
      this.y = result.y;
      this.moveToTarget = null;
    } else {
      const dirX = dx / dist;
      const dirY = dy / dist;
      const result = this.collisionSystem.resolveStep(this.x, this.y, dirX * step, dirY * step, hw, hh, false);
      this.x = result.x;
      this.y = result.y;

      if (result.appliedX === 0 && result.appliedY === 0) {
        this.moveToTarget = null;
      }
    }
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

  standUpAt(x: number, y: number): void {
    const safe = this.collisionSystem.findSafePosition(
      x,
      y,
      this.x,
      this.y,
      PLAYER_COLLIDER_HALF_WIDTH,
      PLAYER_COLLIDER_HALF_HEIGHT,
    );
    this.x = safe.x;
    this.y = safe.y;
    this.setSitting(false);
    this.moveToTarget = null;
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
