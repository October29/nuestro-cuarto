import type { RoomScene } from '../game/scenes/RoomScene';

/** Panel de edición de habitación: permite activar/desactivar modo edición. */
export class RoomEditPanel {
  private readonly toggleBtn: HTMLButtonElement;
  private roomScene: RoomScene | null = null;

  constructor() {
    this.toggleBtn = document.getElementById('room-edit-toggle-btn') as HTMLButtonElement;
    this.toggleBtn.addEventListener('click', () => this.toggleEditMode());
    this.hide();
  }

  /** Vincula la escena de la habitación para poder alternar el modo edición. */
  bindRoomScene(roomScene: RoomScene | null): void {
    this.roomScene = roomScene;
    if (roomScene) {
      this.show();
    } else {
      this.hide();
    }
  }

  /** Alterna el modo edición. */
  private toggleEditMode(): void {
    if (this.roomScene) {
      this.roomScene.toggleEditMode();
    }
  }

  /** Muestra el panel de edición. */
  private show(): void {
    const panel = document.getElementById('room-edit-panel');
    if (panel) panel.hidden = false;
  }

  /** Oculta el panel de edición. */
  private hide(): void {
    const panel = document.getElementById('room-edit-panel');
    if (panel) panel.hidden = true;
  }
}