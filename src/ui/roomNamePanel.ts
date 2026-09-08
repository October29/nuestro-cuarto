import type { NetworkSession } from '../network/NetworkSession';

export class RoomNamePanel {
  private readonly panel: HTMLDivElement;
  private readonly displayEl: HTMLSpanElement;
  private readonly editBtn: HTMLButtonElement;
  private readonly editForm: HTMLDivElement;
  private readonly editInput: HTMLInputElement;
  private readonly saveBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  private session: NetworkSession | null = null;
  private currentName = '';

  constructor() {
    this.panel = document.getElementById('room-name-panel') as HTMLDivElement;
    this.displayEl = document.getElementById('room-name-display') as HTMLSpanElement;
    this.editBtn = document.getElementById('room-name-edit-btn') as HTMLButtonElement;
    this.editForm = document.getElementById('room-name-edit-form') as HTMLDivElement;
    this.editInput = document.getElementById('room-name-edit-input') as HTMLInputElement;
    this.saveBtn = document.getElementById('room-name-save-btn') as HTMLButtonElement;
    this.cancelBtn = document.getElementById('room-name-cancel-btn') as HTMLButtonElement;

    this.editBtn.addEventListener('click', () => this.enterEditMode());
    this.saveBtn.addEventListener('click', () => this.saveName());
    this.cancelBtn.addEventListener('click', () => this.cancelEdit());
    this.editInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.saveName();
      else if (e.key === 'Escape') this.cancelEdit();
    });

    this.hide();
  }

  bindSession(session: NetworkSession | null): void {
    this.session = session;
    if (session) {
      this.show();
    } else {
      this.hide();
    }
  }

  setRoomName(name: string): void {
    this.currentName = name;
    this.displayEl.textContent = name;
  }

  private enterEditMode(): void {
    this.editInput.value = this.currentName;
    this.displayEl.hidden = true;
    this.editBtn.hidden = true;
    this.editForm.hidden = false;
    this.editInput.focus();
    this.editInput.select();
  }

  private cancelEdit(): void {
    this.editForm.hidden = true;
    this.displayEl.hidden = false;
    this.editBtn.hidden = false;
  }

  private async saveName(): Promise<void> {
    const newName = this.editInput.value.trim();
    if (!newName || newName === this.currentName) {
      this.cancelEdit();
      return;
    }
    if (!this.session || this.session.state !== 'connected') {
      this.cancelEdit();
      return;
    }

    try {
      await this.session.updateRoomState({ name: newName });
    } catch {
      // Error handling: el servidor rechaza la actualización y no notifica room:updated.
      // La UI se mantiene con el nombre anterior.
    } finally {
      this.cancelEdit();
    }
  }

  private show(): void {
    this.panel.hidden = false;
  }

  private hide(): void {
    this.panel.hidden = true;
    this.cancelEdit();
  }
}