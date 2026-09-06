import { ROOM_HEIGHT, ROOM_WIDTH } from '../config';
import { Obstacle } from './Obstacle';

export interface MoveResult {
  x: number;
  y: number;
  appliedX: number;
  appliedY: number;
}

/**
 * Resolución local de colisiones contra rectángulos bloqueantes (AABB).
 *
 * No es un motor de físicas ni hace pathfinding: solo decide, para un paso de
 * movimiento dado, qué componente (X e Y) se puede aplicar sin superponerse a
 * un obstáculo, y aplica un deslizamiento local por el borde cuando procede.
 */
export class CollisionSystem {
  private obstacles: Phaser.Geom.Rectangle[] = [];

  addObstacle(obstacle: Obstacle): void {
    this.obstacles.push(obstacle.getCollisionRect());
  }

  /** ¿El rectángulo centrado en (cx, cy) choca con algún obstáculo? */
  isBlocked(cx: number, cy: number, halfWidth: number, halfHeight: number): boolean {
    const left = cx - halfWidth;
    const right = cx + halfWidth;
    const top = cy - halfHeight;
    const bottom = cy + halfHeight;

    for (const ob of this.obstacles) {
      if (left < ob.right && right > ob.left && top < ob.bottom && bottom > ob.top) {
        return true;
      }
    }
    return false;
  }

  /**
   * Resuelve un paso de movimiento (dx, dy).
   *
   * 1. Intenta aplicar X; si choca, la descarta.
   * 2. Intenta aplicar Y; si choca, la descarta.
   *
   * De este modo un movimiento diagonal conserva la componente libre y se
   * desliza por el borde (colisión parcial). Nada de esto busca rutas.
   *
   * Con `slideOnBlock` (movimiento por teclado), cuando la dirección principal
   * queda bloqueada sin componente lateral, se intenta un desplazamiento
   * lateral determinista por el borde: hacia +X si la primaria es vertical,
   * hacia +Y si la primaria es horizontal. No hay búsqueda ni aleatoriedad.
   */
  resolveStep(
    x: number,
    y: number,
    dx: number,
    dy: number,
    halfWidth: number,
    halfHeight: number,
    slideOnBlock: boolean,
  ): MoveResult {
    let nx = x;
    let ny = y;
    let appliedX = 0;
    let appliedY = 0;

    if (dx !== 0 && !this.isBlocked(x + dx, y, halfWidth, halfHeight)) {
      nx = x + dx;
      appliedX = dx;
    }

    if (dy !== 0 && !this.isBlocked(nx, y + dy, halfWidth, halfHeight)) {
      ny = y + dy;
      appliedY = dy;
    }

    if (slideOnBlock) {
      const slideStep = Math.max(Math.abs(dx), Math.abs(dy));
      if (appliedX === 0 && dx !== 0 && dy === 0) {
        if (!this.isBlocked(nx, ny + slideStep, halfWidth, halfHeight)) {
          ny += slideStep;
          appliedY = slideStep;
        }
      } else if (appliedY === 0 && dy !== 0 && dx === 0) {
        if (!this.isBlocked(nx + slideStep, ny, halfWidth, halfHeight)) {
          nx += slideStep;
          appliedX = slideStep;
        }
      }
    }

    return { x: nx, y: ny, appliedX, appliedY };
  }

  /**
   * Busca una posición libre cerca de (x, y) moviéndose en línea recta hacia
   * (fromX, fromY). Se usa al levantarse para que el punto de salida nunca
   * coloque al Player dentro de un obstáculo (validación del exitPoint).
   *
   * Es un número fijo de pasos en una única dirección (O(1), determinista);
   * NO es una búsqueda de caminos ni exploración de alternativas.
   */
  findSafePosition(
    x: number,
    y: number,
    fromX: number,
    fromY: number,
    halfWidth: number,
    halfHeight: number,
  ): { x: number; y: number } {
    if (this.isFree(x, y, halfWidth, halfHeight)) {
      return { x, y };
    }

    const steps = 8;
    const dx = fromX - x;
    const dy = fromY - y;

    for (let i = 1; i <= steps; i += 1) {
      const t = i / steps;
      const cx = x + dx * t;
      const cy = y + dy * t;
      if (this.isFree(cx, cy, halfWidth, halfHeight)) {
        return { x: cx, y: cy };
      }
    }

    // La posición de origen era ocupable (el Player ya estaba ahí): devolverla.
    return { x: fromX, y: fromY };
  }

  private isFree(cx: number, cy: number, halfWidth: number, halfHeight: number): boolean {
    const insideRoom =
      cx >= halfWidth && cx <= ROOM_WIDTH - halfWidth && cy >= halfHeight && cy <= ROOM_HEIGHT - halfHeight;
    return insideRoom && !this.isBlocked(cx, cy, halfWidth, halfHeight);
  }
}