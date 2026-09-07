import { SignalingClient } from './SignalingClient';
import { RtcPeerTransport } from './RtcPeerTransport';
import type { PeerMessage } from './protocol';
import type { NetworkTransport, TransportHandlers } from './NetworkTransport';

export type SessionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

/**
 * Rol en la habitación conjunta. Sirve solo para establecer la conexión P2P
 * (el host crea la sala y el offer; el visitor se une y responde). Ningún peer
 * es autoridad global del juego.
 */
export type SessionRole = 'host' | 'visitor';

export interface SessionHandlers {
  /** La sesión quedó lista: sala creada/unida y canal de datos abierto. */
  onOpen(roomCode: string): void;
  /** Mensaje P2P tipado recibido del otro participante. */
  onMessage(message: PeerMessage): void;
  /** El otro participante se desconectó o la conexión se perdió. */
  onPeerLeft(reason: string): void;
  /** Error básico del signaling o de la negociación P2P. */
  onError(error: Error): void;
  /** El signaling confirmó la sala (created/joined): el código ya es válido
   * y puede mostrarse, aunque el canal P2P todavía no esté abierto. */
  onRoomCreated?(roomCode: string): void;
}

export interface NetworkSessionOptions {
  handlers: SessionHandlers;
  /**
   * URL del signaling. Por defecto se deriva del host servidor (Etapa 1).
   */
  signalingUrl?: string;
  /**
   * Identidad persistente del participante. El servidor la usa para reclamar
   * el slot de una sesión existente tras una recarga (M08-C). Si no se pasa,
   * se genera una identidad efímera para esta instancia.
   */
  participantId?: string;
  /**
   * Cómo construir el transporte P2P. Por defecto usa RtcPeerTransport.
   * Permite inyectar un transporte alternativo (o un mock) sin tocar WebRTC.
   */
  makeTransport?: (
    signaling: SignalingClient,
    handlers: TransportHandlers,
    role: SessionRole,
  ) => NetworkTransport;
}

// Instrumentación temporal M07-A: contador para distinguir instancias de
// NetworkSession en los logs de diagnóstico del RemotePlayer duplicado.
let nextDiagId = 0;

/**
 * Capa de sesión: orquesta signaling + transporte y expone un punto único de
 * entrada a la red con mensajes tipados.
 *
 * Gameplay/UI -> NetworkSession -> NetworkTransport -> RtcPeerTransport
 *
 * Esta clase NO conoce Phaser, no renderiza, no mueve jugadores, no toca el
 * DOM y no accede a RTCPeerConnection ni a RTCDataChannel.
 */
export class NetworkSession {
  private signaling: SignalingClient;
  private transport: NetworkTransport | null = null;
  private makeTransport: NonNullable<NetworkSessionOptions['makeTransport']>;
  private handlers: SessionHandlers;
  private status: SessionState = 'idle';
  private code: string | null = null;
  private sessionRole: SessionRole | null = null;
  private readonly participantId: string;

  /** Instrumentación temporal M07-A: id de diagnóstico de esta instancia. */
  readonly diagId = ++nextDiagId;

  constructor(options: NetworkSessionOptions) {
    this.handlers = options.handlers;
    this.participantId = options.participantId ?? defaultParticipantId();
    this.signaling = new SignalingClient(options.signalingUrl);
    this.makeTransport =
      options.makeTransport ??
      ((signaling, handlers, role) => new RtcPeerTransport(signaling, handlers, role));

    diagLog('NetworkSession created', { diagId: this.diagId });
  }

  get state(): SessionState {
    return this.status;
  }

  get roomCode(): string | null {
    return this.code;
  }

  get role(): SessionRole | null {
    return this.sessionRole;
  }

