// B8: captura local de cámara y micrófono.
//
// MediaManager es la capa que posee la captura local de media (cámara y
// micrófono) como estado efímero de sesión. Contrato según B7:
// - es dueño de los MediaStream/MediaStreamTrack de captura local;
// - NO toca RTCPeerConnection, signaling, RoomState ni escena;
// - la publicación de tracks hacia WebRTC y el renderizado son pasos
//   posteriores (B9+).
//
// La captura es perezosa: construir el manager no pide permisos. getUserMedia
// solo se invoca cuando enableCamera()/enableMic() se llaman.

export type MediaSourceKind = 'camera' | 'mic';

export interface ActiveLocalTrack {
  kind: MediaSourceKind;
  track: MediaStreamTrack;
}

interface CaptureSlot {
  stream: MediaStream | null;
  request: Promise<void> | null;
  version: number;
}

export class MediaManager {
  private camera: CaptureSlot = { stream: null, request: null, version: 0 };
  private mic: CaptureSlot = { stream: null, request: null, version: 0 };
  private closed = false;

  isCameraEnabled(): boolean {
    return this.camera.stream !== null;
  }

  isMicEnabled(): boolean {
    return this.mic.stream !== null;
  }

  /** Stream local de cámara (null si no hay captura activa). */
  getCameraStream(): MediaStream | null {
    return this.camera.stream;
  }

  /** Stream local de micrófono (null si no hay captura activa). */
  getMicStream(): MediaStream | null {
    return this.mic.stream;
  }

  /** Tracks de captura activos (solo los que siguen vivos). */
  getActiveTracks(): ActiveLocalTrack[] {
    const tracks: ActiveLocalTrack[] = [];
    this.collectLiveTracks(this.camera, 'camera', tracks);
    this.collectLiveTracks(this.mic, 'mic', tracks);
    return tracks;
  }

  /** Solicita la cámara. No abre una segunda captura si ya hay una activa. */
  enableCamera(): Promise<void> {
    return this.enable(this.camera, 'camera');
  }

  /** Solicita el micrófono. No abre una segunda captura si ya hay una activa. */
  enableMic(): Promise<void> {
    return this.enable(this.mic, 'mic');
  }

  /** Detiene únicamente los tracks de vídeo de la cámara. */
  disableCamera(): void {
    this.disable(this.camera, 'video');
  }

  /** Detiene únicamente los tracks de audio del micrófono. */
  disableMic(): void {
    this.disable(this.mic, 'audio');
  }

  /** Detiene toda la captura activa y deja el manager en estado limpio. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.invalidate(this.camera);
    this.invalidate(this.mic);
    this.stopAll(this.camera);
    this.stopAll(this.mic);
  }

  private enable(slot: CaptureSlot, kind: MediaSourceKind): Promise<void> {
    this.ensureOpen();
    if (slot.stream !== null) return Promise.resolve();
    if (slot.request !== null) return slot.request;

    slot.version += 1;
    const version = slot.version;

    const request: Promise<void> = (async () => {
      try {
        const stream = await this.getUserMediaFor(kind);
        if (this.closed || slot.version !== version) {
          // La captura quedó invalidada mientras llegaba (disable o close).
          this.stopAllTracks(stream);
          return;
        }
        slot.stream = stream;
      } catch (error) {
        // Estado consistente: slot.stream sigue siendo null.
        // Solo propagar si esta solicitud sigue vigente.
        if (slot.version === version) throw error;
      }
    })();

    // Limpiar el slot de la solicitud en vuelo solo si sigue siendo esta.
    request.then(
      () => {
        if (slot.request === request) slot.request = null;
      },
      () => {
        if (slot.request === request) slot.request = null;
      },
    );
    slot.request = request;
    return request;
  }

  private disable(slot: CaptureSlot, kind: 'video' | 'audio'): void {
    this.invalidate(slot);
    if (slot.stream === null) return;
    for (const track of slot.stream.getTracks()) {
      if (track.kind === kind) track.stop();
    }
    slot.stream = null;
  }

  private getUserMediaFor(kind: MediaSourceKind): Promise<MediaStream> {
    if (
      typeof navigator === 'undefined' ||
      typeof navigator.mediaDevices === 'undefined' ||
      typeof navigator.mediaDevices.getUserMedia !== 'function'
    ) {
      return Promise.reject(new Error('media: getUserMedia no está disponible'));
    }
    const constraints: MediaStreamConstraints = kind === 'camera' ? { video: true } : { audio: true };
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  private collectLiveTracks(slot: CaptureSlot, kind: MediaSourceKind, out: ActiveLocalTrack[]): void {
    if (slot.stream === null) return;
    const wantedKind: 'video' | 'audio' = kind === 'camera' ? 'video' : 'audio';
    for (const track of slot.stream.getTracks()) {
      if (track.kind === wantedKind && track.readyState === 'live') {
        out.push({ kind, track });
      }
    }
  }

  private invalidate(slot: CaptureSlot): void {
    slot.version += 1;
  }

  private stopAll(slot: CaptureSlot): void {
    if (slot.stream === null) return;
    this.stopAllTracks(slot.stream);
    slot.stream = null;
  }

  private stopAllTracks(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      if (track.readyState !== 'ended') track.stop();
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error('media: manager cerrado');
  }
}