import { RemotePlayer } from '../entities/RemotePlayer';
import { PLAYER_STATE_INTERVAL_MS } from '../config';

import type { Player } from '../entities/Player';
import type { NetworkSession } from '../../network/NetworkSession';
import type { PeerMessage } from '../../network/protocol';
import type Phaser from 'phaser';

// Genera un id local estable durante una sesión. No requiere cuentas ni
// autenticación: es solo un identificador de coordinación para el peer.
function generatePlayerId(): string {
  const random = (Math.random() + 1).toString(36).slice(2, 10);
  return `player-${random}`;
}

/**
 * Conecta la NetworkSession con el juego:
 *
 * - envía el estado del Player local (x, y, sitting) ~10 veces por segundo
 *   mientras hay sesión conectada;
 * - recibe el estado del peer y crea/actualiza el RemotePlayer correspondiente;
 * - elimina los RemotePlayers al desconectarse o salir de la sala.
 *
 * Cada cliente es autoridad únicamente de su propio Player: aquí solo se lee
 * el estado local y se replica el estado remoto. No se envían comandos de
 * movimiento remoto ni se corrige la posición del otro.
 *
 * Esta clase NO conoce WebRTC: únicamente consume NetworkSession y PeerMessage.
 */
export class PlayerSync {
  private remotePlayers = new Map<string, RemotePlayer>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly localPlayerId: string;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly session: NetworkSession,
    private readonly localPlayer: Player,
  ) {
    this.localPlayerId = generatePlayerId();
    console.log('[PlayerSync CREATED] localPlayerId:', this.localPlayerId);
  }

  /** Identidad local estable generada para esta sesión. */
  get id(): string {
    return this.localPlayerId;
  }

  /** Comienza el envío periódico del estado local. */
  start(): void {
    console.log('[PlayerSync START] localPlayerId:', this.localPlayerId);
    this.sendOwnState();
    this.timer = setInterval(() => this.sendOwnState(), PLAYER_STATE_INTERVAL_MS);
  }

  /** Detiene el envío y elimina las representaciones remotas. */
  stop(): void {
    console.log('[PlayerSync STOP] localPlayerId:', this.localPlayerId, 'remoteCount:', this.remotePlayers.size);
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.removeAllRemote();
  }

  /** Avanza la representación remota en cada fotograma del juego. */
  update(): void {
    for (const remote of this.remotePlayers.values()) {
      remote.update();
    }
  }

  /** Maneja un mensaje P2P recibido (ya tipado y validado por la sesión). */
  onMessage(message: PeerMessage): void {
    console.log('[onMessage] localPlayerId:', this.localPlayerId, 'type:', message.type, 'playerId:' , message.type === 'player_state' || message.type === 'player_disconnected' ? message.playerId : 'N/A');
    if (message.type === 'player_state') {
      this.applyRemoteState(message.playerId, message.x, message.y, message.sitting);
    } else if (message.type === 'player_disconnected') {
      this.removeRemote(message.playerId);
    }
  }

  /** ¿Existe una representación para ese peer? */
  hasRemote(playerId: string): boolean {
    return this.remotePlayers.has(playerId);
  }

  /** Número de representaciones remotas activas (máx. 1 en M07). */
  remoteCount(): number {
    return this.remotePlayers.size;
  }

  /** Acceso a una representación remota concreta (p. ej. para pruebas/depuración). */
  getRemote(playerId: string): RemotePlayer | null {
    return this.remotePlayers.get(playerId) ?? null;
  }

  private sendOwnState(): void {
    if (this.session.state !== 'connected') return;

    this.session.send({
      type: 'player_state',
      playerId: this.localPlayerId,
      x: this.localPlayer.x,
      y: this.localPlayer.y,
      sitting: this.localPlayer.isSitting(),
    });
  }

  private applyRemoteState(playerId: string, x: number, y: number, sitting: boolean): void {
    console.log('[applyRemoteState] localPlayerId:', this.localPlayerId, 'received playerId:', playerId, 'x:', x, 'y:', y, 'remotePlayers.size:', this.remotePlayers.size);
    if (!playerId || playerId === this.localPlayerId) return;
    if (!Number.isFinite(x) || !Number.isFinite(y) || typeof sitting !== 'boolean') return;

    let remote = this.remotePlayers.get(playerId);
    if (!remote) {
      remote = new RemotePlayer(this.scene, playerId, x, y);
      remote.setDepth(1);
      this.remotePlayers.set(playerId, remote);
      console.log('[applyRemoteState] CREATED RemotePlayer playerId:', playerId, 'total remotes:', this.remotePlayers.size);
    }
    remote.updateState(x, y, sitting);
  }

  private removeRemote(playerId: string): void {
    const remote = this.remotePlayers.get(playerId);
    if (!remote) return;
    remote.destroy();
    this.remotePlayers.delete(playerId);
  }

  private removeAllRemote(): void {
    for (const playerId of [...this.remotePlayers.keys()]) {
      this.removeRemote(playerId);
    }
  }
}