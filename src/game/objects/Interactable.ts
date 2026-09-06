import Phaser from 'phaser';

import { InteractionActor } from './InteractionActor';

export interface Interactable {
  getGameObject(): Phaser.GameObjects.Container;
  getPosition(): { x: number; y: number };
  getActionLabel(): string;
  getExitPoint(): { x: number; y: number };
  onInteract(actor: InteractionActor): void;
}
