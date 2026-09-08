import { NetworkSession, type SessionHandlers, type SessionState } from '../network/NetworkSession';
import type { PeerMessage } from '../network/protocol';
import { RoomDirectory } from '../storage/roomDirectory';

type StatusLabel = 'desconectado' | 'conectando...' | 'conectado' | 'desconectado (peer)' | 'error';

const STATUS_TEXT: Record<SessionState, StatusLabel> = {
  idle: 'desconectado',
  connecting: 'conectando...',
  connected: 'conectado',
  disconnected: 'desconectado (peer)',
  error: 'error',
};

export interface ConnectMenuOptions {
  /** Cómo crear la sesión. Por defecto usa NetworkSession real; en pruebas se inyecta un mock. */
  createSession?: (handlers: SessionHandlers) => NetworkSession;
  /** Libreta local de "Mis salas". Por defecto usa una nueva con localStorage. */
  roomDirectory?: RoomDirectory;
}

export class ConnectMenu {
  private session: NetworkSession | null = null;
  private onMessage: ((message: PeerMessage) => void) | null = null;
  private sessionListeners = new Set<(session: NetworkSession | null) => void>();
  private readonly createSession: (handlers: SessionHandlers) => NetworkSession;
  private currentState: SessionState = 'idle';

  private readonly directory: RoomDirectory;
  /** true solo durante la creación de una sala: el código recién creado se
   * guarda en la libreta al confirmarlo el servidor (onRoomCreated). */
  private creatingRoom = false;
  private pendingName: string | null = null;

  private readonly createBtn: HTMLButtonElement;
  private readonly newRoomNameInput: HTMLInputElement;
  private readonly savedRoomsList: HTMLUListElement;
  private readonly codeDisplay: HTMLDivElement;
  private readonly codeText: HTMLSpanElement;
  private readonly codeInput: HTMLInputElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly statusDiv: HTMLDivElement;
  private readonly peerStatus: HTMLDivElement;
  private readonly disconnectBtn: HTMLButtonElement;
  private readonly errorMsg: HTMLDivElement;

