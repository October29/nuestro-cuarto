import type { PeerMessage } from './protocol';

/**
 * Abstracción de transporte P2P independiente de WebRTC.
 *
 * La capa de juego/sesión usa únicamente esta interfaz: no debe conocer
 * RTCPeerConnection ni RTCDataChannel en ningún otro punto de la aplicación.
 */
export interface TransportHandlers {
  /** El canal de datos quedó abierto y listo para enviar/recibir. */
  onOpen(): void;
  /** Mensaje P2P recibido del peer (ya validado con parsePeerMessage). */
  onMessage(message: PeerMessage): void;
  /** El peer desapareció o la conexión se cerró. */
  onClose(reason: string): void;
  /** Error de transporte. */
  onError(error: string): void;
}

export interface NetworkTransport {
  /**
   * Arma el transporte y se suscribe a señales del servidor. Resuelve de
   * inmediato: la negociación P2P empieza cuando hay un peer disponible.
   */
  connect(): Promise<void>;
  /** Envía un mensaje P2P. Devuelve false si el canal no está abierto. */
  send(message: PeerMessage): boolean;
  /** Cierra la conexión localmente. */
  close(): void;
  /**
   * Opcional (media local): sincroniza la lista de tracks locales con el
   * transporte. Solo los transportes WebRTC con media lo implementan.
   * Se ignora en transportes mock o sin soporte de media.
   */
  setLocalMediaTracks?(tracks: MediaStreamTrack[]): void;
  /**
   * Opcional (media remota): callback para cada track remoto recibido vía
   * RTCPeerConnection.ontrack, con los MediaStream asociados. Solo los
   * transportes WebRTC con media lo asignan.
   */
  onRemoteTrack?: ((track: MediaStreamTrack, streams: readonly MediaStream[]) => void) | null;
}