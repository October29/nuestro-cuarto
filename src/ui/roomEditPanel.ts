import type { RoomScene } from '../game/scenes/RoomScene';
import type { NetworkSession } from '../network/NetworkSession';
import type { RoomObjectCreatePatch } from '../network/protocol';

/** Panel de edición de habitación: permite activar/desactivar modo edición y añadir muebles. */
export class RoomEditPanel {
  private readonly toggleBtn: HTMLButtonElement;
  private readonly addSofaBtn: HTMLButtonElement;
  private readonly addTableBtn: HTMLButtonElement;
  private roomScene: RoomScene | null = null;
  private activeSession: NetworkSession | null = null;

  constructor() {
    this.toggleBtn = document.getElementById('room-edit-toggle-btn') as HTMLButtonElement;
    this.addSofaBtn = document.getElementById('room-add-sofa-btn') as HTMLButtonElement;
    this.addTableBtn = document.getElementById('room-add-table-btn') as HTMLButtonElement;

    this.toggleBtn.addEventListener('click', () => this.toggleEditMode());
    this.addSofaBtn.addEventListener('click', () => this.addObject('sofa'));
    this.addTableBtn.addEventListener('click', () => this.addObject('table'));
    this.hide();
  }

  /** Vincula la escena de la habitación y la sesión para poder añadir muebles. */
  bindRoomScene(roomScene: RoomScene | null, session: NetworkSession | null): void {
    this.roomScene = roomScene;
    this.activeSession = session;
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

  /** Añade un objeto (sofa o table) mediante el servidor. */
  private async addObject(type: 'sofa' | 'table'): Promise<void> {
    if (!this.activeSession || this.activeSession.state !== 'connected') return;
    if (!this.roomScene || !this.roomScene.isEditModeActive()) return;

    const center = this.roomScene.getRoomCenter();
    // Offset pequeño para evitar solapamiento exacto con el centro
    const offsetX = type === 'table' ? 150 : -150;
    const offsetY = type === 'table' ? -100 : 0;

    const patch: RoomObjectCreatePatch = {
      op: 'create',
      type,
      x: center.x + offsetX,
      y: center.y + offsetY,
    };
    try {
      await this.activeSession.addRoomObject(patch);
    } catch (error) {
      console.error('[RoomEditPanel] Error al crear objeto:', error);
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