  constructor(options: ConnectMenuOptions = {}) {
    this.createSession = options.createSession ?? ((handlers) => new NetworkSession({ handlers }));
    this.directory = options.roomDirectory ?? new RoomDirectory();

    this.createBtn = document.getElementById('create-room-btn') as HTMLButtonElement;
    this.newRoomNameInput = document.getElementById('new-room-name-input') as HTMLInputElement;
    this.savedRoomsList = document.getElementById('saved-rooms-list') as HTMLUListElement;
    this.codeDisplay = document.getElementById('room-code-display') as HTMLDivElement;
    this.codeText = document.getElementById('room-code-text') as HTMLSpanElement;
    this.codeInput = document.getElementById('room-code-input') as HTMLInputElement;
    this.joinBtn = document.getElementById('join-room-btn') as HTMLButtonElement;
    this.statusDiv = document.getElementById('connection-status') as HTMLDivElement;
    this.peerStatus = document.getElementById('peer-status') as HTMLDivElement;
    this.peerStatus.textContent = 'Tu amistad salió de la sala.';
    this.disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
    this.errorMsg = document.getElementById('connection-error') as HTMLDivElement;

    this.createBtn.addEventListener('click', () => this.handleCreate());
    this.joinBtn.addEventListener('click', () => this.handleJoin());
    this.disconnectBtn.addEventListener('click', () => this.handleDisconnect());
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleJoin();
    });
    this.codeInput.addEventListener('input', () => this.updateJoinButton());

    this.renderSavedRooms();
    this.resetUI();
  }

  /** Permite que el chat reciba los mensajes P2P de la sesión activa. */
  setMessageCallback(callback: (message: PeerMessage) => void): void {
    this.onMessage = callback;
  }

  /** Notifica cuando la sesión activa cambia (created/joined → sesión; salir → null). */
  onSessionChange(listener: (session: NetworkSession | null) => void): void {
    this.sessionListeners.add(listener);
  }

  /** Devuelve la sesión activa (null si no hay conexión). */
  getSession(): NetworkSession | null {
    return this.session;
  }

  private notifySessionChanged(): void {
    const sessionId = (this.session as { diagId?: number } | null)?.diagId ?? null;
    console.log(
      `[M07A-DIAG] [${new Date().toISOString()}] [ConnectMenu notifySessionChanged]`,
      JSON.stringify({ session: sessionId }),
    );
    for (const listener of this.sessionListeners) {
      listener(this.session);
    }
  }

  private async handleCreate(): Promise<void> {
    this.resetError();
    this.disposeActiveSession();
    this.setUIState('connecting');

    const name = this.newRoomNameInput.value.trim();
    this.creatingRoom = true;
    this.pendingName = name.length > 0 ? name : null;

    const handlers: SessionHandlers = this.buildHandlers();
    this.session = this.createSession(handlers);

    try {
      const code = await this.session.createRoom();
      this.codeText.textContent = code;
      this.codeDisplay.hidden = false;
      this.codeInput.disabled = true;
      this.setUIState('connected');
      this.notifySessionChanged();
    } catch (error) {
      this.creatingRoom = false;
      this.pendingName = null;
      this.session = null;
      this.showError(error instanceof Error ? error.message : String(error));
      this.setUIState('idle');
      this.notifySessionChanged();
    }
  }

  private async handleJoin(): Promise<void> {
    this.resetError();
    this.disposeActiveSession();
    this.creatingRoom = false;
    this.pendingName = null;
    const code = this.codeInput.value.trim().toUpperCase();
    if (code.length !== 6) {
      this.showError('El código debe tener 6 caracteres');
      return;
    }

    this.setUIState('connecting');
    const handlers: SessionHandlers = this.buildHandlers();
    this.session = this.createSession(handlers);

    try {
      await this.session.joinRoom(code);
      this.codeText.textContent = code;
      this.codeDisplay.hidden = false;
      this.codeInput.disabled = true;
      this.setUIState('connected');
      this.notifySessionChanged();
    } catch (error) {
      this.session = null;
      this.showError(error instanceof Error ? error.message : String(error));
      this.setUIState('idle');
      this.notifySessionChanged();
    }
  }

  /** Entra en una sala desde "Mis salas": joinRoom(roomId), sin resume. */
  private async enterSavedRoom(roomId: string): Promise<void> {
    this.resetError();
    this.disposeActiveSession();
    this.creatingRoom = false;
    this.pendingName = null;
    this.codeInput.value = roomId;

    this.setUIState('connecting');
    const handlers: SessionHandlers = this.buildHandlers();
    this.session = this.createSession(handlers);

    try {
      await this.session.joinRoom(roomId);
      this.codeText.textContent = roomId;
      this.codeDisplay.hidden = false;
      this.codeInput.disabled = true;
      this.setUIState('connected');
      this.notifySessionChanged();
    } catch (error) {
      // La sala no existe (o no se puede entrar): se propaga el error y NO se
      // inventa una sala nueva automáticamente.
      this.session = null;
      this.showError(error instanceof Error ? error.message : String(error));
      this.setUIState('idle');
      this.notifySessionChanged();
    }
  }

  /** Olvida una sala de la libreta local. NO toca la Room del servidor. */
  private forgetSavedRoom(roomId: string): void {
    this.directory.remove(roomId);
    this.renderSavedRooms();
  }

  private renderSavedRooms(): void {
    this.savedRoomsList.innerHTML = '';
    for (const room of this.directory.list()) {
      const li = document.createElement('li');
      li.className = 'saved-room';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'room-name';
      nameSpan.textContent = room.name;

      const idSpan = document.createElement('span');
      idSpan.className = 'room-id';
      idSpan.textContent = room.roomId;

      const enterBtn = document.createElement('button');
      enterBtn.type = 'button';
      enterBtn.textContent = 'Entrar';
      enterBtn.addEventListener('click', () => void this.enterSavedRoom(room.roomId));

      const forgetBtn = document.createElement('button');
      forgetBtn.type = 'button';
      forgetBtn.textContent = 'Olvidar';
      forgetBtn.addEventListener('click', () => this.forgetSavedRoom(room.roomId));

      li.appendChild(nameSpan);
      li.appendChild(idSpan);
      li.appendChild(enterBtn);
      li.appendChild(forgetBtn);
      this.savedRoomsList.appendChild(li);
    }
  }

  private handleDisconnect(): void {
    this.session?.close();
    this.session = null;
    this.codeDisplay.hidden = true;
    this.codeInput.disabled = false;
    this.codeInput.value = '';
    this.setUIState('idle');
    this.resetError();
    this.notifySessionChanged();
  }

  /**
   * Antes de crear/unir/entrar en una Room nueva, abandona limpiamente la
   * sesión activa si la hubiera (leave: anuncia al signaling y cierra su
   * transporte). Evita dejar dos sesiones vivas encima de la misma UI.
   * Guard por si la sesión (p.ej. un mock de test) no expone leave().
   */
  private disposeActiveSession(): void {
    const session = this.session;
    if (!session) return;
    if (typeof (session as { leave?: () => void }).leave === 'function') {
      session.leave();
    } else {
      session.close();
    }
    this.session = null;
  }

  private buildHandlers(): SessionHandlers {
    return {
      onOpen: () => {
        this.setUIState('connected');
        // Un canal abierto implica que el peer está: ocultamos el aviso de
        // abandono por si quedara visible.
        this.setPeerStatus(false);
        // Notificación de sesión la da handleCreate/handleJoin tras la resolución
        // de createRoom/joinRoom. Aquí solo actualizamos el estado visual de la UI.
      },
      onMessage: (message) => this.onMessage?.(message),
      onPeerJoined: () => {
        // El peer volvió a estar presente: ocultamos el aviso de abandono.
        this.setPeerStatus(false);
      },
      onPeerLeft: () => {
        // El peer se fue, pero la Room sigue viva y esta sesión permanece en
        // ella: no dejamos la sala ni desmontamos la sesión. Solo avisamos.
        this.setPeerStatus(true);
      },
      onError: (error) => {
        this.showError(error.message);
        if (this.session?.state === 'error') this.setUIState('idle');
      },
      onRoomCreated: (code) => {
        this.codeText.textContent = code;
        this.codeDisplay.hidden = false;
        this.codeInput.disabled = true;
        // La creación confirmada por el servidor se guarda en la libreta.
        if (this.creatingRoom) {
          const name = this.pendingName ?? `Sala ${code}`;
          this.directory.save(code, name);
          this.creatingRoom = false;
          this.pendingName = null;
          this.newRoomNameInput.value = '';
          this.renderSavedRooms();
        }
      },
    };
  }

  private setUIState(state: SessionState): void {
    this.currentState = state;
    const connected = state === 'connected';
    const idle = state === 'idle' || state === 'disconnected';

    this.createBtn.disabled = !idle;
    this.updateJoinButton();
    this.codeInput.disabled = !idle;
    this.disconnectBtn.hidden = !connected;
    this.statusDiv.textContent = STATUS_TEXT[state];
    this.statusDiv.className = `status-${state}`;
    if (!connected) this.setPeerStatus(false);
  }

  /** Aviso de presencia: true muestra "Tu amistad salió de la sala". */
  private setPeerStatus(show: boolean): void {
    this.peerStatus.hidden = !show;
  }

  private resetUI(): void {
    this.currentState = 'idle';
    this.codeDisplay.hidden = true;
    this.disconnectBtn.hidden = true;
    this.peerStatus.hidden = true;
    this.codeInput.value = '';
    this.codeInput.disabled = false;
    this.createBtn.disabled = false;
    this.updateJoinButton();
    this.statusDiv.textContent = STATUS_TEXT.idle;
    this.statusDiv.className = 'status-idle';
    this.errorMsg.textContent = '';
    this.errorMsg.hidden = true;
  }

  /** Recalcula si el botón Unirse debe estar habilitado. */
  private updateJoinButton(): void {
    const sessionAllowsJoin = this.currentState === 'idle' || this.currentState === 'disconnected';
    this.joinBtn.disabled = !sessionAllowsJoin || this.codeInput.value.trim().length < 6;
  }

  private showError(message: string): void {
    this.errorMsg.textContent = message;
    this.errorMsg.hidden = false;
  }

  private resetError(): void {
    this.errorMsg.textContent = '';
    this.errorMsg.hidden = true;
  }
}