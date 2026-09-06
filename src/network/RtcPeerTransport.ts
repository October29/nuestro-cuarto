import { parsePeerMessage, serializePeerMessage } from './protocol';
import type { PeerMessage, SignalPayload } from './protocol';
import { SignalingClient } from './SignalingClient';
import type { NetworkTransport, TransportHandlers } from './NetworkTransport';

const CHANNEL_LABEL = 'game-net';
export const NEGOTIATION_TIMEOUT_MS = 15000;

// STUN público para descubrir la ruta por Internet.
// TURN queda explícitamente fuera de M07 (limitación de infraestructura,
// documentada en el reporte del milestone).
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

  /** Negocia la conexión P2P y promete cuando el canal de datos está abierto. */
  connect(): Promise<void> {
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
      }
    });

    return new Promise<void>((resolve, reject) => {
      this.openResolve = resolve;
      this.openReject = reject;

      this.connection = new RTCPeerConnection({ iceServers: this.iceServers });
      this.connection.onicecandidate = (event) => {
        if (event.candidate) {
          this.signaling.sendSignal({
            kind: 'ice',
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid ?? undefined,
            sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
          });
        }
      };
      this.connection.onconnectionstatechange = () => {
        const state = this.connection?.connectionState;
        if (state === 'failed') {
          this.notifyClose('fallo de negociación (connectionState failed)');
        } else if (state === 'disconnected') {
          this.notifyClose('la conexión con el peer se ha perdido');
        }
      };

      if (this.role === 'visitor') {
        this.connection.ondatachannel = (event) => {
          this.channel = event.channel;
          this.setupChannel(event.channel);
        };
      }
    });
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
      this.notifyClose('el peer cerró la conexión');
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
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
    this.openReject?.(new Error(reason));
    this.openReject = null;
    this.openResolve = null;
    this.cleanup();
    this.handlers.onError(reason);
  }

  private cleanup(): void {
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