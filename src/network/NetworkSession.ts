import { SignalingClient } from './SignalingClient';
import { RtcPeerTransport } from './RtcPeerTransport';
import type { PeerMessage, RoomState } from './protocol';
import type { NetworkTransport, TransportHandlers } from './NetworkTransport';

export type SessionState = 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error';

export interface SessionHandlers {
  /** La sesión quedó lista: sala creada/unida y canal de datos abierto. */
  onOpen(roomCode: string): void;
  /** Mensaje P2P tipado recibido del otro participante. */
  onMessage(message: PeerMessage): void;
  /** Otro participante acaba de estar presente en la sala (peer-joined). */
  onPeerJoined?(): void;
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
  /** URL del signaling. Por defecto se deriva del host servidor (Etapa 1). */
  signalingUrl?: string;
  /**
   * Cómo construir el transporte P2P. Por defecto usa RtcPeerTransport.
   * Permite inyectar un transporte alternativo (o un mock) sin tocar WebRTC.
   */
  makeTransport?: (
    signaling: SignalingClient,
    handlers: TransportHandlers,
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
  private unsubscribeSignaling: (() => void) | null = null;
  private peerPresent = false;

  /** Instrumentación temporal M07-A: id de diagnóstico de esta instancia. */
  readonly diagId = ++nextDiagId;

  constructor(options: NetworkSessionOptions) {
    this.handlers = options.handlers;
    this.signaling = new SignalingClient(options.signalingUrl);
    this.makeTransport =
      options.makeTransport ??
      ((signaling, handlers) => new RtcPeerTransport(signaling, handlers));

    // Room-first (Pasos 2-5): los avisos de presencia del signaling actualizan
    // "¿hay otro participante?" sin tocar el ciclo de vida de ESTA sesión.
    // peer-joined avisa a la UI; peer-left significa que el otro ya no está
    // conectado, NO que nuestra sesión haya terminado: aquí solo se baja el
    // flag y no se cierra nada.
    this.unsubscribeSignaling = this.signaling.subscribe((message) => {
      if (message.type === 'peer-joined') {
        this.peerPresent = true;
        this.handlers.onPeerJoined?.();
      } else if (message.type === 'peer-left') {
        this.peerPresent = false;
      }
    });

    diagLog('NetworkSession created', { diagId: this.diagId });
  }

  get state(): SessionState {
    return this.status;
  }

  get roomCode(): string | null {
    return this.code;
  }

  /** ¿Hay otro participante presente en la Room desde esta sesión? Cuando el
   * peer se va (peer-left del signaling o cierre del canal de datos), bajamos
   * el flag pero NO cerramos la sesión: la Room sigue viva y preparada para
   * que entre otro participante más adelante. */
  get hasPeer(): boolean {
    return this.peerPresent;
  }

  /** Ruta creador: conecta el signaling, crea una sala y arma el transporte. */
  async createRoom(): Promise<string> {
    this.ensureIdle();
    this.status = 'connecting';

    try {
      await this.signaling.connect();
      const code = await this.signaling.createRoom();
      this.code = code;
      this.status = 'connected';
      this.handlers.onRoomCreated?.(code);
      this.transport = this.makeTransport(this.signaling, this.transportHandlers());
      await this.transport.connect();
      diagLog('NetworkSession createRoom resolvió', { diagId: this.diagId, roomCode: code });
      return code;
    } catch (error) {
      this.fail(error);
      throw error;
    }
  }

  /** Ruta de entrada: conecta el signaling, se une a la sala y arma el transporte. */
  async joinRoom(roomCode: string): Promise<void> {
    this.ensureIdle();
    this.status = 'connecting';
    this.code = roomCode;

    try {
      await this.signaling.connect();
      await this.signaling.joinRoom(roomCode);
      this.status = 'connected';
      this.handlers.onRoomCreated?.(roomCode);
      this.transport = this.makeTransport(this.signaling, this.transportHandlers());
      await this.transport.connect();
      diagLog('NetworkSession joinRoom resolvió', { diagId: this.diagId, roomCode });
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

  /**
   * Solicita el estado actual de la Room al servidor (Room State Step 1).
   *
   * La sesión debe estar en estado 'connected' (es decir, haber completado
   * createRoom o joinRoom). El servidor validará que el socket pertenece a
   * una Room antes de responder.
   *
   * Esta operación es de solo lectura: no modifica el estado de la sala.
   */
  getRoomState(): Promise<RoomState> {
    return this.signaling.getRoomState();
  }

  /** Cierre local de la sesión (no notifica onPeerLeft: lo hace el usuario). */
  close(): void {
    this.tearDown();
  }

  /**
   * Abandona la sala manteniéndola viva en el servidor (Room-first).
   *
   * Representa "este cliente abandona la Room": anuncia el abandono al
   * signaling (leave) y luego cierra su transporte y su conexión. La Room
   * es server-owned y no se destruye; cualquier participante podrá reentrar
   * después. Diferencia conceptual con close():
   *   - leave()  = quiero abandonar la sala (abandono explícito).
   *   - close()  = cierro esta conexión (fin local, sin anuncio).
   * No notifica onPeerLeft: el abandono es intencional y local.
   */
  leave(): void {
    this.signaling.leave();
    this.tearDown();
  }

  private tearDown(): void {
    this.transport?.close();
    this.transport = null;
    this.signaling.close();
    this.unsubscribeSignaling?.();
    this.unsubscribeSignaling = null;
    this.peerPresent = false;
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
        // Un canal de datos abierto implica que el peer en la otra punta
        // existe: la presencia también se refleja aquí.
        this.peerPresent = true;
        this.handlers.onOpen(this.code ?? '');
      },
      onMessage: (message) => this.handlers.onMessage(message),
      onClose: (reason) => {
        // La negociación P2P terminó (peer se fue / conexión perdida), pero la
        // Room sigue viva: solo bajamos la presencia y avisamos. NO cambiamos
        // el estado de la sesión (se queda en 'connected').
        this.peerPresent = false;
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