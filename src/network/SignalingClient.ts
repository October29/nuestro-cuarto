import type {
  ClientSignalingMessage,
  ServerSignalingMessage,
  SignalPayload,
  SignalingErrorMessage,
} from './protocol';

const DEFAULT_PORT = 8787;

// URL por defecto: el signaling vive en el mismo host que sirve la página.
// Se puede pasar una URL distinta al constructor para apuntar a otro servidor.
const WS_OPEN = 1;
const WS_CONNECTING = 0;

function defaultSignalingUrl(): string {
  if (typeof location === 'undefined') return 'ws://localhost:8787';
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.hostname}:${DEFAULT_PORT}`;
}

type ServerMessageListener = (message: ServerSignalingMessage) => void;

interface PendingRequest {
  waitType: ServerSignalingMessage['type'];
  resolve: (message: ServerSignalingMessage) => void;
  reject: (error: Error) => void;
}

/**
 * Cliente mínimo del servidor de signaling de la Etapa 1.
 *
 * Únicamente: conectar, crear sala, unirse a sala, enviar señales SDP/ICE y
 * notificar los eventos básicos del servidor. Sin lógica de gameplay.
 */
export class SignalingClient {
  private url: string;
  private webSocket: WebSocket | null = null;
  private listeners = new Set<ServerMessageListener>();
  private pending: PendingRequest | null = null;
  private status: 'idle' | 'connecting' | 'connected' | 'closed' = 'idle';

  constructor(url?: string) {
    this.url = url ?? defaultSignalingUrl();
  }

  get state(): 'idle' | 'connecting' | 'connected' | 'closed' {
    return this.status;
  }

  /** Suscribe un listener a los mensajes del servidor. Devuelve unsubscribe. */
  subscribe(listener: ServerMessageListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  connect(): Promise<void> {
    if (this.status === 'connected') return Promise.resolve();
    if (this.status === 'connecting') return Promise.reject(new Error('signaling: ya se está conectando'));

    this.status = 'connecting';
    this.webSocket = new WebSocket(this.url);

    return new Promise<void>((resolve, reject) => {
      const ws = this.webSocket as WebSocket;
      ws.onopen = () => {
        this.status = 'connected';
        resolve();
      };
      ws.onerror = () => {
        if (this.status === 'connecting') {
          this.status = 'closed';
          reject(new Error(`signaling: servidor inaccesible en ${this.url}`));
        }
      };
      ws.onmessage = (event) => this.handleMessage(String(event.data));
      ws.onclose = () => {
        this.status = 'closed';
        this.pending?.reject(new Error('signaling: conexión cerrada'));
        this.pending = null;
      };
    });
  }

  createRoom(): Promise<string> {
    return this.exchange({ type: 'create' }, 'created', 'create').then(
      (message) => (message as { type: 'created'; roomCode: string }).roomCode,
    );
  }

  joinRoom(roomCode: string): Promise<void> {
    return this.exchange({ type: 'join', roomCode }, 'joined', 'join').then(() => undefined);
  }

  sendSignal(data: SignalPayload): void {
    this.send({ type: 'signal', data });
  }

  close(): void {
    this.pending?.reject(new Error('signaling: conexión cerrada'));
    this.pending = null;

    const ws = this.webSocket;
    this.webSocket = null;
    if (ws && (ws.readyState === WS_OPEN || ws.readyState === WS_CONNECTING)) {
      ws.close();
    }
    this.status = 'closed';
  }

  private exchange(
    message: ClientSignalingMessage,
    waitType: ServerSignalingMessage['type'],
    action: string,
  ): Promise<ServerSignalingMessage> {
    if (this.status !== 'connected') {
      return Promise.reject(new Error(`signaling: no conectado (${action})`));
    }
    if (this.pending) {
      return Promise.reject(new Error(`signaling: hay una petición en curso (${action})`));
    }

    return new Promise<ServerSignalingMessage>((resolve, reject) => {
      this.pending = { waitType, resolve, reject };
      this.send(message);
    });
  }

  private send(message: ClientSignalingMessage): void {
    const ws = this.webSocket;
    if (!ws || ws.readyState !== WS_OPEN) return;
    ws.send(JSON.stringify(message));
  }

  private handleMessage(raw: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof msg !== 'object' || msg === null) return;

    const knownTypes: readonly ServerSignalingMessage['type'][] = [
      'created',
      'joined',
      'peer-joined',
      'signal',
      'peer-left',
      'error',
    ];
    const serverMsg = msg as ServerSignalingMessage;
    if (!knownTypes.includes(serverMsg.type)) return;

    if (this.pending && (serverMsg.type === this.pending.waitType || serverMsg.type === 'error')) {
      const p = this.pending;
      this.pending = null;
      if (serverMsg.type === 'error') {
        p.reject(new Error((serverMsg as SignalingErrorMessage).message));
      } else {
        p.resolve(serverMsg);
      }
      return;
    }

    for (const listener of this.listeners) {
      listener(serverMsg);
    }
  }
}