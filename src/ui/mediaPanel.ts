import { MediaManager } from '../network/MediaManager';
import type { NetworkSession } from '../network/NetworkSession';

/**
 * M10: panel de medios de la sala (captura, preview y playback WebRTC).
 *
 * Capa superior de UI que:
 *  - captura cámara/micrófono con MediaManager SOLO por acción del usuario
 *    (botones): no se piden permisos al cargar la página;
 *  - muestra la preview local en un <video> muted (nunca reproduce su propio
 *    audio) y la limpia al desactivar;
 *  - publica los tracks activos hacia NetworkSession → setLocalMediaTracks →
 *    RtcPeerTransport (la cola de renegociación B6/B9 la resuelve, sin segunda
 *    cola ni getUserMedia en el transporte);
 *  - recibe los tracks remotos por onRemoteTrack y los consolida en un ÚNICO
 *    <video> (vídeo + audio), no muted, con desbloqueo de autoplay mediante
 *    gesto del usuario ("Activar audio");
 *  - refleja en la UI los estados de cámara/micrófono y los errores de
 *    permisos/dispositivo;
 *  - al abandonar la sala cierra MediaManager, detiene tracks y limpia
 *    srcObject.
 *
 * No introduce una máquina de estados nueva: los estados de conexión
 * (desconectado/conectando/conectado) ya los muestra ConnectMenu; aquí se
 * gestionan los estados de media del dispositivo y sus errores.
 */
export class MediaPanel {
  private readonly localVideo: HTMLVideoElement;
  private readonly remoteVideo: HTMLVideoElement;
  private readonly cameraBtn: HTMLButtonElement;
  private readonly micBtn: HTMLButtonElement;
  private readonly mediaStatus: HTMLDivElement;
  private readonly audioUnlockBtn: HTMLButtonElement;

  private session: NetworkSession | null = null;
  private manager: MediaManager | null = null;
  private remoteStream: MediaStream | null = null;
  private mediaError: string | null = null;

  constructor() {
    this.localVideo = document.getElementById('local-video') as HTMLVideoElement;
    this.remoteVideo = document.getElementById('remote-video') as HTMLVideoElement;
    this.cameraBtn = document.getElementById('camera-btn') as HTMLButtonElement;
    this.micBtn = document.getElementById('mic-btn') as HTMLButtonElement;
    this.mediaStatus = document.getElementById('media-status') as HTMLDivElement;
    this.audioUnlockBtn = document.getElementById('audio-unlock-btn') as HTMLButtonElement;

    this.localVideo.muted = true;
    this.localVideo.playsInline = true;
    this.remoteVideo.muted = false;
    this.remoteVideo.playsInline = true;
    this.audioUnlockBtn.hidden = true;

    this.cameraBtn.addEventListener('click', () => void this.toggleCamera());
    this.micBtn.addEventListener('click', () => void this.toggleMic());
    this.audioUnlockBtn.addEventListener('click', () => this.tryPlayRemoteVideo());

    this.renderState();
  }

  /**
   * Vincula la sesión activa. Al conectar: usa MediaManager (o lo crea),
   * suscribe onRemoteTrack, republica los tracks que ya estén activos y
   * reengancha la preview local si la cámara estaba encendida. Con null:
   * apaga absolutamente la captura y limpia la UI (abandono/cierre).
   */
  bindSession(session: NetworkSession | null): void {
    if (this.session && this.session !== session) {
      this.session.onRemoteTrack = null;
    }
    this.session = session;
    if (!session) {
      this.shutdown();
      return;
    }
    this.manager ??= new MediaManager();
    session.onRemoteTrack = (track, streams) => this.handleRemoteTrack(track, streams);
    this.mediaError = null;
    this.publishTracks();
    this.attachLocalPreview(this.manager.getCameraStream());
    this.renderState();
  }

  /** Activa/desactiva la cámara (botón "Cámara"). */
  async toggleCamera(): Promise<void> {
    if (!this.manager || !this.session) return;
    if (this.manager.isCameraEnabled()) {
      this.disableCamera();
    } else {
      await this.enableMedia(async () => {
        await this.manager!.enableCamera();
        this.attachLocalPreview(this.manager!.getCameraStream());
      });
    }
  }

  /** Activa/desactiva el micrófono (botón "Micrófono"). */
  async toggleMic(): Promise<void> {
    if (!this.manager || !this.session) return;
    if (this.manager.isMicEnabled()) {
      this.manager.disableMic();
      this.publishTracks();
      this.mediaError = null;
      this.renderState();
    } else {
      await this.enableMedia(async () => {
        await this.manager!.enableMic();
      });
    }
  }

  // ── captura local ────────────────────────────────────────────────────

  private async enableMedia(action: () => Promise<void>): Promise<void> {
    this.mediaError = null;
    try {
      await action();
    } catch (error) {
      this.mediaError = this.describeMediaError(error);
    }
    this.publishTracks();
    this.renderState();
  }

  private disableCamera(): void {
    this.manager!.disableCamera();
    this.attachLocalPreview(null);
    this.publishTracks();
    this.mediaError = null;
    this.renderState();
  }

