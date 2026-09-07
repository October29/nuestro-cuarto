import { parsePeerMessage, serializePeerMessage } from './protocol';
import type { PeerMessage, SignalPayload } from './protocol';
import { SignalingClient } from './SignalingClient';
import type { NetworkTransport, TransportHandlers } from './NetworkTransport';

const CHANNEL_LABEL = 'game-net';
export const NEGOTIATION_TIMEOUT_MS = 15000;

// VENTANA DE RECUPERACIÓN (M08-C): cuando la conexión WebRTC se degrada porque
// el peer suspende/recarga su pestaña, la sesión NO se destruye de inmediato.
// Se mantiene un "hold" durante este margen esperando el `peer-resumed` del
// signaling o el cierre autoritativo del servidor (`peer-left`). La gracia del
// servidor (30 s) es la que decide: este hold es solo un respaldo si ese
// mensaje se perdiera.
const RECOVERY_HOLD_MS = 35000;

// STUN público para descubrir la ruta por Internet.
// TURN queda explícitamente fuera (limitación de infraestructura).
const DEFAULT_ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export type TransportState = 'idle' | 'connecting' | 'open' | 'closed';

/**
 * Implementación de NetworkTransport sobre las APIs WebRTC nativas del
 * navegador: RTCPeerConnection + RTCDataChannel. No usa librerías externas.
 *
 * El rol host/visitor es únicamente de establecimiento de conexión: el host
 * crea el `offer` y el canal; el visitor responde. Nada más. No implica
 * autoridad sobre el estado del juego (cada cliente es autoridad de su
 * propio Player).
 *
 * RTCPeerConnection y RTCDataChannel quedan completamente ocultos detrás de
 * NetworkTransport: el resto de la aplicación solo usa esta clase.
 */
export class RtcPeerTransport implements NetworkTransport {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private unsubscribeSignaling: (() => void) | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private holdTimer: ReturnType<typeof setTimeout> | null = null;
  private openResolve: (() => void) | null = null;
  private openReject: ((error: Error) => void) | null = null;
  private status: TransportState = 'idle';
  private closeNotified = false;
  private negotiationStarted = false;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly handlers: TransportHandlers,
    private readonly role: 'host' | 'visitor',
    private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {}

  get state(): TransportState {
    return this.status;
  }

