import Phaser from 'phaser';

export interface Interactable {
  getGameObject(): Phaser.GameObjects.GameObject;
  getPosition(): { x: number; y: number };
  getActionLabel(): string;
  onInteract(player: Phaser.GameObjects.Container): void;
}