  /** Cierra la preview local: solo se muestra cuando la cámara está viva. */
  private attachLocalPreview(stream: MediaStream | null): void {
    const video = this.localVideo;
    if (!stream) {
      video.srcObject = null;
      return;
    }
    video.srcObject = stream;
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;
    if (typeof video.play === 'function') {
      const promise = video.play();
      if (promise && typeof promise.then === 'function') {
        promise.catch(() => undefined);
      }
    }
  }

  private publishTracks(): void {
    if (!this.session || !this.manager) return;
    const tracks = this.manager.getActiveTracks().map(({ track }) => track);
    this.session.setLocalMediaTracks(tracks);
  }

  private describeMediaError(error: unknown): string {
    const name = (error as { name?: string } | null)?.name;
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return 'Permiso de cámara/micrófono denegado. Actívalo en el navegador y reintenta.';
    }
    if (name === 'NotFoundError' || name === 'OverconstrainedError') {
      return 'No se encontró el dispositivo solicitado.';
    }
    if (name === 'NotReadableError') {
      return 'El dispositivo está en uso por otra aplicación.';
    }
    const message = error instanceof Error ? error.message : String(error);
    return `No se pudo activar el media: ${message}`;
  }

  // ── media remota ─────────────────────────────────────────────────────

  /**
   * Consolida cada track remoto en un único stream de reproducción que
   * alimenta el único <video> remoto (vídeo + audio). Un track de reemplazo
   * (mismo kind) sustituye al anterior en el stream sin duplicar nada.
   */
  private handleRemoteTrack(track: MediaStreamTrack, _streams: readonly MediaStream[]): void {
    if (!this.session) return;
    const stream = this.ensureRemoteStream();
    const existing = stream.getTracks().find((t) => t.kind === track.kind);
    if (existing && existing !== track) {
      stream.removeTrack(existing);
    }
    if (!stream.getTracks().includes(track)) {
      stream.addTrack(track);
    }
    this.attachRemoteStream(stream);
  }

  private ensureRemoteStream(): MediaStream {
    if (!this.remoteStream) {
      this.remoteStream = typeof MediaStream !== 'undefined' ? new MediaStream() : ({} as MediaStream);
    }
    return this.remoteStream;
  }

  private attachRemoteStream(stream: MediaStream): void {
    this.remoteVideo.srcObject = stream;
    this.remoteVideo.autoplay = true;
    this.remoteVideo.playsInline = true;
    this.remoteVideo.muted = false;
    this.tryPlayRemoteVideo();
  }

  /** Intenta reproducir el vídeo remoto; si autoplay está bloqueado por el
   *  navegador (audio), muestra "Activar audio": gesto explícito del usuario. */
  private tryPlayRemoteVideo(): void {
    const video = this.remoteVideo;
    if (typeof video.play !== 'function') {
      this.audioUnlockBtn.hidden = true;
      return;
    }
    const promise = video.play();
    if (!promise || typeof promise.then !== 'function') {
      this.audioUnlockBtn.hidden = true;
      return;
    }
    promise
      .then(() => {
        this.audioUnlockBtn.hidden = true;
      })
      .catch(() => {
        this.audioUnlockBtn.hidden = false;
      });
  }

  private clearRemote(): void {
    if (this.remoteStream) {
      for (const track of this.remoteStream.getTracks()) {
        track.stop();
      }
      this.remoteStream = null;
    }
    this.remoteVideo.srcObject = null;
    this.audioUnlockBtn.hidden = true;
  }

  // ── cierre y estados ─────────────────────────────────────────────────

  private shutdown(): void {
    this.manager?.close();
    this.manager = null;
    this.attachLocalPreview(null);
    this.clearRemote();
    this.mediaError = null;
    this.renderState();
  }

  /** Refleja en la UI el estado de cámara/micrófono y los errores de media. */
  private renderState(): void {
    const camera = this.manager?.isCameraEnabled() ?? false;
    const mic = this.manager?.isMicEnabled() ?? false;
    const hasSession = this.session !== null;

    this.cameraBtn.disabled = !hasSession;
    this.micBtn.disabled = !hasSession;
    this.cameraBtn.textContent = camera ? '📷 Cámara activada' : '📷 Cámara desactivada';
    this.cameraBtn.className = camera ? 'media-btn active' : 'media-btn';
    this.micBtn.textContent = mic ? '🎤 Micrófono activado' : '🎤 Micrófono desactivado';
    this.micBtn.className = mic ? 'media-btn active' : 'media-btn';

    if (this.mediaError) {
      this.mediaStatus.textContent = this.mediaError;
      this.mediaStatus.className = 'media-hint media-error';
      return;
    }
    if (!hasSession) {
      this.mediaStatus.textContent = 'Únete o crea una sala para usar cámara y micrófono.';
      this.mediaStatus.className = 'media-hint';
      return;
    }
    if (camera || mic) {
      this.mediaStatus.textContent = [
        camera ? 'Cámara activa' : 'Cámara inactiva',
        mic ? 'Micrófono activo' : 'Micrófono inactivo',
      ].join(' · ');
      this.mediaStatus.className = 'media-hint media-ok';
      return;
    }
    this.mediaStatus.textContent = 'Cámara y micrófono desactivados.';
    this.mediaStatus.className = 'media-hint';
  }
}