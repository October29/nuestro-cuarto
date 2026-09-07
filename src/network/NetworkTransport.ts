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
   * Negocia la conexión P2P y promete cuando el canal está abierto.
   * `initiate`: arranca la negociación de inmediato (solo host). Se usa en la
   * recuperación M08-C: el signaling ya confirmó que el peer está presente, así
   * que el host no necesita esperar un `peer-resumed` que ya llegó antes de
   * suscribirse.
   */
  connect(options?: { initiate?: boolean }): Promise<void>;
  /** Envía un mensaje P2P. Devuelve false si el canal no está abierto. */
  send(message: PeerMessage): boolean;
  /** Cierra la conexión localmente. */
  close(): void;
}