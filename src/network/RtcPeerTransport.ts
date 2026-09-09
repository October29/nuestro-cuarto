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
 * El ciclo de vida del transporte es independiente del ciclo de vida de la
 * Room. `connect()` arma el transporte y resuelve de inmediato; la
 * negociación P2P empieza cuando un peer se une (peer-joined del signaling)
 * o cuando llega un offer entrante. Si el peer se va, se cierra la conexión
 * P2P actual (resetNegotiation) pero el transporte permanece armado y listo
 * para re-negociar con el siguiente participante.
 *
 * No existe concepto de host/visitor: quién inicia la negociación (offerer)
 * es quien ya está presente en la sala cuando llega el otro; el que acaba de
 * llegar responde (answerer). Es un detalle interno de transporte.
 */
export class RtcPeerTransport implements NetworkTransport {
  private connection: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private unsubscribeSignaling: (() => void) | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private status: TransportState = 'idle';
  private negotiating = false;
  private renegotiationQueue: Array<() => Promise<void>> = [];
  private processingQueue = false;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly handlers: TransportHandlers,
    private readonly iceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS,
  ) {}

  get state(): TransportState {
    return this.status;
  }

  /**
   * Arma el transporte y se suscribe a señales del servidor. Resuelve de
   * inmediato: la negociación P2P empieza cuando haya un peer disponible.
   */
  connect(): Promise<void> {
    if (this.status === 'open') return Promise.resolve();
    if (this.status !== 'idle')
      return Promise.reject(new Error('transporte: no se puede conectar en este estado'));

    this.status = 'connecting';
    this.unsubscribeSignaling = this.signaling.subscribe((message) => {
      if (message.type === 'signal') {
        void this.handleIncomingSignal(message.data);
      } else if (message.type === 'peer-joined') {
        this.onPeerJoined();
      }
    });

    return Promise.resolve();
  }

  send(message: PeerMessage): boolean {
    const channel = this.channel;
    if (this.status !== 'open' || !channel || channel.readyState !== 'open') return false;
    channel.send(serializePeerMessage(message));
    return true;
  }

  /** Cierre local: desarma el transporte y limpia todo. */
  close(): void {
    this.status = 'closed';
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
    this.negotiating = false;
    this.channel = null;
    this.closeConnection();
    this.unsubscribeSignaling?.();
    this.unsubscribeSignaling = null;
  }

  // ── Negotiation ──────────────────────────────────────────────────

  /** Un peer se unió: si estoy armado y no estoy negociando, arranco. */
  private onPeerJoined(): void {
    if (this.negotiating || this.status !== 'connecting') return;

    this.ensureConnection();
    this.negotiating = true;
    this.startNegotiationTimeout();

    this.channel = this.connection!.createDataChannel(CHANNEL_LABEL);
    this.setupChannel(this.channel);
    void this.makeOffer();
  }

  /** Crea el RTCPeerConnection si no existe (lazy). */
  private ensureConnection(): void {
    if (this.connection) return;
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
    this.connection.ondatachannel = (event) => {
      this.channel = event.channel;
      this.setupChannel(event.channel);
    };
    this.connection.onnegotiationneeded = () => {
      // Disparado al añadir/quitar tracks (addTrack, removeTrack, etc.)
      // Solo encolar si la conexión está abierta y estable
      if (this.status === 'open' && this.connection?.signalingState === 'stable') {
        this.renegotiate();
      }
    };
  }

  private startNegotiationTimeout(): void {
    if (this.timeoutTimer) return;
    this.timeoutTimer = setTimeout(() => this.fail('negociación agotada (timeout)'), NEGOTIATION_TIMEOUT_MS);
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

  /**
   * Solicita una renegociación SDP (ej. al añadir/quitar tracks de media).
   * Encola la renegociación para evitar ofertas simultáneas.
   */
  renegotiate(): void {
    if (this.status === 'closed' || !this.connection) return;

    const work = async () => {
      if (this.status === 'closed' || !this.connection) return;
      if (this.connection.signalingState !== 'stable') return;

      try {
        await this.makeOffer();
      } catch {
        // makeOffer ya maneja el error con this.fail()
      }
    };

    this.renegotiationQueue.push(work);
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processingQueue || this.renegotiationQueue.length === 0) return;

    this.processingQueue = true;

    while (this.renegotiationQueue.length > 0) {
      if (this.status === 'closed' || !this.connection) break;

      const work = this.renegotiationQueue.shift();
      if (!work) continue;

      if (this.connection.signalingState !== 'stable') {
        // Volver a encolar si no está estable
        this.renegotiationQueue.unshift(work);
        break;
      }

      await work();
    }

    this.processingQueue = false;
  }

  private async handleIncomingSignal(data: SignalPayload): Promise<void> {
    if (this.status === 'closed') return;

    try {
      switch (data.kind) {
        case 'offer': {
          this.ensureConnection();
          this.negotiating = true;
          this.startNegotiationTimeout();
          await this.connection!.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          const answer = await this.connection!.createAnswer();
          await this.connection!.setLocalDescription(answer);
          this.signaling.sendSignal({ kind: 'answer', sdp: answer.sdp ?? '' });
          break;
        }
        case 'answer': {
          const pc = this.connection;
          if (!pc || pc.signalingState !== 'have-local-offer') break;
          await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          break;
        }
        case 'ice': {
          const pc = this.connection;
          if (!pc) break;
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
      this.negotiating = false;
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

  // ── Close / Reset ────────────────────────────────────────────────

  /** Peer se fue o conexión falló: cierra PC actual, mantiene transporte armado. */
  private notifyClose(reason: string): void {
    if (this.status !== 'open') return;
    this.status = 'connecting';
    this.resetNegotiation();
    this.handlers.onClose(reason);
  }

  /** Negociación falló: resetea pero no cierra el transporte. */
  private fail(reason: string): void {
    if (this.status === 'closed') return;
    this.resetNegotiation();
    this.handlers.onError(reason);
  }

  /** Cierra PC y canal, resetea flags de negociación. No toca signaling ni status. */
  private resetNegotiation(): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = null;
    this.channel = null;
    this.negotiating = false;
    this.closeConnection();
  }

  private closeConnection(): void {
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
