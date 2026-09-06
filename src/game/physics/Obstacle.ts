import Phaser from 'phaser';

/**
 * Contrato de un área bloqueante del mundo: una zona que el Player no puede
 * atravesar. Representa el espacio físico de un objeto, separado de su dibujo
 * y de su área de interacción.
 */
export interface Obstacle {
  getCollisionRect(): Phaser.Geom.Rectangle;
}