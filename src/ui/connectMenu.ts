import { NetworkSession, type SessionHandlers, type SessionState } from '../network/NetworkSession';
import type { PeerMessage } from '../network/protocol';

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
}

export class ConnectMenu {
  private session: NetworkSession | null = null;
  private onMessage: ((message: PeerMessage) => void) | null = null;
  private sessionListeners = new Set<(session: NetworkSession | null) => void>();
  private readonly createSession: (handlers: SessionHandlers) => NetworkSession;
  private currentState: SessionState = 'idle';

  private readonly createBtn: HTMLButtonElement;
  private readonly codeDisplay: HTMLDivElement;
  private readonly codeText: HTMLSpanElement;
  private readonly codeInput: HTMLInputElement;
  private readonly joinBtn: HTMLButtonElement;
  private readonly statusDiv: HTMLDivElement;
  private readonly disconnectBtn: HTMLButtonElement;
  private readonly errorMsg: HTMLDivElement;

  constructor(options: ConnectMenuOptions = {}) {
    this.createSession = options.createSession ?? ((handlers) => new NetworkSession({ handlers }));

    this.createBtn = document.getElementById('create-room-btn') as HTMLButtonElement;
    this.codeDisplay = document.getElementById('room-code-display') as HTMLDivElement;
    this.codeText = document.getElementById('room-code-text') as HTMLSpanElement;
    this.codeInput = document.getElementById('room-code-input') as HTMLInputElement;
    this.joinBtn = document.getElementById('join-room-btn') as HTMLButtonElement;
    this.statusDiv = document.getElementById('connection-status') as HTMLDivElement;
    this.disconnectBtn = document.getElementById('disconnect-btn') as HTMLButtonElement;
    this.errorMsg = document.getElementById('connection-error') as HTMLDivElement;

    this.createBtn.addEventListener('click', () => this.handleCreate());
    this.joinBtn.addEventListener('click', () => this.handleJoin());
    this.disconnectBtn.addEventListener('click', () => this.handleDisconnect());
    this.codeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleJoin();
    });
    this.codeInput.addEventListener('input', () => this.updateJoinButton());

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
    this.setUIState('connecting');

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
      this.session = null;
      this.showError(error instanceof Error ? error.message : String(error));
      this.setUIState('idle');
      this.notifySessionChanged();
    }
  }

  private async handleJoin(): Promise<void> {
    this.resetError();
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

  private buildHandlers(): SessionHandlers {
    return {
      onOpen: () => {
        this.setUIState('connected');
        // Notificación de sesión la da handleCreate/handleJoin tras la resolución
        // de createRoom/joinRoom. Aquí solo actualizamos el estado visual de la UI.
      },
      onMessage: (message) => this.onMessage?.(message),
      onPeerLeft: (reason) => {
        this.session = null;
        this.codeDisplay.hidden = true;
        this.codeInput.disabled = false;
        this.codeInput.value = '';
        this.setUIState('idle');
        this.notifySessionChanged();
        this.showError(`Peer desconectado: ${reason}`);
      },
      onError: (error) => {
        this.showError(error.message);
        if (this.session?.state === 'error') this.setUIState('idle');
      },
      onRoomCreated: (code) => {
        this.codeText.textContent = code;
        this.codeDisplay.hidden = false;
        this.codeInput.disabled = true;
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
  }

  private resetUI(): void {
    this.currentState = 'idle';
    this.codeDisplay.hidden = true;
    this.disconnectBtn.hidden = true;
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