  /**
   * Negocia la conexión P2P y promete cuando el canal de datos está abierto.
   * `initiate` arranca la negociación sin esperar `peer-resumed`: en una
   * recuperación (resume) el signaling ya confirmó que el peer está activo, y
   * el `peer-resumed` de arranque puede llegar antes de suscribirnos.
   */
  connect(options?: { initiate?: boolean }): Promise<void> {
    if (this.status === 'open') return Promise.resolve();
    if (this.status !== 'idle') return Promise.reject(new Error('transporte: no se puede conectar en este estado'));

    this.status = 'connecting';
    this.unsubscribeSignaling = this.signaling.subscribe((message) => {
      if (message.type === 'signal') {
        this.handleIncomingSignal(message.data);
      } else if (message.type === 'peer-joined' && this.role === 'host') {
        // El host creó la sala y ahora el visitor está presente: solo entonces
        // arranca la negociación (corrección M07-A). Si el visitor ya estuviera
        // conectado antes, el offer nunca se perdería porque no se envía antes.
        this.startHostNegotiation();
      } else if (message.type === 'peer-resumed') {
        // M08-C: el peer volvió (o un host recuperado necesita arrancar).
        this.handlePeerResumed();
      } else if (message.type === 'peer-left') {
        // El servidor cierra la sala de forma autoritativa: fin definitivo.
        this.notifyClose('el peer abandonó la sala');
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;
      this.connection = this.createPeerConnection();
      if (options?.initiate && this.role === 'host') {
        this.startHostNegotiation();
      }
    });
  }

  private createPeerConnection(): RTCPeerConnection {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signaling.sendSignal({
          kind: 'ice',
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid ?? undefined,
          sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
        });
      }
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'failed' || state === 'disconnected') {
        this.handleConnectivityLost(state);
      } else if (state === 'connected') {
        // La conectividad volvió (por ejemplo un blip breve): cancelar el hold.
        this.clearHold();
      }
    };

    if (this.role === 'visitor') {
      pc.ondatachannel = (event) => {
        this.channel = event.channel;
        this.setupChannel(event.channel);
      };
    }
    return pc;
  }

  /**
   * M08-C: una pérdida de conectividad WebRTC mientras la sesión estaba abierta
   * ya no destruye la sesión. Se arma un hold y se espera a que el servidor
   * decida: o llega `peer-resumed` (renegociar) o `peer-left` (cerrar).
   */
  private handleConnectivityLost(state: string): void {
    if (this.closeNotified) return;
    if (this.status === 'connecting') {
      // Negociación inicial fallida: se mantiene el comportamiento previo.
      if (state === 'failed') this.fail('fallo de negociación (connectionState failed)');
      return;
    }
    if (this.status !== 'open') return;

    this.clearHold();
    this.holdTimer = setTimeout(
      () => this.notifyClose(`el peer no ha regresado (${state})`),
      RECOVERY_HOLD_MS,
    );
  }

  private clearHold(): void {
    if (this.holdTimer) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  /**
   * M08-C: el peer volvió a estar activo.
   * - host en espera (connecting): arranca la negociación normal.
   * - sesión abierta: se renegocia desde cero (nueva RTCPeerConnection +
   *   offer/answer) reutilizando la regla de rol.
   */
  private handlePeerResumed(): void {
    this.clearHold();
    if (this.status === 'connecting' && this.role === 'host') {
      this.startHostNegotiation();
      return;
    }
    if (this.status === 'open') {
      this.renegotiate();
    }
  }

  /** Reinicia la negociación WebRTC desde cero sobre el mismo canal signaling. */
  private renegotiate(): void {
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this.closePeerConnection();
    this.negotiationStarted = false;
    this.connection = this.createPeerConnection();

    if (this.role === 'host') {
      this.channel = this.connection.createDataChannel(CHANNEL_LABEL);
      this.setupChannel(this.channel);
      this.startNegotiationTimeout();
      void this.makeOffer();
    }
    // visitor: ondatachannel se configura en createPeerConnection; espera el offer.
  }

  private closePeerConnection(): void {
    this.channel = null;
    if (this.connection) {
      try {
        this.connection.close();
      } catch {
        // objeto ya cerrado
      }
      this.connection = null;
    }
  }

  /**
   * Inicia la negociación desde el lado host al recibir `peer-joined`.
   * Protegido contra `peer-joined` duplicados: solo se negocia una vez.
   */
  private startHostNegotiation(): void {
    if (this.role !== 'host' || this.negotiationStarted || this.status !== 'connecting') return;
    if (!this.connection) return;

    this.negotiationStarted = true;
    this.startNegotiationTimeout();

    console.log(
      `[M07A-DIAG] [${new Date().toISOString()}] [RtcPeerTransport startHostNegotiation] role=host`,
    );

    this.channel = this.connection.createDataChannel(CHANNEL_LABEL);
    this.setupChannel(this.channel);
    void this.makeOffer();
  }

  /**
   * El timeout de negociación arranca cuando la negociación empieza de verdad
   * (el host al recibir peer-joined; el visitor al recibir el offer), no
   * mientras el host espera a que alguien se una a la sala.
   */
  private startNegotiationTimeout(): void {
    if (this.timeoutTimer) return;
    this.timeoutTimer = setTimeout(() => this.fail('negociación agotada (timeout)'), NEGOTIATION_TIMEOUT_MS);
  }

  send(message: PeerMessage): boolean {
    const channel = this.channel;
    if (this.status !== 'open' || !channel || channel.readyState !== 'open') return false;
    channel.send(serializePeerMessage(message));
    return true;
  }

  /** Cierre local de la conexión (no emite onClose: lo hizo el usuario). */
  close(): void {
    this.status = 'closed';
    this.closeNotified = true;
    this.clearHold();
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
    this.openReject?.(new Error('conexión cerrada localmente'));
    this.openReject = null;
    this.openResolve = null;
    this.cleanup();
  }

  private async makeOffer(): Promise<void> {
    const pc = this.connection;
    if (!pc) return;
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.signaling.sendSignal({ kind: 'offer', sdp: offer.sdp ?? '' });
    } catch {
      this.fail('no se pudo crear el offer');
    }
  }

  private async handleIncomingSignal(data: SignalPayload): Promise<void> {
    const pc = this.connection;
    if (!pc) return;

    try {
      switch (data.kind) {
        case 'offer': {
          if (this.role !== 'visitor') break;
          // La negociación empieza aquí para el visitor: arranca su timeout.
          this.startNegotiationTimeout();
          await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          this.signaling.sendSignal({ kind: 'answer', sdp: answer.sdp ?? '' });
          break;
        }
        case 'answer': {
          if (this.role !== 'host' || pc.signalingState !== 'have-local-offer') break;
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          break;
        }
        case 'ice': {
          await pc
            .addIceCandidate(
              new RTCIceCandidate({
                candidate: data.candidate,
                sdpMid: data.sdpMid ?? null,
                sdpMLineIndex: data.sdpMLineIndex ?? null,
              }),
            )
            .catch(() => undefined);
          break;
        }
      }
    } catch {
      this.fail('error en la negociación');
    }
  }

  private setupChannel(channel: RTCDataChannel): void {
    channel.onopen = () => {
      this.status = 'open';
      console.log(
        `[M07A-DIAG] [${new Date().toISOString()}] [RtcPeerTransport onOpen] role=${this.role} label=${channel.label}`,
      );
      this.clearHold();
      if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
      this.openResolve?.();
      this.openResolve = null;
      this.openReject = null;
      this.handlers.onOpen();
    };
    channel.onmessage = (event) => {
      const message = parsePeerMessage(String(event.data));
      if (message) this.handlers.onMessage(message);
    };
    channel.onerror = () => {
      if (this.status === 'open') this.handlers.onError('error en el canal de datos');
    };
    channel.onclose = () => {
      // M08-C: un cierre del canal mientras la sesión estaba abierta puede ser
      // la suspensión del peer. Se permite la ventana de recuperación; el cierre
      // definitivo lo decide el servidor (peer-left / expiración de la gracia).
      if (this.status === 'open') {
        this.clearHold();
        this.holdTimer = setTimeout(
          () => this.notifyClose('el peer cerró la conexión'),
          RECOVERY_HOLD_MS,
        );
      } else {
        this.notifyClose('el peer cerró la conexión');
      }
    };
  }

  /** Cierre detectado (el peer desapareció o la conexión falló). */
  private notifyClose(reason: string): void {
    if (this.closeNotified) return;
    this.closeNotified = true;

    if (this.status === 'connecting') {
      this.fail(reason);
      return;
    }
    if (this.status !== 'open') return;

    this.status = 'closed';
    this.cleanup();
    this.handlers.onClose(reason);
  }

  /** Falla durante la negociación: rechaza connect() y avisa por onError. */
  private fail(reason: string): void {
    if (this.status !== 'connecting') return;
    this.closeNotified = true;
    this.status = 'closed';
    this.clearHold();
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
    this.openReject?.(new Error(reason));
    this.openReject = null;
    this.openResolve = null;
    this.cleanup();
    this.handlers.onError(reason);
  }

  private cleanup(): void {
    this.clearHold();
    this.unsubscribeSignaling?.();
    this.unsubscribeSignaling = null;
    this.channel = null;
    if (this.connection) {
      try {
        this.connection.close();
      } catch {
        // objeto ya cerrado
      }
      this.connection = null;
    }
  }
}