  /** Ruta host: conecta el signaling, crea una sala y negocia el P2P. */
  async createRoom(): Promise<string> {
    this.ensureIdle();
    this.status = 'connecting';
    this.sessionRole = 'host';

    try {
      await this.signaling.connect();
      const code = await this.signaling.createRoom(this.participantId);
      this.code = code;
      this.handlers.onRoomCreated?.(code);
      this.transport = this.makeTransport(this.signaling, this.transportHandlers(), 'host');
      await this.transport.connect();
      diagLog('NetworkSession createRoom resolvió', { diagId: this.diagId, role: 'host', roomCode: code });
      return code;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Ruta visitor: conecta el signaling, se une a la sala y negocia el P2P. */
  async joinRoom(roomCode: string): Promise<void> {
    this.ensureIdle();
    this.status = 'connecting';
    this.sessionRole = 'visitor';
    this.code = roomCode;

    try {
      await this.signaling.connect();
      await this.signaling.joinRoom(roomCode, this.participantId);
      this.handlers.onRoomCreated?.(roomCode);
      this.transport = this.makeTransport(this.signaling, this.transportHandlers(), 'visitor');
      await this.transport.connect();
      diagLog('NetworkSession joinRoom resolvió', { diagId: this.diagId, role: 'visitor', roomCode });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /**
   * Ruta de recuperación (M08-C): tras una recarga, reconecta el signaling y
   * reclama el slot de la sesión persistida con la misma identidad y rol. El
   * transporte se negocia desde cero por el canal normal (host oferta, visitor
   * responde) reutilizando el flujo de vuelta a connected.
   */
  async resume(roomCode: string, role: SessionRole): Promise<void> {
    this.ensureIdle();
    this.status = 'connecting';
    this.sessionRole = role;
    this.code = roomCode;

    try {
      await this.signaling.connect();
      const { peerActive } = await this.signaling.resume(roomCode, this.participantId, role);
      this.handlers.onRoomCreated?.(roomCode);
      this.transport = this.makeTransport(this.signaling, this.transportHandlers(), role);
      // Host recuperado: el `peer-resumed` de arranque pudo llegar antes de
      // suscribir el transporte, así que arrancamos la negociación directamente.
      await this.transport.connect({ initiate: role === 'host' && peerActive });
      diagLog('NetworkSession resume resolvió', { diagId: this.diagId, role, roomCode });
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Envía un mensaje P2P tipado. Devuelve false si la sesión no está lista. */
  send(message: PeerMessage): boolean {
    if (this.status !== 'connected' || !this.transport) return false;
    return this.transport.send(message);
  }

  /** Cierre local de la sesión (notifica al servidor con leave; no dispara onPeerLeft). */
  close(): void {
    // Aviso explícito de abandono para liberar el slot (y la sala) al instante
    // en el servidor, en lugar de dejar que expire la ventana de recuperación.
    this.signaling.leave();
    this.transport?.close();
    this.transport = null;
    this.signaling.close();
    this.status = 'disconnected';
  }

  private ensureIdle(): void {
    if (this.status === 'connecting') {
      throw new Error('sesión: ya hay una conexión en curso');
    }
    if (this.status === 'connected') {
      throw new Error('sesión: ya conectado');
    }
  }

  private transportHandlers(): TransportHandlers {
    return {
      onOpen: () => {
        this.status = 'connected';
        this.handlers.onOpen(this.code ?? '');
      },
      onMessage: (message) => this.handlers.onMessage(message),
      onClose: (reason) => {
        this.status = 'disconnected';
        this.handlers.onPeerLeft(reason);
      },
      onError: (error) => this.handlers.onError(new Error(error)),
    };
  }

  private fail(error: unknown): void {
    this.transport?.close();
    this.transport = null;
    this.status = 'error';
    this.handlers.onError(error instanceof Error ? error : new Error(String(error)));
  }
}

function diagLog(event: string, extra: Record<string, unknown>): void {
  console.log(`[M07A-DIAG] [${new Date().toISOString()}] ${event}`, JSON.stringify(extra));
}

function defaultParticipantId(): string {
  const random = (Math.random() + 1).toString(36).slice(2, 12);
  return `participant-${random}`;
}
