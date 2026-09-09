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
//
// Modelo de slots: cada slot controla únicamente los tracks del kind que
// solicitó (cámara → video, micrófono → audio). Si un stream compartido/fake
// trae tracks de otro kind, se adoptan al slot correspondiente para que nunca
// queden tracks vivos abandonados: quedar registrados, reportables en
// getActiveTracks() y detenibles con close().

export type MediaSourceKind = 'camera' | 'mic';

export interface ActiveLocalTrack {
  kind: MediaSourceKind;
  track: MediaStreamTrack;
}

interface CaptureSlot {
  /** Stream de origen de la captura de este slot (null si no hay captura). */
  stream: MediaStream | null;
  /** Solicitud de getUserMedia en vuelo (null si no hay). */
  request: Promise<void> | null;
  version: number;
  /** Tracks controlados por este slot, únicamente de su own kind. */
  tracks: MediaStreamTrack[];
}

export class MediaManager {
  private camera: CaptureSlot = { stream: null, request: null, version: 0, tracks: [] };
  private mic: CaptureSlot = { stream: null, request: null, version: 0, tracks: [] };
  private closed = false;

  isCameraEnabled(): boolean {
    return this.hasLiveTrack(this.camera);
  }

  isMicEnabled(): boolean {
    return this.hasLiveTrack(this.mic);
  }

  /** Stream local de cámara (null si no hay captura activa). */
  getCameraStream(): MediaStream | null {
    return this.camera.stream;
  }

  /** Stream local de micrófono (null si no hay captura activa). */
  getMicStream(): MediaStream | null {
    return this.mic.stream;
  }

  /** Tracks de captura controlados (solo los que siguen vivos). */
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
    this.disable(this.camera);
  }

  /** Detiene únicamente los tracks de audio del micrófono. */
  disableMic(): void {
    this.disable(this.mic);
  }

  /** Detiene toda la captura activa y deja el manager en estado limpio. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.invalidate(this.camera);
    this.invalidate(this.mic);
    for (const slot of [this.camera, this.mic]) {
      for (const track of slot.tracks) {
        if (track.readyState !== 'ended') track.stop();
      }
      slot.tracks = [];
      slot.stream = null;
    }
  }

  private enable(slot: CaptureSlot, kind: MediaSourceKind): Promise<void> {
    this.ensureOpen();
    if (this.hasLiveTrack(slot)) return Promise.resolve();
    if (slot.request !== null) return slot.request;

    slot.version += 1;
    const version = slot.version;
    const ownKind: 'video' | 'audio' = kind === 'camera' ? 'video' : 'audio';

    const request: Promise<void> = (async () => {
      try {
        const stream = await this.getUserMediaFor(kind);
        if (this.closed || slot.version !== version) {
          // La captura quedó invalidada mientras llegaba (disable o close).
          this.stopAllTracks(stream);
          return;
        }
        for (const track of stream.getTracks()) {
          if (track.kind === ownKind) {
            slot.tracks.push(track);
          } else {
            // Track de otro kind en un stream compartido/fake: se adopta al
            // slot correspondiente para que no quede vivo y abandonado.
            const target = track.kind === 'video' ? this.camera : this.mic;
            target.tracks.push(track);
          }
        }
        slot.stream = stream;
      } catch (error) {
        // Estado consistente: el slot sigue vacío.
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

  private disable(slot: CaptureSlot): void {
    this.invalidate(slot);
    // El slot solo contiene tracks de su propio kind, así que detenerlos todos
    // no afecta a tracks de otro kind (ya adoptados por el otro slot).
    for (const track of slot.tracks) {
      if (track.readyState !== 'ended') track.stop();
    }
    slot.tracks = [];
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

  private hasLiveTrack(slot: CaptureSlot): boolean {
    return slot.tracks.some((track) => track.readyState === 'live');
  }

  private collectLiveTracks(slot: CaptureSlot, kind: MediaSourceKind, out: ActiveLocalTrack[]): void {
    for (const track of slot.tracks) {
      if (track.readyState === 'live') out.push({ kind, track });
    }
  }

  private invalidate(slot: CaptureSlot): void {
    slot.version += 1;
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